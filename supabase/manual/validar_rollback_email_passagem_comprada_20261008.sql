-- Somente leitura: estado esperado após reverter exclusivamente esta fase.
with eventos as (
  select pg_get_constraintdef(c.oid) definicao
  from pg_constraint c
  where c.conrelid='public.ro_email_outbox'::regclass
    and c.conname='ro_email_outbox_tipo_evento_check'
)
select
  to_regclass('public.ro_email_outbox') is not null as outbox_preservada,
  to_regprocedure('public.ro_enfileirar_aprovacao_pendente()') is not null as aprovacao_pendente_preservada,
  to_regprocedure('public.ro_enfileirar_resultado_aprovacao()') is not null as resultado_aprovacao_preservado,
  to_regprocedure('public.ro_recusar_solicitacao(uuid,text)') is not null as recusa_ro_preservada,
  to_regprocedure('public.ro_enfileirar_passagem_comprada()') is null as trigger_compra_revertido,
  position('passagem_comprada' in definicao)=0 as evento_compra_revertido
from eventos;
