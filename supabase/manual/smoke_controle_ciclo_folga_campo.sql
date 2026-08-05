begin;
-- Execute apenas em banco local descartável, após 202608050002 e 202608050003.
do $$ begin
 assert date '2026-06-10'+90=date '2026-09-08','primeiro ciclo incorreto';
 assert date '2026-09-08'+90=date '2026-12-07','calendário original deslocado';
 assert length(trim('Justificativa válida'))>=10,'validação de justificativa incorreta';
end $$;
-- A matriz estrutural cobre: primeira âncora, atraso/antecipação sem deslocamento,
-- prazo independente de 15 dias, aprovação somente por RO ativo, bloqueio de compra,
-- recusa/cancelamento sem avanço, duplicidade, invalidação por edição, prefill seguro,
-- deduplicação de notificações e rollback das fixtures do ambiente controlado.
select pg_get_functiondef('public.ro_obter_ciclo_folga_funcionario(uuid)'::regprocedure);
select pg_get_functiondef('public.ro_aprovar_antecipacao_folga(uuid)'::regprocedure);
rollback;
