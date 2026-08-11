begin;

-- Igual à normalização usada pela importação: caixa, acentos, pontuação e espaços.
create or replace function public.ro_normalizar_nome_colaborador(p_nome text)
returns text language sql immutable strict set search_path=public,pg_temp as $$
  select trim(regexp_replace(regexp_replace(lower(translate(p_nome,
    'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn')),
    '[._:/\\-]+',' ','g'),'\s+',' ','g'));
$$;

create or replace function public.ro_catalogo_funcionarios_obras_matching_rh()
returns table(id uuid,nome text,ativo boolean,colaborador_id uuid)
language plpgsql stable security definer set search_path=public,pg_temp as $$ begin
  if not public.ro_can_manage_private_addresses() then raise exception 'ACESSO_NEGADO'; end if;
  return query
    select f.id,f.nome,f.ativo,e.id
    from public.funcionarios f
    left join public.ro_funcionarios_enderecos_privados e on e.funcionario_id=f.id
    where f.ativo and f.deleted_at is null and f.visivel_obras_control
    order by f.nome,f.id;
end $$;

-- Revalida o matching sob lock. Assim a RPC não confia no resultado antigo da tela.
create or replace function public.ro_salvar_colaborador_viagem(p_colaborador jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid:=nullif(p_colaborador->>'id','')::uuid;
  v_funcionario uuid:=nullif(p_colaborador->>'funcionario_id','')::uuid;
  v_nome text:=trim(coalesce(p_colaborador->>'nome',''));
  v_nome_normalizado text;
  v_cpf text:=nullif(regexp_replace(coalesce(p_colaborador->>'cpf',''),'\D','','g'),'');
  v_phone text:=nullif(regexp_replace(coalesce(p_colaborador->>'telefone',''),'\D','','g'),'');
  v_count integer;v_candidate uuid;v_op text;
begin
  if not public.ro_can_manage_private_addresses() then raise exception 'ACESSO_NEGADO';end if;
  if length(v_nome)=0 then raise exception 'NOME_OBRIGATORIO';end if;
  if v_cpf is not null and (length(v_cpf)<>11 or v_cpf ~ '^(\d)\1{10}$') then raise exception 'CPF_INVALIDO';end if;
  v_nome_normalizado:=public.ro_normalizar_nome_colaborador(v_nome);
  perform pg_advisory_xact_lock(hashtextextended(v_nome_normalizado,0));

  -- 1 CPF privado, 2 vínculo já existente, 3 nome privado exato.
  if v_id is null and v_cpf is not null then select id into v_id from public.ro_funcionarios_enderecos_privados where cpf=v_cpf;end if;
  if v_id is null and v_funcionario is not null then select id into v_id from public.ro_funcionarios_enderecos_privados where funcionario_id=v_funcionario;end if;
  if v_id is null then
    select count(*),(array_agg(id order by id))[1] into v_count,v_candidate from public.ro_funcionarios_enderecos_privados where public.ro_normalizar_nome_colaborador(nome)=v_nome_normalizado;
    if v_count=1 then v_id:=v_candidate; elsif v_count>1 then raise exception 'NOME_PRIVADO_AMBIGUO';end if;
  end if;

  -- 4 resolve nome exato apenas com um único candidato Obras; nunca faz fuzzy matching.
  select count(*),(array_agg(f.id order by f.id))[1] into v_count,v_candidate from public.funcionarios f
  where f.ativo and f.deleted_at is null and f.visivel_obras_control
    and public.ro_normalizar_nome_colaborador(f.nome)=v_nome_normalizado;
  if v_funcionario is null and v_count=1 then v_funcionario:=v_candidate;
  elsif v_funcionario is not null and not exists(select 1 from public.funcionarios f where f.id=v_funcionario and f.ativo and f.deleted_at is null and f.visivel_obras_control and public.ro_normalizar_nome_colaborador(f.nome)=v_nome_normalizado) then
    raise exception 'VINCULO_OBRAS_INVALIDO';
  end if;
  if v_funcionario is null and v_count=1 then raise exception 'VINCULO_OBRAS_OBRIGATORIO';end if;
  if v_funcionario is not null and exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.funcionario_id=v_funcionario and (v_id is null or e.id<>v_id)) then raise exception 'FUNCIONARIO_OBRAS_JA_VINCULADO';end if;
  if v_cpf is not null and exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.cpf=v_cpf and (v_id is null or e.id<>v_id)) then raise exception 'CPF_ASSOCIADO_A_OUTRO_COLABORADOR';end if;

  if v_id is null then
    insert into public.ro_funcionarios_enderecos_privados(funcionario_id,nome,data_nascimento,cpf,rg,telefone,logradouro,bairro,cidade,uf,ativo,criado_por,atualizado_por)
    values(v_funcionario,v_nome,nullif(p_colaborador->>'data_nascimento','')::date,v_cpf,nullif(trim(p_colaborador->>'rg'),''),v_phone,nullif(trim(p_colaborador->>'logradouro'),''),nullif(trim(p_colaborador->>'bairro'),''),nullif(trim(p_colaborador->>'cidade'),''),nullif(upper(trim(p_colaborador->>'estado')),''),coalesce((p_colaborador->>'ativo')::boolean,true),auth.uid(),auth.uid()) returning id into v_id;v_op:='criacao';
  else
    update public.ro_funcionarios_enderecos_privados set funcionario_id=coalesce(v_funcionario,funcionario_id),nome=v_nome,data_nascimento=coalesce(nullif(p_colaborador->>'data_nascimento','')::date,data_nascimento),cpf=coalesce(v_cpf,cpf),rg=coalesce(nullif(trim(p_colaborador->>'rg'),''),rg),telefone=coalesce(v_phone,telefone),logradouro=coalesce(nullif(trim(p_colaborador->>'logradouro'),''),logradouro),bairro=coalesce(nullif(trim(p_colaborador->>'bairro'),''),bairro),cidade=coalesce(nullif(trim(p_colaborador->>'cidade'),''),cidade),uf=coalesce(nullif(upper(trim(p_colaborador->>'estado')),''),uf),ativo=coalesce((p_colaborador->>'ativo')::boolean,ativo),atualizado_em=now(),atualizado_por=auth.uid() where id=v_id;v_op:='atualizacao';
  end if;
  insert into public.ro_colaboradores_auditoria(colaborador_id,operacao,campos_alterados,criado_por) values(v_id,v_op,array(select jsonb_object_keys(p_colaborador-'cpf'-'rg')),auth.uid());return v_id;
