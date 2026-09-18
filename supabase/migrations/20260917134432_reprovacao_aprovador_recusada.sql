begin;

alter table public.ro_passagem_solicitacoes
  drop constraint ro_recusa_consistencia;
alter table public.ro_passagem_solicitacoes
  add constraint ro_recusa_consistencia check (
    (status <> 'recusada'
      and recusada_em is null and recusada_por is null and motivo_recusa is null)
    or (status = 'recusada'
      and aprovacao_status is distinct from 'reprovada'
      and recusada_em is not null and recusada_por is not null
      and motivo_recusa is not null and length(btrim(motivo_recusa)) >= 10)
    or (status = 'recusada'
      and aprovacao_status = 'reprovada'
      and aprovador_id is not null and reprovado_em is not null
      and motivo_reprovacao_aprovador is not null
      and length(btrim(motivo_reprovacao_aprovador)) >= 10
      and recusada_em is null and recusada_por is null and motivo_recusa is null)
  );

create or replace function public.ro_proteger_recusa_terminal()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_origem public.ro_passagem_solicitacoes%rowtype;
  v_rpc boolean:=coalesce(current_setting('ro.recusa_rpc',true),'')='1'
    or coalesce(current_setting('ro.aprovacao_rpc',true),'')='1';
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

create or replace function public.ro_reprovar_solicitacao(
  p_solicitacao_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.ro_passagem_solicitacoes%rowtype;
  m text:=btrim(regexp_replace(coalesce(p_motivo,''),'\s+',' ','g'));
begin
  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;
  if char_length(m)<10 then
    raise exception 'MOTIVO_REPROVACAO_MINIMO_10_CARACTERES';
  end if;
  select * into v
  from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id and excluida_em is null
  for update;
  if not found then
    raise exception 'SOLICITACAO_NAO_ENCONTRADA';
  end if;
  if v.aprovador_id is distinct from auth.uid() then
    raise exception 'SOLICITACAO_NAO_DESTINADA_A_ESTE_APROVADOR';
  end if;
  if not public.ro_is_approval_candidate(auth.uid()) then
    raise exception 'APROVADOR_NAO_ELEGIVEL';
  end if;
  if v.aprovacao_status<>'pendente' or v.status<>'solicitada' then
    raise exception 'APROVACAO_NAO_PENDENTE';
  end if;
  perform set_config('ro.aprovacao_rpc','1',true);
  update public.ro_passagem_solicitacoes
  set status='recusada', aprovacao_status='reprovada',
      reprovado_em=now(), motivo_reprovacao_aprovador=m
  where id=v.id;
  insert into public.ro_passagem_historico(
    solicitacao_id,status_anterior,status_novo,descricao,criado_por
  ) values (
    v.id,v.status,'recusada',
    'Solicitação reprovada pelo aprovador responsável. Motivo: '||m,
    auth.uid()
  );
end $$;

commit;
