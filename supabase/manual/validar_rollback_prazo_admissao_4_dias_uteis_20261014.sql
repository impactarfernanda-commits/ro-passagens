-- SOMENTE LEITURA. Executar somente depois do dry run ter terminado em ROLLBACK.
with defs as (
  select coalesce(pg_get_functiondef(to_regprocedure('public.ro_prazo_regra_efetiva(text,text,uuid)')),'') as regra
), checks as (
  select
    regra like '%p_motivo=''admissao''%''dias_corridos''::text,7%' as admissao_antiga_restaurada,
    not exists(select 1 from public.ro_calendario_nao_util where id='00000000-0000-4000-8000-202610140002'::uuid) as fixture_calendario_removida,
    not exists(select 1 from public.ro_passagem_solicitacoes where id=any(array[
      '00000000-0000-4000-8001-202610140013'::uuid,
      '00000000-0000-4000-8001-202610140014'::uuid,
      '00000000-0000-4000-8001-202610140015'::uuid,
      '00000000-0000-4000-8001-202610140016'::uuid
    ])) as solicitacoes_sinteticas_ausentes,
    regra like '%p_motivo=''inicio_obra''%''dias_corridos''::text,4%' as inicio_obra_intacto,
    regra like '%rh_desligamento_programado_outros''::text,''dias_corridos''::text,5%' as desligamento_intacto,
    regra like '%rh_viagem_administrativa''::text,''sem_prazo_minimo''::text,0%' as viagem_administrativa_intacta
  from defs
)
select *,
  admissao_antiga_restaurada and fixture_calendario_removida and solicitacoes_sinteticas_ausentes
  and inicio_obra_intacto and desligamento_intacto and viagem_administrativa_intacta as rollback_confirmado
from checks;
