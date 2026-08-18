-- Somente leitura. Retorna apenas metadados mínimos, sem nome/path completo.
select
  o.created_at,
  o.owner_id is not null as possui_proprietario,
  left(o.name, 36) = split_part(o.name, '/', 1) as prefixo_formato_uuid,
  exists (
    select 1
    from public.ro_passagem_anexos a
    where a.storage_path = o.name
  ) as possui_vinculo
from storage.objects o
where o.bucket_id = 'ro-passagem-anexos'
  and o.created_at >= now() - interval '24 hours'
order by o.created_at desc
limit 50;
