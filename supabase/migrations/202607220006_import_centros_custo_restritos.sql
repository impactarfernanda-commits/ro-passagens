-- Importação administrativa de centros de custo exclusivos do RO Passagens.

alter table public.obras
  add column if not exists codigo text,
  add column if not exists descricao text;

-- Nulos são permitidos. Se o legado já contiver códigos repetidos, a migration
-- continua aplicável e a RPC recusará esses códigos até a base ser saneada.
do $$
begin
  if not exists (
    select 1 from public.obras where codigo is not null
     group by lower(codigo) having count(*) > 1
  ) then
    create unique index if not exists obras_codigo_lower_unique_idx
      on public.obras (lower(codigo)) where codigo is not null;
  end if;
end $$;

create or replace function public.ro_importar_centros_custo_restritos(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linha jsonb;
  v_numero integer;
  v_codigo text;
  v_descricao text;
  v_existente uuid;
  v_quantidade integer;
  v_importados integer := 0;
  v_atualizados integer := 0;
  v_ignorados integer := 0;
  v_erros jsonb := '[]'::jsonb;
begin
  if not public.ro_is_system_admin() then
    raise exception 'Acesso restrito à administradora do sistema';
  end if;
  if jsonb_typeof(coalesce(p_linhas, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de importação inválido';
  end if;

  perform pg_advisory_xact_lock(hashtext('ro_importar_centros_custo_restritos'));

  for v_linha in select value from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_numero := case when coalesce(v_linha->>'linha', '') ~ '^\d+$'
      then (v_linha->>'linha')::integer else 0 end;
    v_codigo := nullif(trim(v_linha->>'codigo'), '');
    v_descricao := nullif(trim(v_linha->>'descricao'), '');
    v_existente := null;
    begin
      if v_codigo is null then raise exception 'Código obrigatório'; end if;
      if v_descricao is null then raise exception 'Descrição obrigatória'; end if;

      select count(*) into v_quantidade
        from public.obras o where lower(o.codigo) = lower(v_codigo);
      if v_quantidade > 1 then
        raise exception 'Código duplicado na base; revise os registros existentes';
      end if;
      if v_quantidade = 1 then
        select o.id into v_existente from public.obras o
         where lower(o.codigo) = lower(v_codigo) limit 1;
      end if;

      if v_existente is not null then
        update public.obras
           set nome = v_descricao, descricao = v_descricao,
               tipo_centro_custo = 'administrativo', visivel_obras_control = false,
               visivel_passagens = true, escopo_passagens = 'restrito_ro'
         where id = v_existente
           and (nome is distinct from v_descricao
             or descricao is distinct from v_descricao
             or tipo_centro_custo is distinct from 'administrativo'
             or visivel_obras_control is distinct from false
             or visivel_passagens is distinct from true
             or escopo_passagens is distinct from 'restrito_ro');
        if found then v_atualizados := v_atualizados + 1;
        else v_ignorados := v_ignorados + 1;
        end if;
      else
        select count(*) into v_quantidade
          from public.obras o where lower(trim(o.nome)) = lower(v_descricao);
        if v_quantidade > 0 then
          raise exception 'Já existe centro com o mesmo nome e sem este código; revisão necessária';
        end if;

        insert into public.obras
          (codigo, nome, descricao, tipo_centro_custo, visivel_obras_control, visivel_passagens, escopo_passagens)
        values
          (v_codigo, v_descricao, v_descricao, 'administrativo', false, true, 'restrito_ro');
        v_importados := v_importados + 1;
      end if;
    exception when others then
      v_erros := v_erros || jsonb_build_array(jsonb_build_object(
        'linha', v_numero, 'codigo', coalesce(v_codigo, ''),
        'descricao', coalesce(v_descricao, ''), 'motivo', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object('importados', v_importados, 'atualizados', v_atualizados,
    'ignorados', v_ignorados, 'erros', v_erros);
end;
$$;

revoke all on function public.ro_importar_centros_custo_restritos(jsonb) from public;
revoke all on function public.ro_importar_centros_custo_restritos(jsonb) from anon;
grant execute on function public.ro_importar_centros_custo_restritos(jsonb) to authenticated;
