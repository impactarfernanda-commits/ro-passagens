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
