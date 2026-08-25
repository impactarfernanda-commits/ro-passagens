begin;

-- Reprovação do aprovador e recusa operacional do RO são estados distintos.
-- A reprovação mantém o status operacional atual e altera somente o fluxo de
-- aprovação, que já é protegido pelos triggers do Pacote 1.
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

  select *
  into v
  from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id
    and excluida_em is null
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

  if v.aprovacao_status<>'pendente'
     or v.status<>'solicitada' then
    raise exception 'APROVACAO_NAO_PENDENTE';
  end if;

  perform set_config('ro.aprovacao_rpc','1',true);

  update public.ro_passagem_solicitacoes
  set
    aprovacao_status='reprovada',
    reprovado_em=now(),
    motivo_reprovacao_aprovador=m
  where id=v.id;

  insert into public.ro_passagem_historico(
    solicitacao_id,
    status_anterior,
    status_novo,
    descricao,
    criado_por
  )
  values(
    v.id,
    v.status,
    v.status,
    'Solicitação reprovada pelo aprovador responsável. Motivo: '||m,
    auth.uid()
  );
end $$;

revoke all on function public.ro_reprovar_solicitacao(uuid,text)
from public,anon;

grant execute on function public.ro_reprovar_solicitacao(uuid,text)
to authenticated;

commit;
