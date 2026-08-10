select to_regclass('public.portal_sso_handoffs') as tabela;
select c.relrowsecurity as rls_habilitada from pg_class c where c.oid='public.portal_sso_handoffs'::regclass;
select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='portal_sso_handoffs' order by ordinal_position;
select indexname,indexdef from pg_indexes where schemaname='public' and tablename='portal_sso_handoffs';
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.portal_sso_handoffs'::regclass;
select has_table_privilege('anon','public.portal_sso_handoffs','select') as anon_select,
 has_table_privilege('authenticated','public.portal_sso_handoffs','select') as authenticated_select;
select has_function_privilege('anon','public.portal_consumir_sso_handoff(text,text)','execute') as anon_exec,
 has_function_privilege('authenticated','public.portal_consumir_sso_handoff(text,text)','execute') as authenticated_exec;
select proname,prosecdef,proconfig from pg_proc where oid='public.portal_consumir_sso_handoff(text,text)'::regprocedure;
