select
 to_regclass('public.ro_denise_autorizados') is not null tabela_presente,
 (select count(*)=1 and bool_and(user_id='d6081413-3730-41f0-981d-935a44303993' and ativo) from public.ro_denise_autorizados) somente_denise_ativa,
 public.ro_is_denise('d6081413-3730-41f0-981d-935a44303993') denise_true,
 not public.ro_is_denise(gen_random_uuid()) outro_false,
 not public.ro_is_denise(null) null_false,
 pg_get_functiondef('public.ro_is_denise(uuid)'::regprocedure) like '%ro_denise_autorizados%' helper_usa_associacao,
 not has_table_privilege('authenticated','public.ro_denise_autorizados','INSERT,UPDATE,DELETE') authenticated_sem_dml,
 to_regprocedure('public.ro_atualizar_valor_passagem(uuid,uuid,numeric,text)') is not null edicao_preservada,
 to_regprocedure('public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb)') is not null complementar_preservada;
