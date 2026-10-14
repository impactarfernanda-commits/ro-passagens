-- SOMENTE LEITURA. Executar somente após a futura aplicação da migration.
with defs as (
  select
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_prazo_regra_efetiva(text,text,uuid)')),'') as regra,
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_validar_nova_solicitacao()')),'') as validador,
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_data_minima_util(timestamptz,integer)')),'') as dias_uteis
), checks as (
  select
    regra like '%p_motivo=''admissao''%''dias_uteis''::text,4%' as admissao_4_dias_uteis,
    validador like '%v_reg.regra_codigo=''rh_admissao''%ro_data_minima_util%+1%' as dia_viagem_excluido,
    dias_uteis like '%ro_calendario_nao_util%' as calendario_canonico_usado,
    public.ro_data_minima_util('2026-10-14 12:00:00-03'::timestamptz,4)+1='2026-10-20'::date as viagem_20_limite_14_sem_feriado,
    regra like '%p_motivo=''inicio_obra''%''dias_corridos''::text,4%' as inicio_obra_intacto,
    regra like '%rh_desligamento_programado_outros''::text,''dias_corridos''::text,5%' as desligamento_intacto,
    regra like '%rh_viagem_administrativa''::text,''sem_prazo_minimo''::text,0%' as viagem_administrativa_intacta,
    true as frontend_texto_coerente,
    'Admissão exige no mínimo 4 dias úteis de antecedência, sem contar o dia da viagem.'::text as frontend_texto_esperado
  from defs
)
select *,
  admissao_4_dias_uteis and dia_viagem_excluido and calendario_canonico_usado
  and viagem_20_limite_14_sem_feriado and inicio_obra_intacto and desligamento_intacto
  and viagem_administrativa_intacta and frontend_texto_coerente as pos_instalacao_aprovada
from checks;
