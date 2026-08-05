begin;

-- 202608050002_recusa_solicitacao_ro.sql
alter table public.ro_passagem_solicitacoes
  add column if not exists recusada_em timestamptz,
  add column if not exists recusada_por uuid references auth.users(id) on delete restrict,
  add column if not exists motivo_recusa text,
  add column if not exists solicitacao_origem_id uuid references public.ro_passagem_solicitacoes(id) on delete restrict;

alter table public.ro_passagem_solicitacoes drop constraint if exists ro_status_valido;
alter table public.ro_passagem_solicitacoes add constraint ro_status_valido
  check(status in ('solicitada','em_andamento','passagem_comprada','finalizada','cancelada','recusada'));
alter table public.ro_passagem_solicitacoes drop constraint if exists ro_recusa_consistencia;
alter table public.ro_passagem_solicitacoes add constraint ro_recusa_consistencia check(
  (status='recusada' and recusada_em is not null and recusada_por is not null and length(trim(motivo_recusa))>=10)
  or (status<>'recusada' and recusada_em is null and recusada_por is null and motivo_recusa is null)
);
alter table public.ro_passagem_solicitacoes drop constraint if exists ro_solicitacao_origem_diferente;
alter table public.ro_passagem_solicitacoes add constraint ro_solicitacao_origem_diferente
  check(solicitacao_origem_id is null or solicitacao_origem_id<>id);

create index if not exists ro_solicitacoes_status_idx on public.ro_passagem_solicitacoes(status);
create index if not exists ro_solicitacoes_recusada_por_idx on public.ro_passagem_solicitacoes(recusada_por) where recusada_por is not null;
create index if not exists ro_solicitacoes_origem_idx on public.ro_passagem_solicitacoes(solicitacao_origem_id) where solicitacao_origem_id is not null;

