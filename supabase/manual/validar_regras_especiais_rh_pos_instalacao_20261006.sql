-- SOMENTE LEITURA. Executar apenas depois de uma futura instalação autorizada.
select jsonb_build_object(
  'coluna_instalada',exists(select 1 from information_schema.columns where table_schema='public' and table_name='ro_passagem_solicitacoes' and column_name='viajante_nome_informado'),
  'constraint_instalada',exists(select 1 from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_solicitacao_pessoa_ck' and pg_get_constraintdef(oid) like '%viajante_nome_informado%'),
  'regra_rh_instalada',to_regprocedure('public.ro_prazo_regra_efetiva(text,text,uuid)') is not null,
  'viagem_administrativa_rh',pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure) like '%viagem_administrativa%',
  'catalogo_cc_rh',pg_get_functiondef('public.ro_catalogo_centros_custo()'::regprocedure) like '%ro_is_rh_active%',
  'validacao_cc_rh',pg_get_functiondef('public.ro_validar_solicitacao_visibilidade()'::regprocedure) like '%ro_is_rh_active%',
  'nome_canonico',pg_get_functiondef('public.ro_nomes_colaboradores_solicitacoes(uuid[])'::regprocedure) like '%viajante_nome_informado%',
  'emissao_compativel',pg_get_functiondef('public.ro_obter_dados_emissao_passagem(uuid)'::regprocedure) like '%viajante_nome_informado%',
  'aprovacao_rh_preservada',pg_get_functiondef('public.ro_approval_exempt(uuid)'::regprocedure) like '%ro_is_rh_active%',
  'ro_can_view_all_nao_alterado',pg_get_functiondef('public.ro_catalogo_centros_custo()'::regprocedure) like '%or public.ro_is_rh_active%' and pg_get_functiondef('public.ro_validar_solicitacao_visibilidade()'::regprocedure) like '%ro_can_view_all() or public.ro_is_rh_active%',
  'execute_catalogo_authenticated',has_function_privilege('authenticated','public.ro_catalogo_centros_custo()','execute'),
  'execute_criacao_authenticated',has_function_privilege('authenticated','public.ro_criar_solicitacao_com_aprovador(jsonb,jsonb)','execute'),
  'rls_rh_preservada',(select relrowsecurity from pg_class where oid='public.ro_rh_responsaveis'::regclass)
) resultado;
