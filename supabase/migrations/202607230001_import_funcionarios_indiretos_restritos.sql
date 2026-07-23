-- Importa o modelo real de funcionários indiretos: uma coluna A, sem cabeçalho.
-- A leitura do XLSX ocorre no cliente; esta RPC valida e persiste somente os nomes.

create or replace function public.ro_importar_funcionarios(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linha jsonb;
  v_numero_linha integer;
  v_nome text;
  v_nome_normalizado text;
  v_existente uuid;
  v_vistos text[] := array[]::text[];
  v_importados integer := 0;
  v_atualizados integer := 0;
  v_ignorados integer := 0;
  v_erros jsonb := '[]'::jsonb;
begin
  if not public.ro_is_system_admin() then
    raise exception 'Acesso restrito à administradora do sistema';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Formato de importação inválido';
  end if;

  perform pg_advisory_xact_lock(hashtext('ro_importar_funcionarios'));

  for v_linha in select value from jsonb_array_elements(p_linhas)
  loop
    v_nome := '';
    v_numero_linha := 0;
    begin
      v_numero_linha := coalesce((v_linha->>'linha')::integer, 0);
      v_nome := regexp_replace(
        trim(coalesce(v_linha->>'nome', '')),
        '[[:space:]]+',
        ' ',
        'g'
      );
      if v_nome = '' then
        raise exception 'Nome obrigatório';
      end if;

      v_nome_normalizado := public.normalizar_nome_funcionario(v_nome);
      if v_nome_normalizado = any(v_vistos) then
        v_ignorados := v_ignorados + 1;
        continue;
      end if;
      v_vistos := array_append(v_vistos, v_nome_normalizado);

      select f.id
        into v_existente
        from public.funcionarios f
       where public.normalizar_nome_funcionario(f.nome) = v_nome_normalizado
       order by (f.deleted_at is null) desc, f.created_at
       limit 1;

      if v_existente is null then
        insert into public.funcionarios
          (nome, categoria_mo, ativo, visivel_obras_control, visivel_passagens, escopo_passagens)
        values
          (v_nome, 'Administrativo', true, false, true, 'restrito_ro');
        v_importados := v_importados + 1;
      else
        update public.funcionarios
           set ativo = true,
               visivel_obras_control = false,
               visivel_passagens = true,
               escopo_passagens = 'restrito_ro'
         where id = v_existente
           and (ativo is distinct from true
             or visivel_obras_control is distinct from false
             or visivel_passagens is distinct from true
             or escopo_passagens is distinct from 'restrito_ro');
        if found then
          v_atualizados := v_atualizados + 1;
        else
          v_ignorados := v_ignorados + 1;
        end if;
      end if;
    exception when others then
      v_erros := v_erros || jsonb_build_array(jsonb_build_object(
        'linha', v_numero_linha,
        'nome', v_nome,
        'motivo', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'importados', v_importados,
    'atualizados', v_atualizados,
    'ignorados', v_ignorados,
    'erros', v_erros
  );
end;
$$;

revoke all on function public.ro_importar_funcionarios(jsonb) from public;
revoke all on function public.ro_importar_funcionarios(jsonb) from anon;
grant execute on function public.ro_importar_funcionarios(jsonb) to authenticated;
