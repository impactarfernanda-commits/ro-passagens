-- Somente metadados e contagens; não projeta qualquer endereço real.
select to_regclass('public.ro_funcionarios_enderecos_privados') as tabela_privada,
       to_regclass('public.ro_enderecos_importacoes_auditoria') as auditoria;
select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name in ('ro_funcionarios_enderecos_privados','ro_passagem_solicitacoes') and column_name in ('funcionario_id','cep','logradouro','numero','complemento','bairro','cidade','uf','destino_residencial_origem','destino_residencial_justificativa') order by table_name,ordinal_position;
select conname,contype,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.ro_funcionarios_enderecos_privados'::regclass order by conname;
select relname,relrowsecurity from pg_class where oid in ('public.ro_funcionarios_enderecos_privados'::regclass,'public.ro_enderecos_importacoes_auditoria'::regclass);
select tablename,policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public' and tablename like 'ro_%enderec%' order by tablename,policyname;
select p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef,proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('ro_can_manage_private_addresses','ro_can_view_private_addresses','ro_obter_destino_residencial_resumido','ro_obter_endereco_residencial_completo','ro_catalogo_funcionarios_enderecos','ro_salvar_endereco_funcionario','ro_importar_enderecos_funcionarios','ro_criar_solicitacao_validada') order by p.proname;
select count(*) as funcionarios_com_mais_de_um_endereco from (select funcionario_id from public.ro_funcionarios_enderecos_privados group by funcionario_id having count(*)>1)x;
select count(*) as vinculos_invalidos from public.ro_funcionarios_enderecos_privados e left join public.funcionarios f on f.id=e.funcionario_id where f.id is null;
select count(*) as enderecos_cujo_funcionario_nao_esta_no_obras_control from public.ro_funcionarios_enderecos_privados e join public.funcionarios f on f.id=e.funcionario_id where not f.visivel_obras_control;
