-- Somente leitura: valida o estado esperado após reverter exclusivamente esta fase.
with defs as (
  select
    pg_get_functiondef('public.ro_recusar_solicitacao(uuid,text)'::regprocedure) recusar,
    pg_get_constraintdef(c.oid) eventos
  from pg_constraint c
  where c.conrelid='public.ro_email_outbox'::regclass
    and c.conname='ro_email_outbox_tipo_evento_check'
)
select
  to_regclass('public.ro_email_outbox') is not null as outbox_preservada,
  to_regprocedure('public.ro_enfileirar_aprovacao_pendente()') is not null as aprovacao_pendente_preservada,
  to_regprocedure('public.ro_enfileirar_resultado_aprovacao()') is not null as resultado_aprovacao_preservado,
  position('solicitacao_recusada_ro' in eventos)=0 as evento_recusa_ro_revertido,
  position('solicitacao_recusada_ro' in recusar)=0 as rpc_recusa_ro_revertida,
  position('for update' in lower(recusar))>0 as protecao_recusa_preservada
from defs;
