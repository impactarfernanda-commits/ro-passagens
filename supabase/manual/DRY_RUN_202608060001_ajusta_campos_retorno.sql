begin;

alter table public.ro_passagem_solicitacoes
  add column if not exists destino_retorno text;

create or replace function public.ro_motivo_possui_retorno(p_motivo text)
returns boolean language sql immutable parallel safe set search_path=public,pg_temp as $$
  select coalesce(p_motivo in ('ferias','folga_campo','recesso'),false);
$$;

create or replace function public.ro_normalizar_campos_retorno()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if not public.ro_motivo_possui_retorno(new.motivo) then
    new.data_retorno:=null;
    new.destino_retorno:=null;
    new.centro_custo_retorno_id:=null;
    new.retorno_indefinido:=false;
  elsif coalesce(new.retorno_indefinido,false) then
    new.destino_retorno:=null;
    new.centro_custo_retorno_id:=null;
  else
    new.destino_retorno:=nullif(trim(new.destino_retorno),'');
  end if;
  return new;
end $$;

drop trigger if exists ro_normalizar_campos_retorno on public.ro_passagem_solicitacoes;
create trigger ro_normalizar_campos_retorno
before insert or update of motivo,data_retorno,destino_retorno,centro_custo_retorno_id,retorno_indefinido
on public.ro_passagem_solicitacoes for each row execute function public.ro_normalizar_campos_retorno();

alter table public.ro_passagem_solicitacoes drop constraint if exists ro_campos_retorno_aplicaveis_ck;
alter table public.ro_passagem_solicitacoes add constraint ro_campos_retorno_aplicaveis_ck check(
  (public.ro_motivo_possui_retorno(motivo) or
   (data_retorno is null and destino_retorno is null and centro_custo_retorno_id is null and not retorno_indefinido))
  and (not retorno_indefinido or (destino_retorno is null and centro_custo_retorno_id is null))
) not valid;

