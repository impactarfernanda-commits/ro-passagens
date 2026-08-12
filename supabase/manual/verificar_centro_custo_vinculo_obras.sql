-- Executar somente depois da migration. Somente leitura.
select p.proname, pg_get_function_result(p.oid) as retorno
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='ro_catalogo_colaboradores_viagem';

select
  count(*) filter(where e.funcionario_id is null and c.obra_id is not null) as externos_com_prefill_incorreto,
  count(*) filter(where e.funcionario_id is not null and (not f.visivel_obras_control or not f.ativo or f.deleted_at is not null) and c.obra_id is not null) as vinculos_invalidos_com_prefill_incorreto
from public.ro_funcionarios_enderecos_privados e
join public.ro_catalogo_colaboradores_viagem() c on c.id=e.id
left join public.funcionarios f on f.id=e.funcionario_id;

select has_function_privilege('authenticated','public.ro_catalogo_colaboradores_viagem()','execute') as authenticated_pode_executar,
       not has_function_privilege('anon','public.ro_catalogo_colaboradores_viagem()','execute') as anon_nao_pode_executar;
