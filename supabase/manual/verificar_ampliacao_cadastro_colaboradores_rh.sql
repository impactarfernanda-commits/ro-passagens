-- Somente leitura. Execute depois da migration em ambiente controlado.
select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name in ('ro_funcionarios_enderecos_privados','ro_passagem_solicitacoes','ro_colaboradores_auditoria') order by table_name,ordinal_position;
select indexname,indexdef from pg_indexes where schemaname='public' and tablename='ro_funcionarios_enderecos_privados';
select relname,relrowsecurity from pg_class where relname in ('ro_funcionarios_enderecos_privados','ro_colaboradores_auditoria');
select policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public' and tablename in ('ro_funcionarios_enderecos_privados','ro_colaboradores_auditoria');
select routine_name,security_type from information_schema.routines where routine_schema='public' and routine_name like 'ro_%colaborador%';
select grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('ro_funcionarios_enderecos_privados','ro_colaboradores_auditoria') order by table_name,grantee;
select cpf,count(*) from public.ro_funcionarios_enderecos_privados where cpf is not null group by cpf having count(*)>1;
select funcionario_id,count(*) from public.ro_funcionarios_enderecos_privados where funcionario_id is not null group by funcionario_id having count(*)>1;
select lower(trim(nome)) nome_normalizado,count(*) from public.ro_funcionarios_enderecos_privados where cpf is null group by lower(trim(nome)) having count(*)>1;
select count(*) registros_historicos_sem_vinculo from public.ro_funcionarios_enderecos_privados where funcionario_id is null;
select count(*) solicitacoes_sem_pessoa from public.ro_passagem_solicitacoes where funcionario_id is null and colaborador_id is null;
select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='ro_funcionarios_enderecos_privados' and column_name in ('nome','data_nascimento','cpf','rg','telefone','ativo') order by column_name;
select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name='ro_passagem_solicitacoes' and column_name in ('funcionario_id','colaborador_id') order by column_name;
select count(*) colaboradores_externos_validos from public.ro_funcionarios_enderecos_privados where funcionario_id is null and length(trim(nome))>0;
