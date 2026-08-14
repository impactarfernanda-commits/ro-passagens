-- Somente leitura: contrato, cadeia e ACLs efetivas das RPCs de compra.
select p.oid::regprocedure as assinatura,p.prosecdef,p.proconfig,r.rolname as owner,p.proacl,
 has_function_privilege('public',p.oid,'EXECUTE') as public_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 pg_get_functiondef(p.oid) as definicao
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in ('ro_registrar_compra','ro_registrar_compra_pre_operacional','ro_can_operate','ro_is_admin_or_ro')
order by p.proname,pg_get_function_identity_arguments(p.oid);

select caller.oid::regprocedure as chamadora,callee.oid::regprocedure as chamada
from pg_proc caller join pg_namespace nc on nc.oid=caller.pronamespace
join pg_depend d on d.classid='pg_proc'::regclass and d.objid=caller.oid and d.refclassid='pg_proc'::regclass
join pg_proc callee on callee.oid=d.refobjid join pg_namespace nd on nd.oid=callee.pronamespace
where nc.nspname='public' and nd.nspname='public' and caller.proname like 'ro_registrar_compra%';

select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname in ('public','storage') and tablename in ('ro_passagem_solicitacoes','ro_passagem_custos','ro_passagem_anexos','objects') order by schemaname,tablename,policyname;

select conrelid::regclass as tabela,conname,pg_get_constraintdef(oid) as definicao from pg_constraint
where conrelid in ('public.ro_passagem_custos'::regclass,'public.ro_passagem_anexos'::regclass) order by conrelid::regclass::text,conname;
