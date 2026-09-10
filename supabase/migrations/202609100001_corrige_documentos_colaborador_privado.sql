begin;

create or replace function public.ro_criar_solicitacao_colaborador_validada_pre_operacional(
  p_solicitacao jsonb,
  p_documentos jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,storage,pg_temp
as $$
declare
  v_colaborador uuid:=nullif(p_solicitacao->>'colaborador_id','')::uuid;
  v_funcionario uuid:=nullif(p_solicitacao->>'funcionario_id','')::uuid;
  v_id uuid:=coalesce(nullif(p_solicitacao->>'id','')::uuid,gen_random_uuid());
  v_motivo text:=nullif(p_solicitacao->>'motivo','');
  v_doc jsonb;
  v_obj storage.objects%rowtype;
begin
  if v_colaborador is null then
    return public.ro_criar_solicitacao_validada_pre_operacional(p_solicitacao,p_documentos);
  end if;

  select funcionario_id
    into v_funcionario
    from public.ro_funcionarios_enderecos_privados
   where id=v_colaborador
     and ativo;
  if not found then raise exception 'COLABORADOR_INATIVO_OU_INEXISTENTE';end if;

  for v_doc in
    select value from jsonb_array_elements(coalesce(p_documentos,'[]'::jsonb))
  loop
    select *
      into v_obj
      from storage.objects o
     where o.bucket_id='ro-documentos-internos'
       and o.name=v_doc->>'storage_path'
       and o.owner_id::text=auth.uid()::text;
    if not found then raise exception 'DOCUMENTO_NAO_ENCONTRADO_OU_SEM_PERMISSAO';end if;
    if (v_doc->>'storage_path') not like v_id::text||'/'||(v_doc->>'categoria')||'/%' then raise exception 'CAMINHO_DOCUMENTO_INVALIDO';end if;
    if coalesce(v_obj.metadata->>'mimetype','')<>'application/pdf' or lower(storage.extension(v_obj.name))<>'pdf' then raise exception 'DOCUMENTO_NAO_PDF';end if;
    if coalesce((v_obj.metadata->>'size')::bigint,0)<=0 or (v_obj.metadata->>'size')::bigint>10485760 then raise exception 'DOCUMENTO_TAMANHO_INVALIDO';end if;

    insert into public.ro_passagem_documentos_internos(
      id,solicitacao_id,categoria,storage_path,arquivo_nome,mime_type,tamanho_bytes,created_by
    ) values (
      gen_random_uuid(),v_id,v_doc->>'categoria',v_doc->>'storage_path',v_doc->>'arquivo_nome',
      'application/pdf',(v_obj.metadata->>'size')::bigint,auth.uid()
    );
  end loop;

  insert into public.ro_passagem_solicitacoes(
    id,colaborador_id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,
    data_retorno,destino_retorno,centro_custo_retorno_id,retorno_indefinido,
    centro_custo_destino_id,desligamento_subtipo,justificativa_excecao_prazo,
    observacoes_solicitante,solicitacao_origem_id,folga_antecipacao_justificativa,
    destino_residencial_origem,destino_residencial_justificativa
  ) values (
    v_id,v_colaborador,v_funcionario,nullif(p_solicitacao->>'obra_id','')::uuid,auth.uid(),
    p_solicitacao->>'origem',p_solicitacao->>'destino',v_motivo,
    nullif(p_solicitacao->>'data_ida','')::date,nullif(p_solicitacao->>'data_retorno','')::date,
    nullif(trim(p_solicitacao->>'destino_retorno'),''),
    nullif(p_solicitacao->>'centro_custo_retorno_id','')::uuid,
    coalesce((p_solicitacao->>'retorno_indefinido')::boolean,false),
    nullif(p_solicitacao->>'centro_custo_destino_id','')::uuid,
    nullif(p_solicitacao->>'desligamento_subtipo',''),
    nullif(trim(p_solicitacao->>'justificativa_excecao_prazo'),''),
    nullif(p_solicitacao->>'observacoes_solicitante',''),
    nullif(p_solicitacao->>'solicitacao_origem_id','')::uuid,
    nullif(trim(p_solicitacao->>'folga_antecipacao_justificativa'),''),
    case
      when coalesce((p_solicitacao->>'usar_destino_excepcional')::boolean,false) then 'excepcional'
      when v_motivo in ('ferias','folga_campo','recesso') then 'rh'
    end,
    nullif(trim(p_solicitacao->>'destino_residencial_justificativa'),'')
  );

  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  values(
    'solicitacao_colaborador_privado_criada',v_id,
    jsonb_build_object('colaborador_id',v_colaborador,'vinculado_obras',v_funcionario is not null),
    auth.uid()
  );
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  select 'documento_interno_anexado',v_id,jsonb_build_object('categoria',d.categoria),auth.uid()
    from public.ro_passagem_documentos_internos d
   where d.solicitacao_id=v_id;

  return v_id;
end
$$;

revoke all on function public.ro_criar_solicitacao_colaborador_validada_pre_operacional(jsonb,jsonb)
from public,anon,authenticated;

grant execute on function public.ro_criar_solicitacao_colaborador_validada_pre_operacional(jsonb,jsonb)
to service_role;

commit;
