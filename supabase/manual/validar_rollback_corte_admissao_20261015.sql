-- Somente leitura. Execute após o dry run ter terminado em ROLLBACK.
with definicoes as (
  select
    pg_get_functiondef('public.ro_prazo_regra_efetiva(text,text,uuid)'::regprocedure) as regra,
    pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure) as validador
), verificacoes as (
  select
    validador ~* $$regra_codigo\s*=\s*'rh_admissao'[\s\S]*?ro_data_minima_util\s*\(\s*\(\s*v_hoje\s*\+\s*time\s*'12:00'$$ as backend_voltou_ao_meio_dia,
    not exists(select 1 from public.ro_calendario_nao_util where id='f0020002-1630-4000-8000-000000000001'::uuid) as fixture_feriado_removida,
    not exists(select 1 from public.ro_passagem_solicitacoes where id in (
      'f0020002-1630-4000-8000-000000000002'::uuid,
      'f0020002-1630-4000-8000-000000000003'::uuid
    )) as solicitacoes_sinteticas_ausentes,
    regra ~* $$p_motivo\s*=\s*'inicio_obra'[\s\S]*?'dias_corridos'::text\s*,\s*4$$ as inicio_obra_preservado,
    regra ~* $$p_motivo\s*=\s*'desligamento'[\s\S]*?'dias_corridos'::text\s*,\s*5$$ as desligamento_preservado,
    regra ~* $$p_motivo\s*=\s*'viagem_administrativa'[\s\S]*?'sem_prazo_minimo'::text\s*,\s*0$$ as viagem_administrativa_preservada
  from definicoes
)
select *,
  backend_voltou_ao_meio_dia and fixture_feriado_removida
  and solicitacoes_sinteticas_ausentes and inicio_obra_preservado
  and desligamento_preservado and viagem_administrativa_preservada
  as rollback_confirmado
from verificacoes;
