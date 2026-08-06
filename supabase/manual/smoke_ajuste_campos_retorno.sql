-- Smoke transacional. Não executar no Supabase real.
begin;

create temporary table ro_smoke_retorno(
  motivo text,data_retorno date,destino_retorno text,centro_custo_retorno_id uuid,retorno_indefinido boolean not null default false
) on commit drop;
create trigger ro_smoke_normalizar before insert or update on ro_smoke_retorno
for each row execute function public.ro_normalizar_campos_retorno();

insert into ro_smoke_retorno values('desligamento',current_date+20,'Curitiba / PR',gen_random_uuid(),true);
insert into ro_smoke_retorno values('ferias',current_date+20,'Curitiba / PR',gen_random_uuid(),true);

do $$
begin
  if exists(select 1 from ro_smoke_retorno where motivo='desligamento' and (data_retorno is not null or destino_retorno is not null or centro_custo_retorno_id is not null or retorno_indefinido)) then raise exception 'NORMALIZACAO_SEM_RETORNO_FALHOU';end if;
  if exists(select 1 from ro_smoke_retorno where motivo='ferias' and (data_retorno is null or destino_retorno is not null or centro_custo_retorno_id is not null)) then raise exception 'NORMALIZACAO_INDEFINIDO_FALHOU';end if;
  if not public.ro_motivo_possui_retorno('recesso') or public.ro_motivo_possui_retorno('admissao') then raise exception 'APLICABILIDADE_FALHOU';end if;
end $$;

select has_column_privilege('authenticated','public.ro_passagem_solicitacoes','destino_retorno','select') as grant_coluna_herdado_sem_ampliacao;
rollback;
