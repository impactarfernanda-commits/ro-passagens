select
 to_regclass('public.ro_passagem_complementar_operacoes') is null operacoes_revertidas,
 to_regclass('public.ro_passagem_complementares') is null complementares_revertidas,
 to_regprocedure('public.ro_registrar_passagem_complementar_v2(uuid,uuid,jsonb,boolean,text,jsonb)') is null rpc_v2_revertida,
 not exists(select 1 from information_schema.columns where table_schema='public' and table_name in('ro_passagem_anexos','ro_passagem_custos','ro_passagem_historico') and column_name='complemento_id') vinculos_revertidos,
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='ro_passagem_anexos' and column_name='conteudo_sha256') hash_anterior_preservado,
 not exists(select 1 from auth.users where raw_user_meta_data->>'fixture'='dry_run_004') auth_sintetico_revertido,
 not exists(select 1 from public.ro_denise_autorizados d join auth.users u on u.id=d.user_id where u.raw_user_meta_data->>'fixture'='dry_run_004') operador_sintetico_revertido,
 not exists(select 1 from storage.objects where bucket_id='ro-passagem-anexos' and name like '%/complementares/dry-run-004/%') storage_sintetico_revertido,
 not exists(select 1 from public.ro_passagem_solicitacoes where viajante_nome_informado='Viajante Sintético DRY 004') solicitacao_e_viajante_sinteticos_revertidos,
 to_regprocedure('public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb)') is not null rpc_legada_preservada,
 to_regclass('public.ro_email_outbox') is not null outbox_preservada;
