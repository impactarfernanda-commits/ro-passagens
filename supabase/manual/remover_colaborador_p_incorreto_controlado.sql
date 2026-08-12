-- DEFINITIVO: somente para execução manual posterior ao dry-run e à revisão do diagnóstico.
begin;
lock table public.ro_funcionarios_enderecos_privados in share row exclusive mode;

do $$
declare
  v_id uuid;
  v_funcionario_id uuid;
  v_quantidade integer;
  v_referencias bigint;
  v_fk record;
  v_excluidos integer;
begin
  select count(*), (array_agg(id order by id))[1], (array_agg(funcionario_id order by id))[1]
    into v_quantidade, v_id, v_funcionario_id
  from public.ro_funcionarios_enderecos_privados
  where trim(nome) = 'P';

  if v_quantidade <> 1 then raise exception 'LIMPEZA_P_ABORTADA: esperado exatamente 1 cadastro P; encontrados %', v_quantidade; end if;
  if v_funcionario_id is not null then raise exception 'LIMPEZA_P_ABORTADA: cadastro P possui funcionario_id; alternativa segura: inativacao'; end if;

  for v_fk in
    select n.nspname as schema_name, r.relname as table_name, a.attname as column_name, c.conname
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    cross join lateral generate_subscripts(c.confkey, 1) pos
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[pos]
    where c.contype = 'f'
      and c.confrelid = 'public.ro_funcionarios_enderecos_privados'::regclass
      and c.confkey[pos] = (select attnum from pg_attribute where attrelid = c.confrelid and attname = 'id' and not attisdropped)
  loop
    execute format('select count(*) from %I.%I where %I = $1', v_fk.schema_name, v_fk.table_name, v_fk.column_name)
      into v_referencias using v_id;
    if v_referencias > 0 then
      raise exception 'LIMPEZA_P_ABORTADA: % referencia(s) em %.% pela FK %; alternativa segura: inativacao', v_referencias, v_fk.schema_name, v_fk.table_name, v_fk.conname;
    end if;
  end loop;

  delete from public.ro_funcionarios_enderecos_privados where id = v_id and trim(nome) = 'P' and funcionario_id is null;
  get diagnostics v_excluidos = row_count;
  if v_excluidos <> 1 then raise exception 'LIMPEZA_P_ABORTADA: DELETE nao afetou exatamente 1 cadastro'; end if;
end $$;

commit;
