-- SOMENTE LEITURA. Executar somente depois do dry run ter terminado em ROLLBACK.
with defs as (
  select
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_prazo_regra_efetiva(text,text,uuid)')),'') as regra,
    coalesce(pg_get_functiondef(to_regprocedure('public.ro_validar_nova_solicitacao()')),'') as validador
), checks as (
  select
    validador ~ $re$v_reg\.regra_codigo\s*=\s*'rh_admissao'[\s\S]*ro_data_minima_util\([\s\S]*\)\s*\+\s*1$re$ as regra_anterior_restaurada,
    not exists(
      select 1 from public.ro_calendario_nao_util
      where id='00000000-0000-4000-8000-202610150001'::uuid
         or descricao='DRY RUN contagem inclusiva admissão — não persistir'
    ) as feriado_sintetico_removido,
    regra ~ $re$p_motivo\s*=\s*'inicio_obra'[\s\S]*'dias_corridos'::text\s*,\s*4$re$ as inicio_obra_intacto,
    regra ~ $re$rh_desligamento_programado_outros'::text\s*,\s*'dias_corridos'::text\s*,\s*5$re$ as desligamento_intacto,
    regra ~ $re$rh_viagem_administrativa'::text\s*,\s*'sem_prazo_minimo'::text\s*,\s*0$re$ as viagem_administrativa_intacta
  from defs
)
select *,
  regra_anterior_restaurada and feriado_sintetico_removido
  and inicio_obra_intacto and desligamento_intacto and viagem_administrativa_intacta
  as rollback_confirmado
from checks;
