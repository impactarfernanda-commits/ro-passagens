-- Somente leitura. Execute antes da migration.
select c.conname,pg_get_constraintdef(c.oid) as definicao
from pg_constraint c
where c.conrelid='public.ro_passagem_solicitacoes'::regclass and c.contype='c'
  and pg_get_constraintdef(c.oid) ilike '%motivo%';

select pg_get_functiondef(p.oid) as definicao
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='ro_prazo_regra'
  and pg_get_function_identity_arguments(p.oid)='p_motivo text, p_subtipo text';

select column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name='ro_passagem_solicitacoes'
  and column_name in ('motivo','prazo_regra_codigo','prazo_tipo','prazo_quantidade','data_minima_permitida','prazo_excecao','prazo_excecao_justificativa','justificativa_excecao_prazo')
order by column_name;

select count(*) filter(where motivo='viagem_administrativa') as viagem_administrativa,
       count(*) filter(where motivo is null) as motivo_null,
       count(*) filter(where lower(trim(coalesce(motivo,''))) in ('nao_se_aplica','não se aplica','nao se aplica')) as equivalentes_nao_se_aplica
from public.ro_passagem_solicitacoes;

select motivo,count(*) as quantidade,min(created_at) as primeira_data,max(created_at) as ultima_data
from public.ro_passagem_solicitacoes
where motivo is null or lower(trim(coalesce(motivo,''))) in ('nao_se_aplica','não se aplica','nao se aplica')
group by motivo order by motivo nulls first;

select p.oid::regprocedure as funcao,p.proacl,
       coalesce(array_agg(distinct case when x.grantee=0 then 'PUBLIC' else x.grantee::regrole::text end) filter(where x.privilege_type='EXECUTE'),'{}') as executores_explicitos
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
left join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x on true
where n.nspname='public' and p.proname='ro_prazo_regra'
group by p.oid,p.proacl;
