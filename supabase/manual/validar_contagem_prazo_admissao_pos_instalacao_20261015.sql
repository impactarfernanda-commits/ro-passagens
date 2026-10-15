-- SOMENTE LEITURA. Executar somente após a futura aplicação da migration.
with defs as (
  select
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_prazo_regra_efetiva(text,text,uuid)')),'') as regra,
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_validar_nova_solicitacao()')),'') as validador,
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_data_minima_util(timestamptz,integer)')),'') as dias_uteis
), checks as (
  select
    regra ~ $re$p_motivo\s*=\s*'admissao'[\s\S]*'dias_uteis'::text\s*,\s*4$re$ as admissao_4_dias_uteis,
    validador ~ $re$v_reg\.regra_codigo\s*=\s*'rh_admissao'[\s\S]*ro_data_minima_util\([\s\S]*v_reg\.prazo_quantidade\)\s*;$re$ as dia_viagem_conta,
    validador !~ $re$ro_data_minima_util\([\s\S]*v_reg\.prazo_quantidade\)\s*\+\s*1$re$ as deslocamento_excludente_removido,
    dias_uteis like '%public.ro_calendario_nao_util%' as calendario_canonico_usado,
    public.ro_data_minima_util('2026-10-15 12:00:00-03'::timestamptz,2)='2026-10-16'::date
      and public.ro_data_minima_util('2026-10-15 12:00:00-03'::timestamptz,3)='2026-10-19'::date
      and public.ro_data_minima_util('2026-10-15 12:00:00-03'::timestamptz,4)='2026-10-20'::date as fim_semana_ignorado,
    public.ro_data_minima_util('2026-10-15 12:00:00-03'::timestamptz,4)='2026-10-20'::date as viagem_20_limite_15_sem_feriado,
    public.ro_data_minima_util('2026-10-14 12:00:00-03'::timestamptz,4)='2026-10-19'::date as sabado_domingo_nao_contam,
    regra ~ $re$p_motivo\s*=\s*'inicio_obra'[\s\S]*'dias_corridos'::text\s*,\s*4$re$ as inicio_obra_intacto,
    regra ~ $re$rh_desligamento_programado_outros'::text\s*,\s*'dias_corridos'::text\s*,\s*5$re$ as desligamento_intacto,
    regra ~ $re$rh_viagem_administrativa'::text\s*,\s*'sem_prazo_minimo'::text\s*,\s*0$re$ as viagem_administrativa_intacta,
    'Admissão exige no mínimo 4 dias úteis de antecedência, contando o dia da viagem.'::text as frontend_texto_esperado
  from defs
)
select *,
  admissao_4_dias_uteis and dia_viagem_conta and deslocamento_excludente_removido
  and calendario_canonico_usado and fim_semana_ignorado
  and viagem_20_limite_15_sem_feriado and sabado_domingo_nao_contam
  and inicio_obra_intacto and desligamento_intacto and viagem_administrativa_intacta
  as pos_instalacao_aprovada
from checks;
