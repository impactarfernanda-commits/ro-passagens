-- SOMENTE LEITURA. Não aplica migration nem altera dados.
with defs as (
  select
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_prazo_regra_efetiva(text,text,uuid)')),'') as regra,
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_data_minima_util(timestamptz,integer)')),'') as dias_uteis
), checks as (
  select
    regra like '%p_motivo=''admissao''%''dias_corridos''::text,7%' as admissao_regra_antiga,
    to_regprocedure('public.ro_data_minima_util(timestamptz,integer)') is not null as ro_data_minima_util_presente,
    to_regclass('public.ro_calendario_nao_util') is not null as ro_calendario_nao_util_presente,
    regra like '%p_motivo=''inicio_obra''%''dias_corridos''::text,4%' as inicio_obra_presente,
    regra like '%rh_desligamento_programado_outros''::text,''dias_corridos''::text,5%' as desligamento_presente,
    regra like '%rh_viagem_administrativa''::text,''sem_prazo_minimo''::text,0%' as viagem_administrativa_presente,
    regra not like '%p_motivo=''admissao''%''dias_uteis''::text,4%' as nova_regra_ainda_ausente,
    dias_uteis like '%ro_calendario_nao_util%' as calendario_consumido_pelo_helper
  from defs
)
select *,
  admissao_regra_antiga
  and ro_data_minima_util_presente
  and ro_calendario_nao_util_presente
  and inicio_obra_presente
  and desligamento_presente
  and viagem_administrativa_presente
  and nova_regra_ainda_ausente
  and calendario_consumido_pelo_helper as pronto_para_dry_run
from checks;
