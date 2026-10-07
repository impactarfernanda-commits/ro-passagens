-- READ-ONLY. Estado esperado após rollback controlado desta migration.
-- O rollback deve remover apenas o trigger/função novos e restaurar os checks
-- anteriores, sem remover a outbox nem o evento aprovacao_pendente.
with outbox_check as (
  select pg_get_constraintdef(c.oid,true) as definicao
  from pg_constraint c
  where c.conrelid='public.ro_email_outbox'::regclass
    and c.conname='ro_email_outbox_tipo_evento_check'
),
logs_check as (
  select pg_get_constraintdef(c.oid,true) as definicao
  from pg_constraint c
  where c.conrelid='public.ro_email_logs'::regclass
    and c.conname='ro_email_logs_tipo_evento_check'
)
select
  to_regclass('public.ro_email_outbox') is not null as outbox_preservada,
  to_regprocedure('public.ro_claim_email_outbox(text,integer,integer)') is not null
    as claim_preservado,
  to_regprocedure('public.ro_enfileirar_aprovacao_pendente()') is not null
    as evento_pendente_preservado,
  to_regprocedure('public.ro_enfileirar_resultado_aprovacao()') is null
    as funcao_nova_ausente,
  not exists (
    select 1 from pg_trigger
    where tgrelid='public.ro_passagem_solicitacoes'::regclass
      and tgname='ro_enfileirar_resultado_aprovacao' and not tgisinternal
  ) as trigger_novo_ausente,
  position('aprovacao_pendente' in o.definicao) > 0
    and position('solicitacao_aprovada' in o.definicao) = 0
    and position('solicitacao_reprovada' in o.definicao) = 0
    as check_outbox_restaurado,
  position('aprovacao_pendente' in l.definicao) > 0
    and position('solicitacao_aprovada' in l.definicao) = 0
    and position('solicitacao_reprovada' in l.definicao) = 0
    as check_logs_restaurado
from outbox_check o
cross join logs_check l;
