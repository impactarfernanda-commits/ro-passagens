begin;

-- Finalização operacional do RO. Não representa nem altera a chegada do funcionário.
-- A assinatura anterior permanece disponível temporariamente para o frontend publicado.
create or replace function public.ro_finalizar_solicitacao(
  p_solicitacao_id uuid,
  p_observacao_operacional text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anterior text;
  v_observacao text;
begin
  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;

  if not coalesce(public.ro_can_operate(), false) then
    raise exception 'APENAS_RESPONSAVEL_RO_ATIVO_PODE_FINALIZAR';
  end if;

  v_observacao := nullif(btrim(regexp_replace(coalesce(p_observacao_operacional, ''), '\s+', ' ', 'g')), '');
  if char_length(v_observacao) > 1000 then
    raise exception 'OBSERVACAO_OPERACIONAL_MAXIMO_1000_CARACTERES';
  end if;

  select status
    into v_anterior
    from public.ro_passagem_solicitacoes
   where id = p_solicitacao_id
     and excluida_em is null
   for update;

  if not found then
    raise exception 'SOLICITACAO_NAO_ENCONTRADA';
  end if;

  if v_anterior <> 'passagem_comprada' then
    raise exception 'SOMENTE_PASSAGEM_COMPRADA_PODE_SER_FINALIZADA';
  end if;

  update public.ro_passagem_solicitacoes
     set status = 'finalizada',
         observacao_finalizacao = v_observacao,
         finalizado_por = auth.uid(),
         finalizado_em = now()
   where id = p_solicitacao_id;

  insert into public.ro_passagem_historico(
    solicitacao_id,
    status_anterior,
    status_novo,
    descricao,
    criado_por
  ) values (
    p_solicitacao_id,
    v_anterior,
    'finalizada',
    case
      when v_observacao is null then 'Atividades do RO finalizadas.'
      else 'Atividades do RO finalizadas. Observação: ' || v_observacao
    end,
    auth.uid()
  );
end
$$;

revoke all on function public.ro_finalizar_solicitacao(uuid,text) from public,anon;
grant execute on function public.ro_finalizar_solicitacao(uuid,text) to authenticated;

-- Wrapper retrocompatível: preserva os nomes esperados pelo PostgREST e ignora
-- os campos legados de chegada e imprevisto.
create or replace function public.ro_finalizar_solicitacao(
  p_solicitacao_id uuid,
  p_chegou_ao_destino boolean,
  p_data_chegada_confirmada date,
  p_houve_imprevisto boolean,
  p_observacao_finalizacao text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.ro_finalizar_solicitacao(
    p_solicitacao_id,
    p_observacao_finalizacao
  );
end
$$;

revoke all on function public.ro_finalizar_solicitacao(uuid,boolean,date,boolean,text) from public,anon;
grant execute on function public.ro_finalizar_solicitacao(uuid,boolean,date,boolean,text) to authenticated;

commit;
