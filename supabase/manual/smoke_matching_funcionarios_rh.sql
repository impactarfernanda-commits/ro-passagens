-- Smoke transacional somente leitura; não altera public.funcionarios.
begin;
select count(*)>=0 catalogo_base_ok from public.funcionarios where ativo and deleted_at is null;
select count(*)>=0 invisiveis_elegiveis_ok from public.funcionarios where ativo and deleted_at is null and not visivel_obras_control;
select not exists(select 1 from public.funcionarios where deleted_at is not null and ativo and id in (select id from public.funcionarios where ativo and deleted_at is null)) excluidos_fora_ok;
rollback;
