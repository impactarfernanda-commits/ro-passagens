select
  to_regclass('public.ro_documentos_globais') is not null as tabela_presente,
  (select relrowsecurity from pg_class where oid='public.ro_documentos_globais'::regclass) as rls_habilitada,
  not has_table_privilege('authenticated','public.ro_documentos_globais','SELECT') as tabela_sem_select_direto,
  not has_table_privilege('authenticated','public.ro_documentos_globais','INSERT') as tabela_sem_insert_direto,
  to_regprocedure('public.ro_obter_documento_global(text)') is not null as rpc_leitura_presente,
  to_regprocedure('public.ro_registrar_documento_global(text,text,text)') is not null as rpc_admin_presente,
  has_function_privilege('authenticated','public.ro_obter_documento_global(text)','EXECUTE') as leitura_liberada,
  has_function_privilege('authenticated','public.ro_registrar_documento_global(text,text,text)','EXECUTE') as registro_liberado_com_guarda_interna,
  exists(select 1 from storage.buckets where id='ro-documentos-globais' and not public and file_size_limit=10485760 and allowed_mime_types=array['application/pdf']) as bucket_correto,
  (select count(*)=4 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'ro_global_documents_%') as policies_presentes;
