with v2 as(select pg_get_functiondef('public.ro_registrar_passagem_complementar_v2(uuid,uuid,jsonb,boolean,text,jsonb)'::regprocedure) d)
select
 to_regclass('public.ro_passagem_complementar_operacoes') is not null entidade_operacao_presente,
 to_regclass('public.ro_passagem_complementares') is not null entidade_complementar_presente,
 to_regprocedure('public.ro_registrar_passagem_complementar_v2(uuid,uuid,jsonb,boolean,text,jsonb)') is not null rpc_v2_presente,
 (select d like '%ro_is_denise(auth.uid())%' from v2) denise_preservada,
 (select d like '%status not in(''passagem_comprada'',''finalizada'')%' from v2) estados_preservados,
 (select d like '%idempotent_replay%' and d like '%PAYLOAD_DIFERENTE%' from v2) idempotencia_presente,
 (select d like '%user_metadata->>''conteudo_sha256''%' and d like '%HASH_STORAGE_DIVERGENTE_DO_PAYLOAD%' from v2) hash_storage_validado,
 (select d like '%conteudo_sha256%' from v2) hash_persistido_e_fingerprinted,
 (select count(*)=3 from information_schema.columns where table_schema='public' and table_name in('ro_passagem_anexos','ro_passagem_custos','ro_passagem_historico') and column_name='complemento_id') tres_vinculos_presentes,
 to_regprocedure('public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb)') is not null rpc_legada_temporaria,
 to_regprocedure('public.ro_proteger_complemento_id()') is not null complemento_id_protegido,
 to_regclass('public.ro_denise_autorizados') is not null autorizacao_por_associacao,
 to_regclass('public.ro_email_outbox') is not null outbox_preservada,
 (select d not like '%ro_email_outbox%' from v2) sem_email;
