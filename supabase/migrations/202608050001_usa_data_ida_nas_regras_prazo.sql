begin;

create or replace function public.ro_validar_nova_solicitacao()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text:=public.ro_role(auth.uid());
  v_is_gerencial boolean:=coalesce(v_role,'') in ('gerente','diretor');
  v_rh boolean:=coalesce(public.ro_is_rh_active(),false);
  v_can_administrativo boolean:=coalesce(public.ro_can_view_all(),false);
  v_hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
  v_reg record; v_min date; v_categoria text;
begin
  if auth.uid() is null or new.solicitante_id is distinct from auth.uid() then raise exception 'SOLICITANTE_INVALIDO'; end if;
  if new.motivo='viagem_diretoria' then raise exception 'MOTIVO_NAO_DISPONIVEL'; end if;
  if new.motivo is null and not v_can_administrativo then raise exception 'MOTIVO_ADMINISTRATIVO_NAO_PERMITIDO'; end if;
  if not v_is_gerencial and v_rh and coalesce(new.motivo,'') not in ('admissao','desligamento','inicio_obra') then raise exception 'MOTIVO_NAO_PERMITIDO'; end if;
  if not v_is_gerencial and not v_rh and new.motivo='admissao' then raise exception 'MOTIVO_NAO_PERMITIDO'; end if;
  if new.motivo='desligamento' and (new.desligamento_subtipo is null or coalesce(new.desligamento_subtipo,'') not in ('programado_outros','justa_causa','pedido_demissao','ma_conduta')) then raise exception 'SUBTIPO_DESLIGAMENTO_OBRIGATORIO'; end if;
  if new.motivo is distinct from 'desligamento' and new.desligamento_subtipo is not null then raise exception 'SUBTIPO_DESLIGAMENTO_INVALIDO'; end if;
  if new.data_ida is null then raise exception 'DATA_IDA_OBRIGATORIA'; end if;
  if new.data_ida<v_hoje then raise exception 'DATA_IDA_NO_PASSADO'; end if;

  -- Compatibilidade histórica: o cliente não controla este valor e ele não participa da validação.
  new.primeiro_embarque_em:=(new.data_ida+time '12:00') at time zone 'America/Sao_Paulo';
  select * into v_reg from public.ro_prazo_regra(new.motivo,new.desligamento_subtipo);
  if v_reg.prazo_tipo='dias_uteis' then
    v_min:=public.ro_data_minima_util(now(),v_reg.prazo_quantidade);
  elsif v_reg.prazo_tipo='dias_corridos' then
    v_min:=v_hoje+v_reg.prazo_quantidade;
  else
    v_min:=v_hoje;
  end if;
  if tg_op='INSERT' then new.origem_solicitacao:=case when new.motivo is null then 'administrativo' when v_is_gerencial then 'gerencial' when v_rh then 'rh' else 'comum' end;
  else new.origem_solicitacao:=old.origem_solicitacao; end if;
  new.prazo_regra_codigo:=v_reg.regra_codigo; new.prazo_tipo:=v_reg.prazo_tipo; new.prazo_quantidade:=v_reg.prazo_quantidade; new.data_minima_permitida:=v_min; new.prazo_calculado_em:=now();
  if new.data_ida<v_min then
    if not v_is_gerencial then raise exception 'FORA_DO_PRAZO:%',v_min; end if;
    if length(trim(coalesce(new.prazo_excecao_justificativa,new.justificativa_excecao_prazo,'')))<10 then raise exception 'JUSTIFICATIVA_EXCECAO_OBRIGATORIA'; end if;
    new.prazo_excecao:=true; new.prazo_excecao_por:=auth.uid(); new.prazo_excecao_em:=now();
  else
    new.prazo_excecao:=false; new.prazo_excecao_justificativa:=null; new.justificativa_excecao_prazo:=null; new.prazo_excecao_por:=null; new.prazo_excecao_em:=null;
  end if;
  v_categoria:=v_reg.categoria_documento;
  if v_categoria is not null and not exists(select 1 from public.ro_passagem_documentos_internos d where d.solicitacao_id=new.id and d.categoria=v_categoria) then raise exception 'DOCUMENTO_INTERNO_OBRIGATORIO:%',v_categoria; end if;
  if tg_op='UPDATE' then
    insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
    values('solicitacao_revalidada',new.id,jsonb_build_object('motivo_anterior',old.motivo,'motivo_novo',new.motivo,'subtipo_anterior',old.desligamento_subtipo,'subtipo_novo',new.desligamento_subtipo,'data_ida_anterior',old.data_ida,'data_ida_nova',new.data_ida,'data_minima',new.data_minima_permitida,'excecao',new.prazo_excecao),auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists ro_validar_nova_solicitacao on public.ro_passagem_solicitacoes;
create trigger ro_validar_nova_solicitacao before insert on public.ro_passagem_solicitacoes for each row execute function public.ro_validar_nova_solicitacao();
drop trigger if exists ro_revalidar_solicitacao_editada on public.ro_passagem_solicitacoes;
create trigger ro_revalidar_solicitacao_editada before update of motivo,desligamento_subtipo,data_ida,primeiro_embarque_em,origem,destino on public.ro_passagem_solicitacoes for each row execute function public.ro_validar_nova_solicitacao();

create or replace function public.ro_criar_solicitacao_validada(p_solicitacao jsonb,p_documentos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_id uuid:=coalesce(nullif(p_solicitacao->>'id','')::uuid,gen_random_uuid()); v_doc jsonb; v_obj storage.objects%rowtype; v_justificativa text;
begin
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
  insert into public.ro_passagem_solicitacoes(id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,primeiro_embarque_em,data_retorno,centro_custo_retorno_id,retorno_indefinido,centro_custo_destino_id,desligamento_subtipo,prazo_excecao_justificativa,justificativa_excecao_prazo,observacoes_solicitante)
  values(v_id,(p_solicitacao->>'funcionario_id')::uuid,nullif(p_solicitacao->>'obra_id','')::uuid,auth.uid(),p_solicitacao->>'origem',p_solicitacao->>'destino',nullif(p_solicitacao->>'motivo',''),nullif(p_solicitacao->>'data_ida','')::date,null,nullif(p_solicitacao->>'data_retorno','')::date,nullif(p_solicitacao->>'centro_custo_retorno_id','')::uuid,coalesce((p_solicitacao->>'retorno_indefinido')::boolean,false),nullif(p_solicitacao->>'centro_custo_destino_id','')::uuid,nullif(p_solicitacao->>'desligamento_subtipo',''),v_justificativa,v_justificativa,nullif(p_solicitacao->>'observacoes_solicitante',''));
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  select 'solicitacao_validada',v_id,jsonb_build_object('regra',s.prazo_regra_codigo,'tipo',s.prazo_tipo,'quantidade',s.prazo_quantidade,'data_minima',s.data_minima_permitida,'data_ida',s.data_ida,'excecao',s.prazo_excecao,'justificativa',s.prazo_excecao_justificativa),auth.uid() from public.ro_passagem_solicitacoes s where s.id=v_id;
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  select 'documento_interno_anexado',v_id,jsonb_build_object('categoria',d.categoria),auth.uid() from public.ro_passagem_documentos_internos d where d.solicitacao_id=v_id;
  return v_id;
end $$;

revoke all on function public.ro_validar_nova_solicitacao(),public.ro_criar_solicitacao_validada(jsonb,jsonb) from public,anon;
grant execute on function public.ro_criar_solicitacao_validada(jsonb,jsonb) to authenticated;

commit;
