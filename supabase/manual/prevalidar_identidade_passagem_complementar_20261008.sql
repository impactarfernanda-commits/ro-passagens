with f as(select pg_get_functiondef('public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb)'::regprocedure) d)
select
 to_regclass('public.ro_denise_autorizados') is not null autorizacao_003_instalada,
 to_regprocedure('public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb)') is not null rpc_legada_presente,
 (select d like '%ro_is_denise(auth.uid())%' from f) protecao_denise_presente,
 (select d like '%status not in(''passagem_comprada'',''finalizada'')%' from f) estados_preservados,
 to_regclass('public.ro_passagem_complementar_operacoes') is null entidade_operacao_ausente,
 to_regclass('public.ro_passagem_complementares') is null entidade_complementar_ausente,
 to_regprocedure('public.ro_registrar_passagem_complementar_v2(uuid,uuid,jsonb,boolean,text,jsonb)') is null rpc_v2_ausente,
 not exists(select 1 from information_schema.columns where table_schema='public' and table_name in('ro_passagem_anexos','ro_passagem_custos','ro_passagem_historico') and column_name='complemento_id') vinculos_novos_ausentes,
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='ro_passagem_anexos' and column_name='conteudo_sha256') hash_pos_compra_reutilizavel,
 exists(select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='user_metadata') metadata_storage_disponivel,
 to_regclass('public.ro_email_outbox') is not null outbox_preservada,
 to_regclass('public.ro_passagem_operacoes_idempotentes') is not null idempotencia_pos_compra_presente;
