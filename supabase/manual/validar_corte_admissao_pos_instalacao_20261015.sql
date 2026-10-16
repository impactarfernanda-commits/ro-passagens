-- Somente leitura. Execute após a futura aplicação da migration 202610150002.
with definicoes as (
  select
    pg_get_functiondef('public.ro_prazo_regra_efetiva(text,text,uuid)'::regprocedure) as regra,
    pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure) as validador,
    pg_get_functiondef('public.ro_data_minima_util(timestamptz,integer)'::regprocedure) as helper
), verificacoes as (
  select
    validador ~* $$if\s+v_reg\.prazo_tipo\s*=\s*'dias_uteis'\s+then\s+v_min\s*:=\s*public\.ro_data_minima_util\s*\(\s*now\s*\(\s*\)\s*,\s*v_reg\.prazo_quantidade\s*\)$$ as admissao_usa_now,
    validador !~* $$ro_data_minima_util\s*\(\s*\(\s*v_hoje\s*\+\s*time\s*'12:00'$$ as meio_dia_artificial_removido,
    helper ~* $$p_agora\s+at\s+time\s+zone\s+'America/Sao_Paulo'$$
      and helper ~* $$from\s+public\.ro_calendario_nao_util$$ as helper_canonico,
    helper ~* $$v_local::time\s*>\s*time\s*'16:30'$$ as corte_segunda_quinta_1630,
    helper ~* $$v_local::time\s*>\s*time\s*'15:30'$$ as corte_sexta_1530,
    public.ro_data_minima_util('2026-10-15 16:30:00 America/Sao_Paulo'::timestamptz,4)='2026-10-20'::date
      and public.ro_data_minima_util('2026-10-16 15:30:00 America/Sao_Paulo'::timestamptz,4)='2026-10-21'::date as exatamente_no_corte_conta,
    public.ro_data_minima_util('2026-10-15 16:30:01 America/Sao_Paulo'::timestamptz,4)='2026-10-21'::date
      and public.ro_data_minima_util('2026-10-16 15:30:01 America/Sao_Paulo'::timestamptz,4)='2026-10-22'::date as apos_um_segundo_nao_conta,
    regra ~* $$p_motivo\s*=\s*'admissao'[\s\S]*?'dias_uteis'::text\s*,\s*4$$ as quatro_uteis_inclusivos,
    regra ~* $$p_motivo\s*=\s*'inicio_obra'[\s\S]*?'dias_corridos'::text\s*,\s*4$$
      and regra ~* $$p_motivo\s*=\s*'desligamento'[\s\S]*?'dias_corridos'::text\s*,\s*5$$
      and regra ~* $$p_motivo\s*=\s*'viagem_administrativa'[\s\S]*?'sem_prazo_minimo'::text\s*,\s*0$$ as demais_motivos_intactos,
    public.ro_data_minima_util('2026-10-15 16:30:00 America/Sao_Paulo'::timestamptz,4)='2026-10-20'::date
      and public.ro_data_minima_util('2026-10-15 16:30:01 America/Sao_Paulo'::timestamptz,4)='2026-10-21'::date as frontend_backend_coerentes
  from definicoes
)
select *,
  admissao_usa_now and meio_dia_artificial_removido and helper_canonico
  and corte_segunda_quinta_1630 and corte_sexta_1530 and exatamente_no_corte_conta
  and apos_um_segundo_nao_conta and quatro_uteis_inclusivos
  and demais_motivos_intactos and frontend_backend_coerentes as todos_aprovados
from verificacoes;
