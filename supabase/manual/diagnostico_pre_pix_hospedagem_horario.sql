-- Somente leitura. Execute antes da migration no Supabase SQL Editor.
select column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name='ro_passagem_solicitacoes' order by ordinal_position;
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass order by conname;
select p.proname,pg_get_function_identity_arguments(p.oid) argumentos,p.prosecdef,p.proacl,pg_get_functiondef(p.oid) definicao from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('ro_criar_solicitacao_validada','ro_criar_solicitacao_colaborador_validada','ro_registrar_compra','ro_ultimo_pix_viajante') order by p.proname;
select to_regprocedure('public.ro_ultimo_pix_viajante(uuid,uuid)') as ultimo_pix_pre_migration_esperado_nulo;
select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='ro_passagem_historico' order by ordinal_position;
select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='ro_funcionarios_enderecos_privados' and column_name in ('id','funcionario_id','ativo');
select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='ro_passagem_solicitacoes' and column_name in ('funcionario_id','colaborador_id','pix_viajante','necessita_hospedagem','hospedagem_checkin','hospedagem_checkout','ida_a_partir_horario');
