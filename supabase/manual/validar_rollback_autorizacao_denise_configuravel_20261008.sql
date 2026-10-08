select
 to_regclass('public.ro_denise_autorizados') is null tabela_revertida,
 pg_get_functiondef('public.ro_is_denise(uuid)'::regprocedure) like '%d6081413-3730-41f0-981d-935a44303993%' helper_antigo_restaurado,
 has_function_privilege('authenticated','public.ro_is_denise(uuid)','EXECUTE') grant_authenticated_preservado,
 not has_function_privilege('anon','public.ro_is_denise(uuid)','EXECUTE') anon_preservado;
