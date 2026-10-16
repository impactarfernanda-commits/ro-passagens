-- Somente leitura. Execute antes do dry run da migration 202610150002.
with definicoes as (
  select
    pg_get_functiondef('public.ro_prazo_regra_efetiva(text,text,uuid)'::regprocedure) as regra,
    pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure) as validador,
    pg_get_functiondef('public.ro_data_minima_util(timestamptz,integer)'::regprocedure) as helper
), verificacoes as (
  select
    regra ~* $$p_motivo\s*=\s*'admissao'[\s\S]*?'rh_admissao'::text\s*,\s*'dias_uteis'::text\s*,\s*4$$ as admissao_4_dias_uteis_instalada,
    validador ~* $$regra_codigo\s*=\s*'rh_admissao'[\s\S]*?ro_data_minima_util\s*\(\s*\(\s*v_hoje\s*\+\s*time\s*'12:00'\s*\)\s*at\s+time\s+zone\s+'America/Sao_Paulo'\s*,\s*v_reg\.prazo_quantidade\s*\)$$
      and validador !~* $$ro_data_minima_util\s*\([^;]+v_reg\.prazo_quantidade\s*\)\s*\+\s*1$$ as dia_viagem_conta,
    validador ~* $$regra_codigo\s*=\s*'rh_admissao'[\s\S]*?ro_data_minima_util\s*\(\s*\(\s*v_hoje\s*\+\s*time\s*'12:00'$$ as backend_ainda_usa_meio_dia,
    to_regprocedure('public.ro_data_minima_util(timestamptz,integer)') is not null as ro_data_minima_util_presente,
    helper ~* $$extract\s*\(\s*isodow\s+from\s+v_data\s*\)\s*<\s*5[\s\S]*?v_local::time\s*>\s*time\s*'16:30'$$ as corte_segunda_quinta_1630_presente,
    helper ~* $$extract\s*\(\s*isodow\s+from\s+v_data\s*\)\s*=\s*5[\s\S]*?v_local::time\s*>\s*time\s*'15:30'$$ as corte_sexta_1530_presente,
    to_regclass('public.ro_calendario_nao_util') is not null
      and helper ~* $$from\s+public\.ro_calendario_nao_util[\s\S]*?c\.data\s*=\s*v_data[\s\S]*?c\.ativo$$ as calendario_canonico_presente,
    regra ~* $$p_motivo\s*=\s*'inicio_obra'[\s\S]*?'rh_inicio_obra'::text\s*,\s*'dias_corridos'::text\s*,\s*4$$ as inicio_obra_preservado,
    regra ~* $$p_motivo\s*=\s*'desligamento'[\s\S]*?p_subtipo\s*=\s*'programado_outros'[\s\S]*?'dias_corridos'::text\s*,\s*5$$ as desligamento_preservado,
    regra ~* $$p_motivo\s*=\s*'viagem_administrativa'[\s\S]*?'sem_prazo_minimo'::text\s*,\s*0$$ as viagem_administrativa_preservada,
    validador !~* $$if\s+v_reg\.regra_codigo\s*=\s*'rh_admissao'\s+then\s+v_min\s*:=\s*public\.ro_data_minima_util\s*\(\s*now\s*\(\s*\)\s*,\s*v_reg\.prazo_quantidade\s*\)\s*;\s*else$$ as nova_regra_com_now_ainda_ausente
  from definicoes
)
select *,
  admissao_4_dias_uteis_instalada and dia_viagem_conta and backend_ainda_usa_meio_dia
  and ro_data_minima_util_presente and corte_segunda_quinta_1630_presente
  and corte_sexta_1530_presente and calendario_canonico_presente
  and inicio_obra_preservado and desligamento_preservado
  and viagem_administrativa_preservada and nova_regra_com_now_ainda_ausente
  as pronto_para_dry_run
from verificacoes;