create or replace function public.ro_is_operador_ativo(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_user is not null and exists(select 1 from public.ro_responsaveis r where r.user_id=p_user and r.ativo);
$$;

create or replace function public.ro_solicitacao_foi_comprada(p_solicitacao_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.ro_passagem_solicitacoes s
    where s.id=p_solicitacao_id and (
      s.status in ('passagem_comprada','finalizada') or s.comprado_em is not null or s.comprado_por is not null
      or exists(select 1 from public.ro_passagem_custos c where c.solicitacao_id=s.id and c.tipo='passagem' and c.valor>0)
      or exists(select 1 from public.ro_passagem_anexos a where a.solicitacao_id=s.id)
    )
  );
$$;

create or replace function public.ro_proteger_recusa_terminal()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_origem public.ro_passagem_solicitacoes%rowtype; v_rpc boolean:=coalesce(current_setting('ro.recusa_rpc',true),'')='1';
begin
  if tg_op='INSERT' then
    if new.status='recusada' or new.recusada_em is not null or new.recusada_por is not null or new.motivo_recusa is not null then raise exception 'RECUSA_SOMENTE_PELA_RPC'; end if;
  else
    if old.status='recusada' then raise exception 'SOLICITACAO_RECUSADA_IMUTAVEL'; end if;
    if (new.status='recusada' or new.recusada_em is distinct from old.recusada_em or new.recusada_por is distinct from old.recusada_por or new.motivo_recusa is distinct from old.motivo_recusa) and not v_rpc then raise exception 'RECUSA_SOMENTE_PELA_RPC'; end if;
  end if;
  if new.solicitacao_origem_id is not null and (tg_op='INSERT' or new.solicitacao_origem_id is distinct from old.solicitacao_origem_id) then
    select * into v_origem from public.ro_passagem_solicitacoes where id=new.solicitacao_origem_id;
    if not found or v_origem.status<>'recusada' or v_origem.solicitante_id is distinct from auth.uid() or new.solicitante_id is distinct from auth.uid() then raise exception 'SOLICITACAO_ORIGEM_INVALIDA'; end if;
  end if;
  return new;
end $$;
drop trigger if exists ro_proteger_recusa_terminal on public.ro_passagem_solicitacoes;
create trigger ro_proteger_recusa_terminal before insert or update on public.ro_passagem_solicitacoes for each row execute function public.ro_proteger_recusa_terminal();

create or replace function public.ro_bloquear_filho_solicitacao_recusada()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid:=coalesce(new.solicitacao_id,old.solicitacao_id);
begin
  if exists(select 1 from public.ro_passagem_solicitacoes s where s.id=v_id and s.status='recusada') then raise exception 'SOLICITACAO_RECUSADA_IMUTAVEL'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists ro_bloquear_custo_recusada on public.ro_passagem_custos;
create trigger ro_bloquear_custo_recusada before insert or update or delete on public.ro_passagem_custos for each row execute function public.ro_bloquear_filho_solicitacao_recusada();
drop trigger if exists ro_bloquear_anexo_recusada on public.ro_passagem_anexos;
create trigger ro_bloquear_anexo_recusada before insert or update or delete on public.ro_passagem_anexos for each row execute function public.ro_bloquear_filho_solicitacao_recusada();

drop policy if exists ro_storage_delete on storage.objects;
create policy ro_storage_delete on storage.objects for delete to authenticated using(
  bucket_id='ro-passagem-anexos' and public.ro_can_operate()
  and exists(select 1 from public.ro_passagem_solicitacoes s where s.id::text=(storage.foldername(name))[1] and s.status<>'recusada')
);

create or replace function public.ro_recusar_solicitacao(p_solicitacao_id uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype; v_motivo text:=trim(coalesce(p_motivo,''));
begin
  if auth.uid() is null then raise exception 'NAO_AUTENTICADO'; end if;
  if not public.ro_is_operador_ativo(auth.uid()) then raise exception 'NAO_PERTENCE_EQUIPE_RO'; end if;
  if length(v_motivo)<10 then raise exception 'MOTIVO_RECUSA_OBRIGATORIO'; end if;
  select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA'; end if;
  if v_sol.status='recusada' then raise exception 'SOLICITACAO_JA_RECUSADA'; end if;
  if public.ro_solicitacao_foi_comprada(p_solicitacao_id) then raise exception 'PASSAGEM_JA_COMPRADA'; end if;
  if v_sol.status not in ('solicitada','em_andamento') then raise exception 'STATUS_NAO_PERMITE_RECUSA'; end if;
  perform set_config('ro.recusa_rpc','1',true);
  update public.ro_passagem_solicitacoes set status='recusada',recusada_em=now(),recusada_por=auth.uid(),motivo_recusa=v_motivo where id=p_solicitacao_id;
  insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
  values(p_solicitacao_id,v_sol.status,'recusada','Solicitação recusada pela equipe RO. Motivo: '||v_motivo,auth.uid());
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  values('solicitacao_recusada',p_solicitacao_id,jsonb_build_object('status_anterior',v_sol.status,'motivo',v_motivo,'sem_compra',true),auth.uid());
  insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem)
  select p_solicitacao_id,'interno','solicitante',v_sol.solicitante_id::text,'Sua solicitação foi recusada. Consulte o motivo no Portal e faça uma nova solicitação com os dados corrigidos.'
  where not exists(select 1 from public.ro_passagem_notificacoes n where n.solicitacao_id=p_solicitacao_id and n.canal='interno' and n.destinatario_tipo='solicitante' and n.destinatario=v_sol.solicitante_id::text and n.mensagem='Sua solicitação foi recusada. Consulte o motivo no Portal e faça uma nova solicitação com os dados corrigidos.');
  return jsonb_build_object('id',p_solicitacao_id,'status','recusada');
end $$;

create or replace function public.ro_obter_dados_para_refazer_solicitacao(p_solicitacao_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'NAO_AUTENTICADO'; end if;
  select jsonb_build_object('solicitacao_origem_id',s.id,'funcionario_id',s.funcionario_id,'obra_id',s.obra_id,'origem',s.origem,'destino',s.destino,'motivo',s.motivo,'desligamento_subtipo',s.desligamento_subtipo,'data_ida',s.data_ida,'data_retorno',s.data_retorno,'centro_custo_retorno_id',s.centro_custo_retorno_id,'retorno_indefinido',s.retorno_indefinido,'centro_custo_destino_id',s.centro_custo_destino_id,'observacoes_solicitante',s.observacoes_solicitante)
  into v_result from public.ro_passagem_solicitacoes s where s.id=p_solicitacao_id and s.solicitante_id=auth.uid() and s.status='recusada';
  if v_result is null then raise exception 'PREFILL_NAO_AUTORIZADO'; end if;
  return v_result;
end $$;

create or replace function public.ro_auditar_solicitacao_refeita()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.solicitacao_origem_id is not null then
    insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('solicitacao_refeita',new.id,jsonb_build_object('solicitacao_origem_id',new.solicitacao_origem_id),auth.uid());
    insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('nova_solicitacao_criada_a_partir_da_recusa',new.solicitacao_origem_id,jsonb_build_object('nova_solicitacao_id',new.id),auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists ro_auditar_solicitacao_refeita on public.ro_passagem_solicitacoes;
create trigger ro_auditar_solicitacao_refeita after insert on public.ro_passagem_solicitacoes for each row execute function public.ro_auditar_solicitacao_refeita();

-- A RPC atual continua revalidando integralmente a nova solicitação e passa a persistir o vínculo validado pelo trigger.
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
    insert into public.ro_passagem_documentos_internos(id,solicitacao_id,categoria,storage_path,arquivo_nome,mime_type,tamanho_bytes,created_by) values(gen_random_uuid(),v_id,v_doc->>'categoria',v_doc->>'storage_path',v_doc->>'arquivo_nome','application/pdf',(v_obj.metadata->>'size')::bigint,auth.uid());
  end loop;
  insert into public.ro_passagem_solicitacoes(id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,primeiro_embarque_em,data_retorno,centro_custo_retorno_id,retorno_indefinido,centro_custo_destino_id,desligamento_subtipo,prazo_excecao_justificativa,justificativa_excecao_prazo,observacoes_solicitante,solicitacao_origem_id)
  values(v_id,(p_solicitacao->>'funcionario_id')::uuid,nullif(p_solicitacao->>'obra_id','')::uuid,auth.uid(),p_solicitacao->>'origem',p_solicitacao->>'destino',nullif(p_solicitacao->>'motivo',''),nullif(p_solicitacao->>'data_ida','')::date,null,nullif(p_solicitacao->>'data_retorno','')::date,nullif(p_solicitacao->>'centro_custo_retorno_id','')::uuid,coalesce((p_solicitacao->>'retorno_indefinido')::boolean,false),nullif(p_solicitacao->>'centro_custo_destino_id','')::uuid,nullif(p_solicitacao->>'desligamento_subtipo',''),v_justificativa,v_justificativa,nullif(p_solicitacao->>'observacoes_solicitante',''),nullif(p_solicitacao->>'solicitacao_origem_id','')::uuid);
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) select 'solicitacao_validada',v_id,jsonb_build_object('regra',s.prazo_regra_codigo,'tipo',s.prazo_tipo,'quantidade',s.prazo_quantidade,'data_minima',s.data_minima_permitida,'data_ida',s.data_ida,'excecao',s.prazo_excecao),auth.uid() from public.ro_passagem_solicitacoes s where s.id=v_id;
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) select 'documento_interno_anexado',v_id,jsonb_build_object('categoria',d.categoria),auth.uid() from public.ro_passagem_documentos_internos d where d.solicitacao_id=v_id;
  return v_id;
end $$;

revoke all on function public.ro_is_operador_ativo(uuid),public.ro_solicitacao_foi_comprada(uuid),public.ro_proteger_recusa_terminal(),public.ro_bloquear_filho_solicitacao_recusada(),public.ro_recusar_solicitacao(uuid,text),public.ro_obter_dados_para_refazer_solicitacao(uuid),public.ro_auditar_solicitacao_refeita(),public.ro_criar_solicitacao_validada(jsonb,jsonb) from public,anon;
grant execute on function public.ro_is_operador_ativo(uuid),public.ro_solicitacao_foi_comprada(uuid),public.ro_recusar_solicitacao(uuid,text),public.ro_obter_dados_para_refazer_solicitacao(uuid),public.ro_criar_solicitacao_validada(jsonb,jsonb) to authenticated;

-- 202608050003_controle_ciclo_folga_campo.sql
alter table public.ro_passagem_solicitacoes
  add column if not exists folga_data_prevista_ciclo date,
  add column if not exists folga_ciclo_anterior_id uuid references public.ro_passagem_solicitacoes(id) on delete restrict,
  add column if not exists folga_antecipada boolean not null default false,
  add column if not exists folga_antecipacao_justificativa text,
  add column if not exists folga_antecipacao_status text,
  add column if not exists folga_antecipacao_analisada_por uuid references auth.users(id) on delete restrict,
  add column if not exists folga_antecipacao_analisada_em timestamptz;
alter table public.ro_passagem_solicitacoes drop constraint if exists ro_folga_antecipacao_status_ck;
alter table public.ro_passagem_solicitacoes add constraint ro_folga_antecipacao_status_ck check(folga_antecipacao_status is null or folga_antecipacao_status in ('nao_aplicavel','pendente','aprovada','recusada'));
alter table public.ro_passagem_solicitacoes drop constraint if exists ro_folga_ciclo_anterior_diferente_ck;
alter table public.ro_passagem_solicitacoes add constraint ro_folga_ciclo_anterior_diferente_ck check(folga_ciclo_anterior_id is null or folga_ciclo_anterior_id<>id);
alter table public.ro_passagem_solicitacoes drop constraint if exists ro_folga_campos_coerentes_ck;
alter table public.ro_passagem_solicitacoes add constraint ro_folga_campos_coerentes_ck check(
  (motivo='folga_campo' and folga_data_prevista_ciclo is not null and folga_antecipacao_status is not null
   and (not folga_antecipada or length(trim(folga_antecipacao_justificativa))>=10))
  or (motivo is distinct from 'folga_campo' and folga_data_prevista_ciclo is null and folga_ciclo_anterior_id is null and not folga_antecipada and folga_antecipacao_justificativa is null and folga_antecipacao_status is null and folga_antecipacao_analisada_por is null and folga_antecipacao_analisada_em is null)
) not valid;
create index if not exists ro_folga_funcionario_data_idx on public.ro_passagem_solicitacoes(funcionario_id,data_ida desc) where motivo='folga_campo';
create index if not exists ro_folga_ciclo_anterior_idx on public.ro_passagem_solicitacoes(folga_ciclo_anterior_id) where folga_ciclo_anterior_id is not null;
create index if not exists ro_folga_antecipacao_status_idx on public.ro_passagem_solicitacoes(folga_antecipacao_status) where folga_antecipacao_status in ('pendente','aprovada');

create or replace function public.ro_funcionario_possui_folga_futura_ativa(p_funcionario_id uuid,p_ignorar_solicitacao_id uuid default null)
returns uuid language sql stable security definer set search_path=public,pg_temp as $$
 select s.id from public.ro_passagem_solicitacoes s where s.funcionario_id=p_funcionario_id and s.motivo='folga_campo' and s.id is distinct from p_ignorar_solicitacao_id and s.data_ida>=(now() at time zone 'America/Sao_Paulo')::date and (s.status in ('solicitada','em_andamento','passagem_comprada') or s.folga_antecipacao_status in ('pendente','aprovada')) order by s.data_ida,s.created_at limit 1;
$$;

create or replace function public.ro_obter_ciclo_folga_funcionario(p_funcionario_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_ultima public.ro_passagem_solicitacoes%rowtype; v_futura public.ro_passagem_solicitacoes%rowtype; v_proxima date;
begin
  if auth.uid() is null then raise exception 'NAO_AUTENTICADO'; end if;
  select * into v_ultima from public.ro_passagem_solicitacoes s where s.funcionario_id=p_funcionario_id and s.motivo='folga_campo' and s.status='finalizada' and s.data_ida<=(now() at time zone 'America/Sao_Paulo')::date order by coalesce(s.folga_data_prevista_ciclo,s.data_ida) desc,s.data_ida desc limit 1;
  if found then v_proxima:=coalesce(v_ultima.folga_data_prevista_ciclo,v_ultima.data_ida)+90; end if;
  select * into v_futura from public.ro_passagem_solicitacoes s where s.id=public.ro_funcionario_possui_folga_futura_ativa(p_funcionario_id,null);
  return jsonb_build_object('possui_historico',v_ultima.id is not null,'ultima_solicitacao_id',v_ultima.id,'ultima_folga_realizada',v_ultima.data_ida,'ultima_data_prevista_ciclo',v_ultima.folga_data_prevista_ciclo,'proxima_folga_prevista',v_proxima,'data_limite_recomendada',v_proxima-15,'solicitacao_futura_existente_id',v_futura.id,'solicitacao_futura_data',v_futura.data_ida,'solicitacao_futura_status',v_futura.status);
end $$;

create or replace function public.ro_validar_ciclo_folga_campo()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ciclo jsonb; v_proxima date; v_anterior uuid; v_duplicada uuid; v_aprovada boolean:=old.folga_antecipacao_status='aprovada';
begin
  if new.motivo is distinct from 'folga_campo' then new.folga_data_prevista_ciclo:=null;new.folga_ciclo_anterior_id:=null;new.folga_antecipada:=false;new.folga_antecipacao_justificativa:=null;new.folga_antecipacao_status:=null;new.folga_antecipacao_analisada_por:=null;new.folga_antecipacao_analisada_em:=null;return new;end if;
  perform pg_advisory_xact_lock(hashtextextended(new.funcionario_id::text,904));
  v_duplicada:=public.ro_funcionario_possui_folga_futura_ativa(new.funcionario_id,new.id);
  if v_duplicada is not null and (tg_op='INSERT' or new.funcionario_id is distinct from old.funcionario_id or new.data_ida is distinct from old.data_ida) then raise exception 'FOLGA_FUTURA_DUPLICADA:%',v_duplicada;end if;
  v_ciclo:=public.ro_obter_ciclo_folga_funcionario(new.funcionario_id);v_proxima:=nullif(v_ciclo->>'proxima_folga_prevista','')::date;v_anterior:=nullif(v_ciclo->>'ultima_solicitacao_id','')::uuid;
  new.folga_data_prevista_ciclo:=coalesce(v_proxima,new.data_ida);new.folga_ciclo_anterior_id:=v_anterior;
  if v_proxima is not null and new.data_ida<v_proxima then
    new.folga_antecipada:=true;
    if length(trim(coalesce(new.folga_antecipacao_justificativa,'')))<10 then raise exception 'JUSTIFICATIVA_ANTECIPACAO_OBRIGATORIA';end if;
    if tg_op='INSERT' or new.funcionario_id is distinct from old.funcionario_id or new.data_ida is distinct from old.data_ida or new.folga_antecipacao_justificativa is distinct from old.folga_antecipacao_justificativa then new.folga_antecipacao_status:='pendente';new.folga_antecipacao_analisada_por:=null;new.folga_antecipacao_analisada_em:=null;if tg_op='UPDATE' and v_aprovada then insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('aprovacao_antecipacao_invalidada',new.id,jsonb_build_object('data_ida',new.data_ida),auth.uid());end if;end if;
  else new.folga_antecipada:=false;new.folga_antecipacao_justificativa:=null;new.folga_antecipacao_status:='nao_aplicavel';new.folga_antecipacao_analisada_por:=null;new.folga_antecipacao_analisada_em:=null;end if;
  if new.status='recusada' and new.folga_antecipada then new.folga_antecipacao_status:='recusada';end if;
  return new;
end $$;
drop trigger if exists ro_validar_ciclo_folga_campo on public.ro_passagem_solicitacoes;
create trigger ro_validar_ciclo_folga_campo before insert or update of funcionario_id,motivo,data_ida,status,folga_antecipacao_justificativa on public.ro_passagem_solicitacoes for each row execute function public.ro_validar_ciclo_folga_campo();
create or replace function public.ro_proteger_aprovacao_antecipacao()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if (new.folga_antecipacao_status is distinct from old.folga_antecipacao_status or new.folga_antecipacao_analisada_por is distinct from old.folga_antecipacao_analisada_por or new.folga_antecipacao_analisada_em is distinct from old.folga_antecipacao_analisada_em) and coalesce(current_setting('ro.folga_aprovacao_rpc',true),'')<>'1' and not (old.status is distinct from new.status or old.funcionario_id is distinct from new.funcionario_id or old.motivo is distinct from new.motivo or old.data_ida is distinct from new.data_ida or old.folga_antecipacao_justificativa is distinct from new.folga_antecipacao_justificativa) then raise exception 'APROVACAO_ANTECIPACAO_SOMENTE_PELA_RPC';end if;return new;end $$;
drop trigger if exists ro_proteger_aprovacao_antecipacao on public.ro_passagem_solicitacoes;
create trigger ro_proteger_aprovacao_antecipacao before update on public.ro_passagem_solicitacoes for each row execute function public.ro_proteger_aprovacao_antecipacao();
create or replace function public.ro_auditar_ciclo_folga_campo()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if new.motivo='folga_campo' and tg_op='INSERT' then insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('ciclo_folga_calculado',new.id,jsonb_build_object('sem_historico',new.folga_ciclo_anterior_id is null,'ciclo_anterior_id',new.folga_ciclo_anterior_id,'data_prevista',new.folga_data_prevista_ciclo,'data_ida',new.data_ida,'antecipada',new.folga_antecipada,'justificativa',new.folga_antecipacao_justificativa),auth.uid());elsif new.motivo='folga_campo' and old.status is distinct from 'finalizada' and new.status='finalizada' then insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('ciclo_folga_avancado',new.id,jsonb_build_object('ancora',new.folga_data_prevista_ciclo,'proxima_prevista',new.folga_data_prevista_ciclo+90),auth.uid());end if;return new;end $$;
drop trigger if exists ro_auditar_ciclo_folga_campo on public.ro_passagem_solicitacoes;
create trigger ro_auditar_ciclo_folga_campo after insert or update of status on public.ro_passagem_solicitacoes for each row execute function public.ro_auditar_ciclo_folga_campo();

create or replace function public.ro_bloquear_compra_antecipacao_pendente()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;v_id uuid;
begin
 if tg_table_name='ro_passagem_solicitacoes' then if old.folga_antecipacao_status='pendente' and (new.status='passagem_comprada' or new.comprado_em is not null or new.comprado_por is not null) then raise exception 'ANTECIPACAO_FOLGA_PENDENTE';end if;return new;end if;
 v_id:=coalesce(new.solicitacao_id,old.solicitacao_id);select folga_antecipacao_status into v_status from public.ro_passagem_solicitacoes where id=v_id;if v_status='pendente' then raise exception 'ANTECIPACAO_FOLGA_PENDENTE';end if;return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists ro_bloquear_compra_folga_pendente on public.ro_passagem_solicitacoes;
create trigger ro_bloquear_compra_folga_pendente before update on public.ro_passagem_solicitacoes for each row execute function public.ro_bloquear_compra_antecipacao_pendente();
drop trigger if exists ro_bloquear_custo_folga_pendente on public.ro_passagem_custos;
create trigger ro_bloquear_custo_folga_pendente before insert or update on public.ro_passagem_custos for each row execute function public.ro_bloquear_compra_antecipacao_pendente();
drop trigger if exists ro_bloquear_anexo_folga_pendente on public.ro_passagem_anexos;
create trigger ro_bloquear_anexo_folga_pendente before insert or update on public.ro_passagem_anexos for each row execute function public.ro_bloquear_compra_antecipacao_pendente();
drop policy if exists ro_storage_insert on storage.objects;
create policy ro_storage_insert on storage.objects for insert to authenticated with check(bucket_id='ro-passagem-anexos' and public.ro_can_operate() and exists(select 1 from public.ro_passagem_solicitacoes s where s.id::text=(storage.foldername(name))[1] and s.status in ('solicitada','em_andamento') and s.folga_antecipacao_status is distinct from 'pendente'));

create or replace function public.ro_aprovar_antecipacao_folga(p_solicitacao_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;
begin
 if auth.uid() is null then raise exception 'NAO_AUTENTICADO';end if;if not public.ro_is_operador_ativo(auth.uid()) then raise exception 'NAO_PERTENCE_EQUIPE_RO';end if;
 select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
 if v_sol.motivo<>'folga_campo' or not v_sol.folga_antecipada or v_sol.folga_antecipacao_status<>'pendente' then raise exception 'ANTECIPACAO_NAO_PENDENTE';end if;if public.ro_solicitacao_foi_comprada(p_solicitacao_id) then raise exception 'PASSAGEM_JA_COMPRADA';end if;if v_sol.status not in ('solicitada','em_andamento') then raise exception 'STATUS_NAO_PERMITE_APROVACAO';end if;
 perform set_config('ro.folga_aprovacao_rpc','1',true);update public.ro_passagem_solicitacoes set folga_antecipacao_status='aprovada',folga_antecipacao_analisada_por=auth.uid(),folga_antecipacao_analisada_em=now() where id=p_solicitacao_id;
 insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('antecipacao_folga_aprovada',p_solicitacao_id,jsonb_build_object('data_prevista',v_sol.folga_data_prevista_ciclo,'data_ida',v_sol.data_ida),auth.uid());
 insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem) select p_solicitacao_id,'interno','solicitante',v_sol.solicitante_id::text,'A antecipação da folga de campo foi aprovada pela equipe RO.' where not exists(select 1 from public.ro_passagem_notificacoes n where n.solicitacao_id=p_solicitacao_id and n.destinatario=v_sol.solicitante_id::text and n.mensagem='A antecipação da folga de campo foi aprovada pela equipe RO.');
 return jsonb_build_object('id',p_solicitacao_id,'folga_antecipacao_status','aprovada');
end $$;

-- Complementa a recusa: o trigger marca a análise da antecipação como recusada.
create or replace function public.ro_recusar_solicitacao(p_solicitacao_id uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;v_motivo text:=trim(coalesce(p_motivo,''));
begin
 if auth.uid() is null then raise exception 'NAO_AUTENTICADO';end if;if not public.ro_is_operador_ativo(auth.uid()) then raise exception 'NAO_PERTENCE_EQUIPE_RO';end if;if length(v_motivo)<10 then raise exception 'MOTIVO_RECUSA_OBRIGATORIO';end if;
 select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;if v_sol.status='recusada' then raise exception 'SOLICITACAO_JA_RECUSADA';end if;if public.ro_solicitacao_foi_comprada(p_solicitacao_id) then raise exception 'PASSAGEM_JA_COMPRADA';end if;if v_sol.status not in ('solicitada','em_andamento') then raise exception 'STATUS_NAO_PERMITE_RECUSA';end if;
 perform set_config('ro.recusa_rpc','1',true);update public.ro_passagem_solicitacoes set status='recusada',recusada_em=now(),recusada_por=auth.uid(),motivo_recusa=v_motivo where id=p_solicitacao_id;
 insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por) values(p_solicitacao_id,v_sol.status,'recusada','Solicitação recusada pela equipe RO.'||case when v_sol.folga_antecipada then ' A solicitação envolvia antecipação de folga de campo.' else '' end||' Motivo: '||v_motivo,auth.uid());
 insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('solicitacao_recusada',p_solicitacao_id,jsonb_build_object('status_anterior',v_sol.status,'motivo',v_motivo,'sem_compra',true,'antecipacao_folga',v_sol.folga_antecipada),auth.uid());
 insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem) select p_solicitacao_id,'interno','solicitante',v_sol.solicitante_id::text,'Sua solicitação foi recusada. Consulte o motivo no Portal e faça uma nova solicitação com os dados corrigidos.' where not exists(select 1 from public.ro_passagem_notificacoes n where n.solicitacao_id=p_solicitacao_id and n.destinatario=v_sol.solicitante_id::text and n.mensagem='Sua solicitação foi recusada. Consulte o motivo no Portal e faça uma nova solicitação com os dados corrigidos.');return jsonb_build_object('id',p_solicitacao_id,'status','recusada');
end $$;

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
    insert into public.ro_passagem_documentos_internos(id,solicitacao_id,categoria,storage_path,arquivo_nome,mime_type,tamanho_bytes,created_by) values(gen_random_uuid(),v_id,v_doc->>'categoria',v_doc->>'storage_path',v_doc->>'arquivo_nome','application/pdf',(v_obj.metadata->>'size')::bigint,auth.uid());
  end loop;
  insert into public.ro_passagem_solicitacoes(id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,primeiro_embarque_em,data_retorno,centro_custo_retorno_id,retorno_indefinido,centro_custo_destino_id,desligamento_subtipo,prazo_excecao_justificativa,justificativa_excecao_prazo,observacoes_solicitante,solicitacao_origem_id,folga_antecipacao_justificativa)
  values(v_id,(p_solicitacao->>'funcionario_id')::uuid,nullif(p_solicitacao->>'obra_id','')::uuid,auth.uid(),p_solicitacao->>'origem',p_solicitacao->>'destino',nullif(p_solicitacao->>'motivo',''),nullif(p_solicitacao->>'data_ida','')::date,null,nullif(p_solicitacao->>'data_retorno','')::date,nullif(p_solicitacao->>'centro_custo_retorno_id','')::uuid,coalesce((p_solicitacao->>'retorno_indefinido')::boolean,false),nullif(p_solicitacao->>'centro_custo_destino_id','')::uuid,nullif(p_solicitacao->>'desligamento_subtipo',''),v_justificativa,v_justificativa,nullif(p_solicitacao->>'observacoes_solicitante',''),nullif(p_solicitacao->>'solicitacao_origem_id','')::uuid,nullif(trim(p_solicitacao->>'folga_antecipacao_justificativa'),''));
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) select 'solicitacao_validada',v_id,jsonb_build_object('regra',s.prazo_regra_codigo,'tipo',s.prazo_tipo,'quantidade',s.prazo_quantidade,'data_minima',s.data_minima_permitida,'data_ida',s.data_ida,'excecao',s.prazo_excecao),auth.uid() from public.ro_passagem_solicitacoes s where s.id=v_id;
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) select 'documento_interno_anexado',v_id,jsonb_build_object('categoria',d.categoria),auth.uid() from public.ro_passagem_documentos_internos d where d.solicitacao_id=v_id;
  return v_id;
end $$;


revoke all on function public.ro_funcionario_possui_folga_futura_ativa(uuid,uuid),public.ro_obter_ciclo_folga_funcionario(uuid),public.ro_validar_ciclo_folga_campo(),public.ro_proteger_aprovacao_antecipacao(),public.ro_auditar_ciclo_folga_campo(),public.ro_bloquear_compra_antecipacao_pendente(),public.ro_aprovar_antecipacao_folga(uuid),public.ro_recusar_solicitacao(uuid,text),public.ro_criar_solicitacao_validada(jsonb,jsonb) from public,anon;
grant execute on function public.ro_obter_ciclo_folga_funcionario(uuid),public.ro_aprovar_antecipacao_folga(uuid) to authenticated;

rollback;

