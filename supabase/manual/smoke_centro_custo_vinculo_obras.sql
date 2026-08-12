-- Smoke transacional: valida invariantes sem persistir alterações.
begin;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ro_catalogo_colaboradores_viagem';
  if v_def is null then raise exception 'SMOKE_FALHOU: RPC ausente'; end if;
  if v_def !~ 'f.id=p.funcionario_id' or v_def !~ 'f.visivel_obras_control' or v_def !~ 'order by a.data desc' then
    raise exception 'SMOKE_FALHOU: guardas de vinculo ou criterio temporal ausentes';
  end if;

  -- As verificações de linhas são executadas quando o smoke recebe contexto autenticado.
  if auth.uid() is null then raise notice 'Smoke estrutural concluido; execute autenticado para validar linhas retornadas'; return; end if;
  if exists(
    select 1
    from public.ro_funcionarios_enderecos_privados e
    join public.ro_catalogo_colaboradores_viagem() c on c.id=e.id
    left join public.funcionarios f on f.id=e.funcionario_id
    where c.obra_id is not null
      and (e.funcionario_id is null or f.id is null or not f.ativo or f.deleted_at is not null or not f.visivel_obras_control)
  ) then raise exception 'SMOKE_FALHOU: prefill sem vinculo Obras explicito e valido'; end if;

  if exists(
    select 1
    from public.ro_catalogo_colaboradores_viagem() c
    join public.funcionarios f on f.id=c.funcionario_id
    where not f.visivel_obras_control and c.obra_id is not null
  ) then raise exception 'SMOKE_FALHOU: restrito_ro/invisivel recebeu alocacao'; end if;

  if exists(
    select 1
    from public.ro_catalogo_colaboradores_viagem() c
    where c.obra_id is not null and c.obra_nome is null
  ) then raise exception 'SMOKE_FALHOU: obra atual sem nome correspondente'; end if;
end $$;

rollback;
