-- Somente leitura. Execute antes/depois da aplicação controlada da migration.
select p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='ro_atualizar_custo_operacional';

select policyname,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename='ro_passagem_custos' order by policyname;

select solicitacao_id,tipo,count(*) quantidade,sum(valor) total
from public.ro_passagem_custos
group by solicitacao_id,tipo having tipo='hospedagem' and count(*)>1;

-- Diagnóstico legado somente leitura: linhas positivas que o trigger atual impedirá editar.
select count(*) as custos_positivos_sem_centro_custo_financeiro
from public.ro_passagem_custos
where valor>0 and centro_custo_id is null;
