BEGIN;

create temp table ro_prazo_baseline on commit drop as
select motivo,subtipo,r.* from (values
 ('ferias',null),('folga_campo',null),('admissao',null),('inicio_obra',null),
 ('desligamento','programado_outros'),('transferencia_obra',null),('viagem_diretoria',null),
 ('retorno_obra',null),('recesso',null)
) v(motivo,subtipo) cross join lateral public.ro_prazo_regra(v.motivo,v.subtipo) r;

create temp table ro_acl_baseline on commit drop as
select p.oid,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='ro_prazo_regra'
  and pg_get_function_identity_arguments(p.oid)='p_motivo text, p_subtipo text';

alter table public.ro_passagem_solicitacoes drop constraint if exists ro_motivo_valido;
alter table public.ro_passagem_solicitacoes add constraint ro_motivo_valido check (motivo is null or motivo in (
 'ferias','folga_campo','desligamento','transferencia_obra','viagem_diretoria','admissao','inicio_obra','retorno_obra','recesso','viagem_administrativa'));

create or replace function public.ro_prazo_regra(p_motivo text,p_subtipo text)
returns table(regra_codigo text,prazo_tipo text,prazo_quantidade integer,categoria_documento text)
language sql immutable set search_path=public,pg_temp as $$
 select case when p_motivo='desligamento' then 'desligamento_'||coalesce(p_subtipo,'invalido') else coalesce(p_motivo,'administrativo') end,
 case when p_motivo='viagem_administrativa' then 'sem_prazo_minimo' when p_motivo='desligamento' and p_subtipo in ('justa_causa','pedido_demissao') then 'sem_prazo_minimo' when p_motivo='desligamento' and p_subtipo='ma_conduta' or p_motivo='inicio_obra' then 'dias_uteis' else 'dias_corridos' end,
 case when p_motivo='viagem_administrativa' then 0 when p_motivo='desligamento' and p_subtipo in ('justa_causa','pedido_demissao') then 0 when p_motivo='desligamento' and p_subtipo='ma_conduta' or p_motivo='inicio_obra' then 5 when p_motivo='ferias' then 25 when p_motivo in ('folga_campo','transferencia_obra','admissao','retorno_obra') then 15 when p_motivo='recesso' then 30 when p_motivo='desligamento' and p_subtipo='programado_outros' then 15 when p_motivo='desligamento' then 25 else 0 end,
 case when p_subtipo='justa_causa' then 'termo_justa_causa' when p_subtipo='pedido_demissao' then 'carta_pedido_demissao' end;
$$;

do $$ declare v text; begin
 select pg_get_constraintdef(oid) into v from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_motivo_valido';
 if v not ilike '%viagem_administrativa%' then raise exception 'DRY_RUN: constraint não aceita viagem_administrativa';end if;
 foreach v in array array['ferias','folga_campo','desligamento','transferencia_obra','viagem_diretoria','admissao','inicio_obra','retorno_obra','recesso'] loop
  if not (select pg_get_constraintdef(oid) ilike '%'||v||'%' from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_motivo_valido') then raise exception 'DRY_RUN: motivo existente removido: %',v;end if;
 end loop;
 if not exists(select 1 from public.ro_prazo_regra('viagem_administrativa',null) where prazo_tipo='sem_prazo_minimo' and prazo_quantidade=0) then raise exception 'DRY_RUN: regra administrativa inválida';end if;
 if exists(select 1 from ro_prazo_baseline b cross join lateral public.ro_prazo_regra(b.motivo,b.subtipo) a where row(a.regra_codigo,a.prazo_tipo,a.prazo_quantidade,a.categoria_documento) is distinct from row(b.regra_codigo,b.prazo_tipo,b.prazo_quantidade,b.categoria_documento)) then raise exception 'DRY_RUN: regra existente sofreu regressão';end if;
 if exists(select 1 from ro_acl_baseline b join pg_proc p on p.oid=b.oid where p.proacl is distinct from b.proacl) then raise exception 'DRY_RUN: privilégios da função foram alterados';end if;
end $$;

select * from public.ro_prazo_regra('viagem_administrativa',null);
select * from ro_prazo_baseline order by motivo,subtipo;

ROLLBACK;
