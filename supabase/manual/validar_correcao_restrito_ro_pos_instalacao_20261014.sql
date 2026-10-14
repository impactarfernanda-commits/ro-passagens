-- SOMENTE LEITURA. Execute após a futura aplicação real da migration.
with defs as (
  select
    pg_get_functiondef('public.ro_validar_solicitacao_visibilidade()'::regprocedure) validacao_def,
    pg_get_functiondef('public.ro_funcionario_disponivel_para_usuario(uuid,uuid)'::regprocedure) helper_def,
    pg_get_functiondef('public.ro_catalogo_colaboradores_viagem()'::regprocedure) catalogo_def
), checks(indicador,aprovado,detalhe) as (
  select 'trigger_ativo',exists(select 1 from pg_trigger where tgrelid='public.ro_passagem_solicitacoes'::regclass and tgname='ro_validar_solicitacao_visibilidade' and not tgisinternal and tgenabled<>'D'),'trigger instalado e habilitado'
  union all select 'funcionario_usa_helper',validacao_def ~* 'elsif\s+not\s+public\.ro_funcionario_disponivel_para_usuario\s*\(\s*auth\.uid\(\)\s*,\s*new\.funcionario_id\s*\)','validação de funcionario_id delegada ao helper' from defs
  union all select 'regressao_removida',validacao_def !~* 'f\.escopo_passagens\s*=\s*''comum''[\s\S]*v_restrito[\s\S]*f\.escopo_passagens\s*=\s*''restrito_ro''','perfil não governa mais o escopo do funcionário' from defs
  union all select 'regras_rh_preservadas',validacao_def like '%viajante_nome_informado%' and validacao_def like '%ro_is_rh_active(auth.uid())%' and validacao_def like '%VIAJANTE_MANUAL_APENAS_RH%','viajante manual/RH preservados' from defs
  union all select 'colaborador_historico_preservado',validacao_def like '%ro_funcionarios_enderecos_privados%' and validacao_def like '%Colaborador indisponível%','ramo colaborador_id preservado' from defs
  union all select 'cc_preservado',validacao_def like '%public.obras%' and validacao_def like '%Centro de custo indisponível%' and validacao_def like '%o.escopo_passagens in(''comum'',''restrito_ro'')%','validação independente de CC preservada' from defs
  union all select 'helper_canonico_intacto',helper_def ~* 'f\.ativo[\s\S]*f\.deleted_at is null[\s\S]*f\.visivel_passagens[\s\S]*escopo_passagens\s+in\s*\(''comum''\s*,\s*''restrito_ro''\)','guardas canônicas presentes' from defs
  union all select 'catalogo_trigger_alinhados',catalogo_def ~* 'ro_funcionario_disponivel_para_usuario\s*\(\s*auth\.uid\(\)\s*,\s*f\.id\s*\)' and validacao_def ~* 'ro_funcionario_disponivel_para_usuario\s*\(\s*auth\.uid\(\)\s*,\s*new\.funcionario_id\s*\)','catálogo e trigger usam o mesmo helper' from defs
)
select indicador,aprovado,detalhe,bool_and(aprovado) over() todos_aprovados from checks order by indicador;
