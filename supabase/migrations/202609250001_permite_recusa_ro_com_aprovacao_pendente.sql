begin;

create or replace function public.ro_bloquear_operacao_sem_aprovacao()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_aprovacao_rpc boolean:=coalesce(current_setting('ro.aprovacao_rpc',true),'')='1';
  v_recusa_terminal_ro boolean:=
    coalesce(current_setting('ro.recusa_rpc',true),'')='1'
    and old.status in ('solicitada','em_andamento')
    and new.status='recusada'
    and new.recusada_em is not null
    and new.recusada_por=auth.uid()
    and length(btrim(coalesce(new.motivo_recusa,'')))>=10
    and (
      to_jsonb(new)-array['status','recusada_em','recusada_por','motivo_recusa']::text[]
    )=(
      to_jsonb(old)-array['status','recusada_em','recusada_por','motivo_recusa']::text[]
    );
begin
  if old.aprovacao_status='pendente'
     and (
       new.status is distinct from old.status
       or new.comprado_em is distinct from old.comprado_em
       or new.responsavel_ro_id is distinct from old.responsavel_ro_id
       or new.excluida_em is distinct from old.excluida_em
     )
     and not v_aprovacao_rpc
     and not v_recusa_terminal_ro
  then
    raise exception 'SOLICITACAO_AGUARDANDO_APROVACAO';
  end if;

  return new;
end $$;

commit;
