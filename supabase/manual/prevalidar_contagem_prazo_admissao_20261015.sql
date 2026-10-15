-- SOMENTE LEITURA. Não aplica migration nem altera dados.
with defs as (
  select
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_prazo_regra_efetiva(text,text,uuid)')),'') as regra,
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_validar_nova_solicitacao()')),'') as validador,
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_data_minima_util(timestamptz,integer)')),'') as dias_uteis
), checks as (
  select
    regra ~ $re$p_motivo\s*=\s*'admissao'[\s\S]*'dias_uteis'::text\s*,\s*4$re$ as admissao_4_dias_uteis_instalada,
    validador ~ $re$if\s+v_reg\.regra_codigo\s*=\s*'rh_admissao'\s+then\s+v_min\s*:=\s*public\.ro_data_minima_util\([^;]*v_reg\.prazo_quantidade\)\s*\+\s*1\s*;$re$ as dia_viagem_excluido_na_regra_atual,
    to_regprocedure('public.ro_data_minima_util(timestamptz,integer)') is not null as ro_data_minima_util_presente,
    to_regclass('public.ro_calendario_nao_util') is not null as calendario_canonico_presente,
    dias_uteis like '%public.ro_calendario_nao_util%' as helper_usa_calendario_canonico,
    regra ~ $re$p_motivo\s*=\s*'inicio_obra'[\s\S]*'dias_corridos'::text\s*,\s*4$re$ as inicio_obra_preservado,
    regra ~ $re$rh_desligamento_programado_outros'::text\s*,\s*'dias_corridos'::text\s*,\s*5$re$ as desligamento_preservado,
    regra ~ $re$rh_viagem_administrativa'::text\s*,\s*'sem_prazo_minimo'::text\s*,\s*0$re$ as viagem_administrativa_preservada,
    validador !~ $re$if\s+v_reg\.regra_codigo\s*=\s*'rh_admissao'\s+then\s+v_min\s*:=\s*public\.ro_data_minima_util\([^;]*v_reg\.prazo_quantidade\)\s*;$re$ as nova_logica_inclusiva_ainda_ausente
  from defs
)
select *,
  admissao_4_dias_uteis_instalada
  and dia_viagem_excluido_na_regra_atual
  and ro_data_minima_util_presente
  and calendario_canonico_presente
  and helper_usa_calendario_canonico
  and inicio_obra_preservado
  and desligamento_preservado
  and viagem_administrativa_preservada
  and nova_logica_inclusiva_ainda_ausente as pronto_para_dry_run
from checks;