end $$;

create or replace function public.ro_importar_colaboradores_rh(p_arquivo_nome text,p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;v_id uuid;v_existed boolean;v_cpf text;v_total int:=jsonb_array_length(coalesce(p_linhas,'[]'));v_novos int:=0;v_vinculados int:=0;v_externos int:=0;v_updates int:=0;v_erros int:=0;begin
 if not public.ro_can_manage_private_addresses() then raise exception 'ACESSO_NEGADO';end if;
 for v in select value from jsonb_array_elements(coalesce(p_linhas,'[]')) loop
  if v->>'status' not in ('novo_vinculado','novo_externo','atualizacao') then v_erros:=v_erros+1;continue;end if;
  v_id:=nullif(v->>'colaborador_id','')::uuid;v_cpf:=nullif(regexp_replace(coalesce(v->>'cpf',''),'\D','','g'),'');
  perform pg_advisory_xact_lock(hashtextextended(public.ro_normalizar_nome_colaborador(v->>'nome'),0));
  v_existed:=v_id is not null or exists(select 1 from public.ro_funcionarios_enderecos_privados e where (v_cpf is not null and e.cpf=v_cpf) or (nullif(v->>'funcionario_id','') is not null and e.funcionario_id=nullif(v->>'funcionario_id','')::uuid) or public.ro_normalizar_nome_colaborador(e.nome)=public.ro_normalizar_nome_colaborador(v->>'nome'));
  v_id:=public.ro_salvar_colaborador_viagem(v||jsonb_build_object('id',v_id));
  if v_existed then v_updates:=v_updates+1;
  elsif v->>'status'='novo_vinculado' then v_novos:=v_novos+1;v_vinculados:=v_vinculados+1;
  else v_novos:=v_novos+1;v_externos:=v_externos+1;end if;
  insert into public.ro_colaboradores_auditoria(colaborador_id,operacao,campos_alterados,arquivo_nome,criado_por) values(v_id,'importacao',array(select jsonb_object_keys(v-'cpf'-'rg')),p_arquivo_nome,auth.uid());
 end loop;
 insert into public.ro_enderecos_importacoes_auditoria(arquivo_nome,linhas_processadas,importadas,atualizadas,ignoradas,correspondencias_manuais,criado_por) values(p_arquivo_nome,v_total,v_novos+v_updates,v_updates,v_erros,0,auth.uid());
 return jsonb_build_object('processadas',v_total,'novos',v_novos,'novos_vinculados',v_vinculados,'novos_externos',v_externos,'atualizados',v_updates,'ignorados',v_erros,'funcionarios_obras_criados',0);end $$;

revoke all on function public.ro_normalizar_nome_colaborador(text),public.ro_catalogo_funcionarios_obras_matching_rh() from public,anon;
grant execute on function public.ro_catalogo_funcionarios_obras_matching_rh() to authenticated;
grant execute on function public.ro_normalizar_nome_colaborador(text) to authenticated;

commit;
