select
  to_regclass('public.ro_documentos_globais') is null as tabela_revertida,
  to_regprocedure('public.ro_obter_documento_global(text)') is null as rpc_leitura_revertida,
  to_regprocedure('public.ro_registrar_documento_global(text,text,text)') is null as rpc_admin_revertida,
  not exists(select 1 from storage.buckets where id='ro-documentos-globais') as bucket_revertido,
  not exists(select 1 from storage.objects where bucket_id='ro-documentos-globais') as objetos_revertidos,
  not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'ro_global_documents_%') as policies_revertidas,
  not exists(select 1 from supabase_migrations.schema_migrations where version='202610210001') as migration_nao_registrada;
