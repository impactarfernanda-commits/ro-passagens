-- SOMENTE LEITURA. Execute após o dry run, que termina em ROLLBACK.
with defs as (
  select
    pg_get_functiondef('public.ro_validar_solicitacao_visibilidade()'::regprocedure) validacao_def,
    pg_get_functiondef('public.ro_funcionario_disponivel_para_usuario(uuid,uuid)'::regprocedure) helper_def
), checks(indicador,aprovado,detalhe) as (
  select 'funcao_regressiva_restaurada',
         validacao_def ~* 'v_restrito[\s\S]*f\.escopo_passagens\s*=\s*''comum''[\s\S]*v_restrito[\s\S]*f\.escopo_passagens\s*=\s*''restrito_ro''',
         'a redefinição transacional não persistiu' from defs
  union all select 'trigger_continua_presente',
         exists(select 1 from pg_trigger where tgrelid='public.ro_passagem_solicitacoes'::regclass and tgname='ro_validar_solicitacao_visibilidade' and not tgisinternal and tgenabled<>'D'),
         'trigger instalado e ativo'
  union all select 'helper_canonico_inalterado',
         helper_def ~* 'escopo_passagens\s+in\s*\(''comum''\s*,\s*''restrito_ro''\)',
         'helper ainda aceita comum e restrito_ro' from defs
  union all select 'nenhum_funcionario_fixture',not exists(select 1 from public.funcionarios where nome like 'DRY140001-%'),'zero funcionários sintéticos'
  union all select 'nenhum_cc_fixture',not exists(select 1 from public.obras where nome like 'DRY140001-%' or codigo like 'DRY140001-%'),'zero centros sintéticos'
  union all select 'nenhum_usuario_fixture',not exists(select 1 from auth.users where email like 'dry-run-140001-%@example.invalid'),'zero usuários sintéticos'
  union all select 'nenhuma_solicitacao_fixture',not exists(
    select 1 from public.ro_passagem_solicitacoes s join auth.users u on u.id=s.solicitante_id
    where u.email like 'dry-run-140001-%@example.invalid'
  ),'zero solicitações sintéticas'
)
select indicador,aprovado,detalhe,bool_and(aprovado) over() todos_aprovados from checks order by indicador;
