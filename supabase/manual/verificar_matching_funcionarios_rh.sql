-- PÓS-MIGRATION / SOMENTE LEITURA.
select pg_get_functiondef('public.ro_catalogo_funcionarios_obras_matching_rh()'::regprocedure) catalogo_matching;
select pg_get_functiondef('public.ro_salvar_colaborador_viagem(jsonb)'::regprocedure) persistencia_matching;
select count(*) funcionarios_ativos_invisiveis_elegiveis from public.funcionarios where ativo and deleted_at is null and not visivel_obras_control;
select count(*) flags_visibilidade from public.funcionarios where visivel_obras_control;
