select
  to_regclass('public.ro_documentos_globais') is null as tabela_ainda_ausente,
  to_regprocedure('public.ro_obter_documento_global(text)') is null as rpc_leitura_ainda_ausente,
  to_regprocedure('public.ro_registrar_documento_global(text,text,text)') is null as rpc_admin_ainda_ausente,
  not exists(select 1 from storage.buckets where id='ro-documentos-globais') as bucket_ainda_ausente,
  not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'ro_global_documents_%') as policies_ainda_ausentes,
  to_regprocedure('public.ro_is_system_admin(uuid)') is not null as dependencia_admin_presente,
  to_regclass('auth.users') is not null as auth_users_presente,
  to_regclass('storage.buckets') is not null as storage_buckets_presente,
  to_regclass('storage.objects') is not null as storage_objects_presente,
  not exists(
    select 1 from (values ('id'),('bucket_id'),('name'),('owner_id'),('metadata')) required(column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='storage' and c.table_name='objects' and c.column_name=required.column_name
    )
  ) as colunas_storage_necessarias_presentes;
