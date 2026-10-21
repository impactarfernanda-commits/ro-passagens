begin;

create table public.ro_documentos_globais (
  chave text primary key,
  titulo text not null,
  nome_arquivo text not null,
  storage_path text not null unique,
  mime_type text not null,
  tamanho_bytes bigint not null,
  versao integer not null default 1,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid not null references auth.users(id),
  constraint ro_documentos_globais_singleton check (chave = 'orientacoes_viagem'),
  constraint ro_documentos_globais_titulo check (titulo = 'Orientações de viagem'),
  constraint ro_documentos_globais_nome check (length(btrim(nome_arquivo)) between 1 and 255 and lower(nome_arquivo) like '%.pdf'),
  constraint ro_documentos_globais_path check (storage_path ~ '^orientacoes-viagem/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'),
  constraint ro_documentos_globais_mime check (mime_type = 'application/pdf'),
  constraint ro_documentos_globais_tamanho check (tamanho_bytes between 1 and 10485760),
  constraint ro_documentos_globais_versao check (versao >= 1)
);

alter table public.ro_documentos_globais enable row level security;
revoke all on table public.ro_documentos_globais from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ro-documentos-globais', 'ro-documentos-globais', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ro_global_documents_select on storage.objects;
create policy ro_global_documents_select on storage.objects
for select to authenticated
using (
  bucket_id = 'ro-documentos-globais'
  and name like 'orientacoes-viagem/%'
);

drop policy if exists ro_global_documents_insert on storage.objects;
create policy ro_global_documents_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ro-documentos-globais'
  and public.ro_is_system_admin((select auth.uid()))
  and owner_id = (select auth.uid())::text
  and name ~ '^orientacoes-viagem/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
  and lower(storage.extension(name)) = 'pdf'
);

drop policy if exists ro_global_documents_update on storage.objects;
create policy ro_global_documents_update on storage.objects
for update to authenticated
using (
  bucket_id = 'ro-documentos-globais'
  and public.ro_is_system_admin((select auth.uid()))
  and owner_id = (select auth.uid())::text
  and name like 'orientacoes-viagem/%'
)
with check (
  bucket_id = 'ro-documentos-globais'
  and public.ro_is_system_admin((select auth.uid()))
  and owner_id = (select auth.uid())::text
  and name ~ '^orientacoes-viagem/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
  and lower(storage.extension(name)) = 'pdf'
);

drop policy if exists ro_global_documents_delete on storage.objects;
create policy ro_global_documents_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'ro-documentos-globais'
  and public.ro_is_system_admin((select auth.uid()))
  and name like 'orientacoes-viagem/%'
);

