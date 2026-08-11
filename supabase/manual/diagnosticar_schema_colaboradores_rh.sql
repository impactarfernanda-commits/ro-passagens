-- Diagnóstico somente leitura. Pode ser executado antes da migration 202608110001.
select table_schema,table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name in ('funcionarios','alocacoes','obras','ro_funcionarios_enderecos_privados')
order by table_name,ordinal_position;

select n.nspname as schema_name,c.relname as relation_name,c.relkind,
       pg_get_viewdef(c.oid,true) as view_definition
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('funcionarios_safe');

select tc.table_name,tc.constraint_name,tc.constraint_type,kcu.column_name,
       ccu.table_name as referenced_table,ccu.column_name as referenced_column
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu on kcu.constraint_schema=tc.constraint_schema and kcu.constraint_name=tc.constraint_name
left join information_schema.constraint_column_usage ccu on ccu.constraint_schema=tc.constraint_schema and ccu.constraint_name=tc.constraint_name
where tc.table_schema='public' and tc.table_name in ('funcionarios','alocacoes','obras','ro_funcionarios_enderecos_privados')
order by tc.table_name,tc.constraint_name,kcu.ordinal_position;

select table_name,column_name
from information_schema.columns
where table_schema='public' and column_name in ('obra_id','funcionario_id','visivel_obras_control')
order by column_name,table_name;

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result_type
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'ro_can_view_all','ro_can_manage_private_addresses','ro_can_view_private_addresses',
 'ro_catalogo_funcionarios','ro_catalogo_funcionarios_solicitacao','ro_criar_solicitacao_validada'
)
order by p.proname,arguments;
