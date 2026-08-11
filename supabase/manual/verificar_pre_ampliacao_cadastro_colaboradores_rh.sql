-- Verificação pré-migration: consulta apenas objetos/colunas já existentes.
select table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name in ('funcionarios','alocacoes','ro_funcionarios_enderecos_privados','ro_passagem_solicitacoes')
order by table_name,ordinal_position;

select exists(
 select 1 from information_schema.columns
 where table_schema='public' and table_name='funcionarios' and column_name='obra_id'
) as funcionarios_possui_obra_id;

select exists(
 select 1 from information_schema.columns
 where table_schema='public' and table_name='funcionarios' and column_name='visivel_obras_control'
) as funcionarios_possui_visivel_obras_control;

select exists(
 select 1 from information_schema.columns
 where table_schema='public' and table_name='alocacoes' and column_name='obra_id'
) as alocacoes_possui_obra_id;

select exists(
 select 1 from information_schema.columns
 where table_schema='public' and table_name='ro_funcionarios_enderecos_privados' and column_name='nome' and is_nullable='NO'
) as cadastro_privado_possui_nome_obrigatorio;

select exists(
 select 1 from information_schema.columns
 where table_schema='public' and table_name='ro_funcionarios_enderecos_privados' and column_name='funcionario_id' and is_nullable='YES'
) as cadastro_privado_permite_vinculo_nulo;

select column_name,is_nullable
from information_schema.columns
where table_schema='public' and table_name='ro_funcionarios_enderecos_privados'
  and column_name in ('nome','funcionario_id','cep','logradouro','numero','complemento','bairro','cidade','uf')
order by ordinal_position;

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ro_can_view_all','ro_can_manage_private_addresses','ro_can_view_private_addresses','ro_is_operador_ativo','ro_criar_solicitacao_validada')
order by p.proname,arguments;

select funcionario_id,count(*)
from public.ro_funcionarios_enderecos_privados
where funcionario_id is not null
group by funcionario_id having count(*)>1;

select lower(trim(nome)) as nome_normalizado,count(*)
from public.ro_funcionarios_enderecos_privados
group by lower(trim(nome)) having count(*)>1;