create or replace function public.ro_obter_dados_para_refazer_solicitacao(p_solicitacao_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'NAO_AUTENTICADO'; end if;
  select jsonb_build_object(
    'solicitacao_origem_id',s.id,'funcionario_id',s.funcionario_id,'obra_id',s.obra_id,
    'origem',s.origem,'destino',s.destino,'motivo',s.motivo,'desligamento_subtipo',s.desligamento_subtipo,
    'data_ida',s.data_ida,
    'data_retorno',case when public.ro_motivo_possui_retorno(s.motivo) then s.data_retorno end,
    'destino_retorno',case when public.ro_motivo_possui_retorno(s.motivo) and not s.retorno_indefinido then s.destino_retorno end,
    'centro_custo_retorno_id',case when public.ro_motivo_possui_retorno(s.motivo) and not s.retorno_indefinido then s.centro_custo_retorno_id end,
    'retorno_indefinido',case when public.ro_motivo_possui_retorno(s.motivo) then s.retorno_indefinido else false end,
    'centro_custo_destino_id',s.centro_custo_destino_id,'observacoes_solicitante',s.observacoes_solicitante)
  into v_result from public.ro_passagem_solicitacoes s
  where s.id=p_solicitacao_id and s.solicitante_id=auth.uid() and s.status='recusada';
  if v_result is null then raise exception 'PREFILL_NAO_AUTORIZADO'; end if;
  return v_result;
end $$;

create or replace function public.ro_criar_solicitacao_validada(p_solicitacao jsonb,p_documentos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare
  v_id uuid:=coalesce(nullif(p_solicitacao->>'id','')::uuid,gen_random_uuid());
  v_doc jsonb; v_obj storage.objects%rowtype; v_justificativa text;
  v_motivo text:=nullif(p_solicitacao->>'motivo','');
  v_tem_retorno boolean; v_retorno_indefinido boolean;
begin
  v_tem_retorno:=public.ro_motivo_possui_retorno(v_motivo);
  v_retorno_indefinido:=v_tem_retorno and coalesce((p_solicitacao->>'retorno_indefinido')::boolean,false);
  v_justificativa:=case when coalesce((p_solicitacao->>'solicitar_excecao_prazo')::boolean,false) then nullif(trim(p_solicitacao->>'justificativa_excecao_prazo'),'') end;
  for v_doc in select value from jsonb_array_elements(coalesce(p_documentos,'[]'::jsonb)) loop
    select * into v_obj from storage.objects o where o.bucket_id='ro-documentos-internos' and o.name=v_doc->>'storage_path' and o.owner_id::text=auth.uid()::text;
    if not found then raise exception 'DOCUMENTO_NAO_ENCONTRADO_OU_SEM_PERMISSAO'; end if;
    if (v_doc->>'storage_path') not like v_id::text||'/'||(v_doc->>'categoria')||'/%' then raise exception 'CAMINHO_DOCUMENTO_INVALIDO'; end if;
    if coalesce(v_obj.metadata->>'mimetype','')<>'application/pdf' or lower(storage.extension(v_obj.name))<>'pdf' then raise exception 'DOCUMENTO_NAO_PDF'; end if;
    if coalesce((v_obj.metadata->>'size')::bigint,0)<=0 or (v_obj.metadata->>'size')::bigint>10485760 then raise exception 'DOCUMENTO_TAMANHO_INVALIDO'; end if;
    insert into public.ro_passagem_documentos_internos(id,solicitacao_id,categoria,storage_path,arquivo_nome,mime_type,tamanho_bytes,created_by)
    values(gen_random_uuid(),v_id,v_doc->>'categoria',v_doc->>'storage_path',v_doc->>'arquivo_nome','application/pdf',(v_obj.metadata->>'size')::bigint,auth.uid());
  end loop;
  insert into public.ro_passagem_solicitacoes(
    id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,primeiro_embarque_em,
    data_retorno,destino_retorno,centro_custo_retorno_id,retorno_indefinido,centro_custo_destino_id,
    desligamento_subtipo,prazo_excecao_justificativa,justificativa_excecao_prazo,observacoes_solicitante,
    solicitacao_origem_id,folga_antecipacao_justificativa)
  values(
    v_id,(p_solicitacao->>'funcionario_id')::uuid,nullif(p_solicitacao->>'obra_id','')::uuid,auth.uid(),
    p_solicitacao->>'origem',p_solicitacao->>'destino',v_motivo,nullif(p_solicitacao->>'data_ida','')::date,null,
    case when v_tem_retorno then nullif(p_solicitacao->>'data_retorno','')::date end,
    case when v_tem_retorno and not v_retorno_indefinido then nullif(trim(p_solicitacao->>'destino_retorno'),'') end,
    case when v_tem_retorno and not v_retorno_indefinido then nullif(p_solicitacao->>'centro_custo_retorno_id','')::uuid end,
    v_retorno_indefinido,nullif(p_solicitacao->>'centro_custo_destino_id','')::uuid,
    nullif(p_solicitacao->>'desligamento_subtipo',''),v_justificativa,v_justificativa,
    nullif(p_solicitacao->>'observacoes_solicitante',''),nullif(p_solicitacao->>'solicitacao_origem_id','')::uuid,
    nullif(trim(p_solicitacao->>'folga_antecipacao_justificativa'),''));
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  select 'solicitacao_validada',v_id,jsonb_build_object('regra',s.prazo_regra_codigo,'tipo',s.prazo_tipo,'quantidade',s.prazo_quantidade,'data_minima',s.data_minima_permitida,'data_ida',s.data_ida,'excecao',s.prazo_excecao),auth.uid()
  from public.ro_passagem_solicitacoes s where s.id=v_id;
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  select 'documento_interno_anexado',v_id,jsonb_build_object('categoria',d.categoria),auth.uid()
  from public.ro_passagem_documentos_internos d where d.solicitacao_id=v_id;
  return v_id;
end $$;

create or replace function public.ro_notificar_retorno_pendente()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_nome text; v_limite date; v_ro record; v_msg text;
begin
  if public.ro_motivo_possui_retorno(new.motivo) and new.data_retorno is not null and (new.centro_custo_retorno_id is null or new.retorno_indefinido) then
    select nome into v_nome from public.funcionarios where id=new.funcionario_id;
    v_limite:=new.data_retorno-10;
    v_msg:=format('Solicitação de retorno pendente para %s. A solicitação deve ser definida até %s, considerando retorno previsto em %s.',v_nome,to_char(v_limite,'DD/MM/YYYY'),to_char(new.data_retorno,'DD/MM/YYYY'));
    insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem) values(new.id,'interno','solicitante',new.solicitante_id::text,v_msg);
    for v_ro in select user_id from public.ro_responsaveis where ativo loop
      insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem) values(new.id,'interno','ro',v_ro.user_id::text,v_msg);
    end loop;
  end if;
  return new;
end $$;

revoke all on function public.ro_motivo_possui_retorno(text),public.ro_normalizar_campos_retorno() from public,anon;
revoke all on function public.ro_obter_dados_para_refazer_solicitacao(uuid),public.ro_criar_solicitacao_validada(jsonb,jsonb) from public,anon;
grant execute on function public.ro_obter_dados_para_refazer_solicitacao(uuid),public.ro_criar_solicitacao_validada(jsonb,jsonb) to authenticated;
grant execute on function public.ro_motivo_possui_retorno(text) to authenticated;

rollback;
