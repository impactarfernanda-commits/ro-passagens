select conname,pg_get_constraintdef(oid) as definicao
from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_motivo_valido';

select * from public.ro_prazo_regra('viagem_administrativa',null);
select v.motivo,v.subtipo,r.* from (values
 ('ferias',null),('folga_campo',null),('admissao',null),('inicio_obra',null),
 ('desligamento','programado_outros'),('transferencia_obra',null),('viagem_diretoria',null),('retorno_obra',null),('recesso',null)
) v(motivo,subtipo) cross join lateral public.ro_prazo_regra(v.motivo,v.subtipo) r;

select p.oid::regprocedure as funcao,p.proacl,
       coalesce(array_agg(distinct case when x.grantee=0 then 'PUBLIC' else x.grantee::regrole::text end) filter(where x.privilege_type='EXECUTE'),'{}') as executores
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
left join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x on true
where n.nspname='public' and p.proname='ro_prazo_regra'
group by p.oid,p.proacl;

select table_schema,table_name,grantee,privilege_type
from information_schema.role_table_grants
where table_schema in ('public','auth','storage') and table_name in ('ro_passagem_solicitacoes','users','objects')
  and grantee in ('PUBLIC','anon','authenticated')
order by table_schema,table_name,grantee,privilege_type;

select motivo,count(*) as quantidade,min(created_at) as primeira_data,max(created_at) as ultima_data
from public.ro_passagem_solicitacoes
where motivo is null or lower(trim(coalesce(motivo,''))) in ('nao_se_aplica','não se aplica','nao se aplica')
group by motivo order by motivo nulls first;
