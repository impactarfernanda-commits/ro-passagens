begin;

-- Preserva integralmente o contrato existente e acrescenta a guarda antes de qualquer efeito.
alter function public.ro_registrar_documentos_pos_compra(uuid,uuid,jsonb,jsonb)
  rename to ro_registrar_documentos_pos_compra_20260930_base;

revoke all on function public.ro_registrar_documentos_pos_compra_20260930_base(uuid,uuid,jsonb,jsonb)
from public,anon,authenticated;

create function public.ro_registrar_documentos_pos_compra(
  p_solicitacao_id uuid,p_operacao_id uuid,p_anexos jsonb,p_grupos jsonb
) returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare
  v_grupo jsonb;
  v_chave text;
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA'; end if;
  if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_REGISTRAR_POS_COMPRA'; end if;
  if p_operacao_id is null then raise exception 'OPERACAO_ID_OBRIGATORIA'; end if;
  if p_grupos is null or jsonb_typeof(p_grupos)<>'array' then raise exception 'GRUPOS_DEVEM_SER_LISTA'; end if;

  -- Serializa operações da solicitação e fecha a corrida entre a verificação e o contrato legado.
  perform 1 from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;

  -- Replay segue para a implementação canônica, que confere o fingerprint e devolve o mesmo resultado.
  if not exists(
    select 1 from public.ro_passagem_operacoes_idempotentes
    where solicitacao_id=p_solicitacao_id and operacao_id=p_operacao_id
  ) then
    for v_grupo in select value from jsonb_array_elements(p_grupos) loop
      if nullif(btrim(v_grupo->>'custo_existente_id'),'') is null then
        v_chave:=public.ro_normalizar_compra_chave(v_grupo->>'compra_chave');
        if exists(
          select 1 from public.ro_passagem_custos c
          where c.solicitacao_id=p_solicitacao_id
            and c.tipo='passagem'
            and c.compra_chave=v_chave
        ) then
          raise exception 'COMPRA_CHAVE_JA_EXISTE_VINCULE_CUSTO';
        end if;
      end if;
    end loop;
  end if;

  return public.ro_registrar_documentos_pos_compra_20260930_base(
    p_solicitacao_id,p_operacao_id,p_anexos,p_grupos
  );
end $$;

revoke all on function public.ro_registrar_documentos_pos_compra(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.ro_registrar_documentos_pos_compra(uuid,uuid,jsonb,jsonb) to authenticated;

commit;
