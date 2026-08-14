select p.oid::regprocedure as assinatura,p.prosecdef,p.proconfig,p.proacl,
 has_function_privilege('public',p.oid,'EXECUTE') public_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ro_registrar_compra','ro_registrar_compra_pre_operacional','ro_registrar_hospedagem') order by p.proname;

select conrelid::regclass as tabela,conname,pg_get_constraintdef(oid) from pg_constraint
where conname in ('ro_passagem_custos_tipo_check','ro_passagem_anexos_tipo_check');

select indexdef from pg_indexes where schemaname='public' and indexname='ro_passagem_custos_hospedagem_unico';

select solicitacao_id,count(*) as custos_hospedagem from public.ro_passagem_custos where tipo='hospedagem' group by solicitacao_id having count(*)>1;
select solicitacao_id,tipo,nome_arquivo,storage_path from public.ro_passagem_anexos where tipo='hospedagem_pdf' order by created_at desc;
