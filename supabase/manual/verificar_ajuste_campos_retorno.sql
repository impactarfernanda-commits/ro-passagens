-- Somente leitura: execute após aplicar a migration em um ambiente autorizado.
select c.column_name,c.data_type,c.is_nullable
from information_schema.columns c
where c.table_schema='public' and c.table_name='ro_passagem_solicitacoes' and c.column_name='destino_retorno';

select p.proname,pg_get_function_identity_arguments(p.oid) argumentos,pg_get_functiondef(p.oid) definicao
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ro_motivo_possui_retorno','ro_normalizar_campos_retorno','ro_criar_solicitacao_validada','ro_obter_dados_para_refazer_solicitacao');

select routine_name,grantee,privilege_type
from information_schema.routine_privileges
where routine_schema='public' and routine_name in ('ro_motivo_possui_retorno','ro_normalizar_campos_retorno','ro_criar_solicitacao_validada','ro_obter_dados_para_refazer_solicitacao')
order by routine_name,grantee;

select policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename='ro_passagem_solicitacoes'
order by policyname;

select count(*) as total_historico_com_destino_retorno
from public.ro_passagem_solicitacoes where destino_retorno is not null;

select count(*) as motivos_sem_retorno_incompativeis
from public.ro_passagem_solicitacoes
where not public.ro_motivo_possui_retorno(motivo)
and (data_retorno is not null or destino_retorno is not null or centro_custo_retorno_id is not null or retorno_indefinido);

select count(*) as indefinidos_com_destino_ou_centro
from public.ro_passagem_solicitacoes
where retorno_indefinido and (destino_retorno is not null or centro_custo_retorno_id is not null);

select conname,convalidated,pg_get_constraintdef(oid) definicao
from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_campos_retorno_aplicaveis_ck';