create or replace function public.ro_obter_documento_global(p_chave text)
returns table (
  chave text,
  titulo text,
  nome_arquivo text,
  storage_path text,
  mime_type text,
  tamanho_bytes bigint,
  versao integer,
  atualizado_em timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA'; end if;
  if p_chave is distinct from 'orientacoes_viagem' then raise exception 'CHAVE_DOCUMENTO_GLOBAL_INVALIDA'; end if;
  return query
    select d.chave, d.titulo, d.nome_arquivo, d.storage_path, d.mime_type,
           d.tamanho_bytes, d.versao, d.atualizado_em
    from public.ro_documentos_globais d
    where d.chave = p_chave;
end $$;

create or replace function public.ro_registrar_documento_global(
  p_chave text,
  p_storage_path text,
  p_nome_arquivo text
)
returns table (
  chave text,
  titulo text,
  nome_arquivo text,
  storage_path text,
  mime_type text,
  tamanho_bytes bigint,
  versao integer,
  atualizado_em timestamptz,
  storage_path_anterior text
)
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_obj storage.objects%rowtype;
  v_anterior text;
  v_tamanho bigint;
  v_mime text;
  v_result public.ro_documentos_globais%rowtype;
begin
  if v_uid is null then raise exception 'AUTENTICACAO_OBRIGATORIA'; end if;
  if not coalesce(public.ro_is_system_admin(v_uid), false) then raise exception 'ACESSO_RESTRITO_ADMINISTRADORA'; end if;
  if p_chave is distinct from 'orientacoes_viagem' then raise exception 'CHAVE_DOCUMENTO_GLOBAL_INVALIDA'; end if;
  if p_storage_path is null or p_storage_path !~ '^orientacoes-viagem/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
    then raise exception 'CAMINHO_DOCUMENTO_GLOBAL_INVALIDO'; end if;
  if p_nome_arquivo is null or length(btrim(p_nome_arquivo)) not between 1 and 255 or lower(p_nome_arquivo) not like '%.pdf'
    then raise exception 'NOME_DOCUMENTO_GLOBAL_INVALIDO'; end if;

  -- Serializa o singleton inclusive na primeira publicação, quando ainda não há linha para FOR UPDATE.
  perform pg_advisory_xact_lock(hashtextextended('ro_documentos_globais:orientacoes_viagem', 0));

  select o.* into v_obj from storage.objects o
  where o.bucket_id = 'ro-documentos-globais' and o.name = p_storage_path
  for update;
  if not found then raise exception 'OBJETO_DOCUMENTO_GLOBAL_INEXISTENTE'; end if;
  if v_obj.owner_id is distinct from v_uid::text then raise exception 'OBJETO_DOCUMENTO_GLOBAL_SEM_PROPRIEDADE'; end if;
  v_tamanho := nullif(v_obj.metadata->>'size', '')::bigint;
  v_mime := lower(coalesce(v_obj.metadata->>'mimetype', v_obj.metadata->>'contentType', ''));
  if lower(storage.extension(v_obj.name)) <> 'pdf' then raise exception 'EXTENSAO_DOCUMENTO_GLOBAL_INVALIDA'; end if;
  if v_mime <> 'application/pdf' then raise exception 'MIME_DOCUMENTO_GLOBAL_INVALIDO'; end if;
  if v_tamanho is null or v_tamanho < 1 or v_tamanho > 10485760 then raise exception 'TAMANHO_DOCUMENTO_GLOBAL_INVALIDO'; end if;

  select d.storage_path into v_anterior
  from public.ro_documentos_globais d where d.chave = p_chave
  for update;

  insert into public.ro_documentos_globais
    (chave, titulo, nome_arquivo, storage_path, mime_type, tamanho_bytes, versao, atualizado_em, atualizado_por)
  values
    (p_chave, 'Orientações de viagem', btrim(p_nome_arquivo), p_storage_path, 'application/pdf', v_tamanho, 1, now(), v_uid)
  on conflict on constraint ro_documentos_globais_pkey do update set
    titulo = excluded.titulo,
    nome_arquivo = excluded.nome_arquivo,
    storage_path = excluded.storage_path,
    mime_type = excluded.mime_type,
    tamanho_bytes = excluded.tamanho_bytes,
    versao = public.ro_documentos_globais.versao + 1,
    atualizado_em = now(),
    atualizado_por = v_uid
  returning * into v_result;

  return query select v_result.chave, v_result.titulo, v_result.nome_arquivo,
    v_result.storage_path, v_result.mime_type, v_result.tamanho_bytes,
    v_result.versao, v_result.atualizado_em, v_anterior;
end $$;

revoke all on function public.ro_obter_documento_global(text) from public, anon;
grant execute on function public.ro_obter_documento_global(text) to authenticated;
revoke all on function public.ro_registrar_documento_global(text, text, text) from public, anon;
grant execute on function public.ro_registrar_documento_global(text, text, text) to authenticated;


do $dry$
declare
  v_admin uuid;
  v_admin_count integer;
  v_non_admin uuid := gen_random_uuid();
  v_path1 text;
  v_path2 text;
  v_path_bucket text;
  v_path_mime text;
  v_path_zero text;
  v_path_large text;
  v_path_owner text;
  v_version integer;
  v_old text;
  v_error text;
begin
  select count(*), (array_agg(ur.user_id order by ur.user_id))[1] into v_admin_count, v_admin
  from public.user_roles ur
  join auth.users u on u.id=ur.user_id
  where ur.role::text='diretor'
    and lower(coalesce(u.email,''))='fernanda.souza@tanksbr.com.br';
  if v_admin_count <> 1 then raise exception 'DRY_RUN_REQUER_EXATAMENTE_UM_SYSTEM_ADMIN:encontrados=%',v_admin_count; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'role','authenticated')::text, true);
  if auth.uid() is distinct from v_admin then raise exception 'DRY_RUN_AUTH_UID_NAO_SIMULADO'; end if;
  if not coalesce(public.ro_is_system_admin(auth.uid()),false) then raise exception 'DRY_RUN_IDENTIDADE_NAO_E_SYSTEM_ADMIN'; end if;

  perform set_config('request.jwt.claim.sub', v_non_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_non_admin,'role','authenticated')::text, true);
  begin perform public.ro_registrar_documento_global('orientacoes_viagem','orientacoes-viagem/00000000-0000-4000-8000-000000000000.pdf','negado.pdf'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%ACESSO_RESTRITO_ADMINISTRADORA%' then raise exception 'DRY_RUN_NAO_ADMIN_NAO_FOI_REJEITADO'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'role','authenticated')::text, true);
  if auth.uid() is distinct from v_admin or not coalesce(public.ro_is_system_admin(auth.uid()),false)
    then raise exception 'DRY_RUN_CONTEXTO_ADMIN_NAO_RESTAURADO'; end if;
  v_path1 := 'orientacoes-viagem/'||gen_random_uuid()||'.pdf';
  v_path2 := 'orientacoes-viagem/'||gen_random_uuid()||'.pdf';
  v_path_bucket := 'orientacoes-viagem/'||gen_random_uuid()||'.pdf';
  v_path_mime := 'orientacoes-viagem/'||gen_random_uuid()||'.pdf';
  v_path_zero := 'orientacoes-viagem/'||gen_random_uuid()||'.pdf';
  v_path_large := 'orientacoes-viagem/'||gen_random_uuid()||'.pdf';
  v_path_owner := 'orientacoes-viagem/'||gen_random_uuid()||'.pdf';
  insert into storage.objects(id,bucket_id,name,owner_id,metadata) values
    (gen_random_uuid(),'ro-documentos-globais',v_path1,v_admin,jsonb_build_object('size',100,'mimetype','application/pdf')),
    (gen_random_uuid(),'ro-documentos-globais',v_path2,v_admin,jsonb_build_object('size',200,'mimetype','application/pdf')),
    (gen_random_uuid(),'ro-passagem-anexos',v_path_bucket,v_admin,jsonb_build_object('size',100,'mimetype','application/pdf')),
    (gen_random_uuid(),'ro-documentos-globais',v_path_mime,v_admin,jsonb_build_object('size',100,'mimetype','text/plain')),
    (gen_random_uuid(),'ro-documentos-globais',v_path_zero,v_admin,jsonb_build_object('size',0,'mimetype','application/pdf')),
    (gen_random_uuid(),'ro-documentos-globais',v_path_large,v_admin,jsonb_build_object('size',10485761,'mimetype','application/pdf')),
    (gen_random_uuid(),'ro-documentos-globais',v_path_owner,v_non_admin,jsonb_build_object('size',100,'mimetype','application/pdf'));
  select r.versao,r.storage_path_anterior into v_version,v_old
  from public.ro_registrar_documento_global('orientacoes_viagem',v_path1,'orientacoes-v1.pdf') r;
  if v_version <> 1 or v_old is not null then raise exception 'DRY_RUN_PRIMEIRA_VERSAO_INVALIDA'; end if;
  if not exists(select 1 from public.ro_documentos_globais d where d.chave='orientacoes_viagem' and d.titulo='Orientações de viagem' and d.nome_arquivo='orientacoes-v1.pdf' and d.storage_path=v_path1 and d.mime_type='application/pdf' and d.tamanho_bytes=100 and d.versao=1 and d.atualizado_em is not null and d.atualizado_por=v_admin)
    then raise exception 'DRY_RUN_PRIMEIRA_PUBLICACAO_METADATA_INVALIDA'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='ro-documentos-globais' and o.name=v_path1)
    then raise exception 'DRY_RUN_RPC_REMOVEU_OBJETO_NOVO'; end if;
  select r.versao,r.storage_path_anterior into v_version,v_old
  from public.ro_registrar_documento_global('orientacoes_viagem',v_path2,'orientacoes-v2.pdf') r;
  if v_version <> 2 or v_old is distinct from v_path1 then raise exception 'DRY_RUN_SUBSTITUICAO_INVALIDA'; end if;
  if (select count(*) from public.ro_documentos_globais) <> 1 then raise exception 'DRY_RUN_SINGLETON_VIOLADO'; end if;
  if not exists(select 1 from public.ro_documentos_globais d where d.chave='orientacoes_viagem' and d.nome_arquivo='orientacoes-v2.pdf' and d.storage_path=v_path2 and d.mime_type='application/pdf' and d.tamanho_bytes=200 and d.versao=2 and d.atualizado_em is not null and d.atualizado_por=v_admin)
    then raise exception 'DRY_RUN_SUBSTITUICAO_METADATA_INVALIDA'; end if;
  if (select count(*) from storage.objects o where o.bucket_id='ro-documentos-globais' and o.name in(v_path1,v_path2)) <> 2
    then raise exception 'DRY_RUN_RPC_REMOVEU_OBJETO_ANTIGO_OU_NOVO'; end if;
  if not exists(select 1 from public.ro_obter_documento_global('orientacoes_viagem') d where d.versao=2 and d.storage_path=v_path2)
    then raise exception 'DRY_RUN_LEITURA_INVALIDA'; end if;
  begin perform public.ro_obter_documento_global('chave_invalida'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%CHAVE_DOCUMENTO_GLOBAL_INVALIDA%' then raise exception 'DRY_RUN_LEITURA_ACEITOU_CHAVE_INVALIDA'; end if;
  begin perform public.ro_registrar_documento_global('chave_invalida',v_path2,'invalido.pdf'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%CHAVE_DOCUMENTO_GLOBAL_INVALIDA%' then raise exception 'DRY_RUN_REGISTRO_ACEITOU_CHAVE_INVALIDA'; end if;
  begin perform public.ro_registrar_documento_global('orientacoes_viagem',v_path_bucket,'bucket-incorreto.pdf'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%OBJETO_DOCUMENTO_GLOBAL_INEXISTENTE%' then raise exception 'DRY_RUN_BUCKET_INCORRETO_NAO_REJEITADO'; end if;
  begin perform public.ro_registrar_documento_global('orientacoes_viagem','fora-prefixo/'||gen_random_uuid()||'.pdf','fora-prefixo.pdf'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%CAMINHO_DOCUMENTO_GLOBAL_INVALIDO%' then raise exception 'DRY_RUN_PREFIXO_INVALIDO_NAO_REJEITADO'; end if;
  begin perform public.ro_registrar_documento_global('orientacoes_viagem','orientacoes-viagem/'||gen_random_uuid()||'.txt','extensao.txt'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%CAMINHO_DOCUMENTO_GLOBAL_INVALIDO%' then raise exception 'DRY_RUN_EXTENSAO_INVALIDA_NAO_REJEITADA'; end if;
  begin perform public.ro_registrar_documento_global('orientacoes_viagem',v_path_mime,'mime.pdf'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%MIME_DOCUMENTO_GLOBAL_INVALIDO%' then raise exception 'DRY_RUN_MIME_INVALIDO_NAO_REJEITADO'; end if;
  begin perform public.ro_registrar_documento_global('orientacoes_viagem',v_path_zero,'zero.pdf'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%TAMANHO_DOCUMENTO_GLOBAL_INVALIDO%' then raise exception 'DRY_RUN_TAMANHO_ZERO_NAO_REJEITADO'; end if;
  begin perform public.ro_registrar_documento_global('orientacoes_viagem',v_path_large,'grande.pdf'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%TAMANHO_DOCUMENTO_GLOBAL_INVALIDO%' then raise exception 'DRY_RUN_TAMANHO_GRANDE_NAO_REJEITADO'; end if;
  begin perform public.ro_registrar_documento_global('orientacoes_viagem',v_path_owner,'owner.pdf'); v_error := 'SEM_ERRO';
  exception when others then v_error := sqlerrm; end;
  if v_error not like '%OBJETO_DOCUMENTO_GLOBAL_SEM_PROPRIEDADE%' then raise exception 'DRY_RUN_OWNER_INVALIDO_NAO_REJEITADO'; end if;
end $dry$;

select
  exists(select 1 from pg_constraint where conrelid='public.ro_documentos_globais'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (chave)') as chave_pk,
  (select count(*)=7 from pg_constraint where conrelid='public.ro_documentos_globais'::regclass and contype='c') as sete_checks,
  exists(select 1 from pg_constraint where conrelid='public.ro_documentos_globais'::regclass and contype='f' and confrelid='auth.users'::regclass) as fk_auth_users,
  exists(select 1 from pg_class where oid='public.ro_documentos_globais'::regclass and relrowsecurity) as rls_habilitada,
  exists(select 1 from storage.buckets where id='ro-documentos-globais' and not public and file_size_limit=10485760 and allowed_mime_types=array['application/pdf']) as bucket_correto,
  has_function_privilege('authenticated','public.ro_obter_documento_global(text)','EXECUTE') as leitura_authenticated,
  not has_function_privilege('anon','public.ro_obter_documento_global(text)','EXECUTE') as leitura_anon_revogada,
  has_function_privilege('authenticated','public.ro_registrar_documento_global(text,text,text)','EXECUTE') as registro_authenticated_com_guarda_interna,
  not has_function_privilege('anon','public.ro_registrar_documento_global(text,text,text)','EXECUTE') as registro_anon_revogado,
  not has_table_privilege('authenticated','public.ro_documentos_globais','SELECT') as tabela_sem_select_direto,
  (not has_table_privilege('authenticated','public.ro_documentos_globais','INSERT')
   and not has_table_privilege('authenticated','public.ro_documentos_globais','UPDATE')
   and not has_table_privilege('authenticated','public.ro_documentos_globais','DELETE')) as tabela_sem_dml_direto,
  (select count(*)=4 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'ro_global_documents_%') as quatro_policies_storage;

rollback;

select
  to_regclass('public.ro_documentos_globais') is null as tabela_revertida,
  to_regprocedure('public.ro_obter_documento_global(text)') is null as rpc_leitura_revertida,
  to_regprocedure('public.ro_registrar_documento_global(text,text,text)') is null as rpc_admin_revertida,
  not exists(select 1 from storage.buckets where id='ro-documentos-globais') as bucket_revertido,
  not exists(select 1 from storage.objects where bucket_id='ro-documentos-globais') as objetos_revertidos,
  not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'ro_global_documents_%') as policies_revertidas,
  not exists(select 1 from supabase_migrations.schema_migrations where version='202610210001') as migration_nao_registrada;
