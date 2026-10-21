-- Versiona a correção já aplicada em produção após a instalação inicial do
-- documento global de orientações de viagem.

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
