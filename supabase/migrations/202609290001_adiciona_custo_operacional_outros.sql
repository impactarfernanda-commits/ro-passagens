begin;

create or replace function public.ro_adicionar_custo_operacional(
  p_solicitacao_id uuid,
  p_valor numeric,
  p_descricao text,
  p_centro_custo_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_sol public.ro_passagem_solicitacoes%rowtype;
  v_custo_id uuid;
  v_valor numeric(12,2);
  v_descricao text;
  v_total numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;
  if not coalesce(public.ro_can_operate(),false) then
    raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_EDITAR_CUSTOS';
  end if;
  if p_valor is null or p_valor::text in('NaN','Infinity','-Infinity') then
    raise exception 'VALOR_CUSTO_INVALIDO';
  end if;
  v_valor:=round(p_valor,2);
  if v_valor<0.01 or v_valor>9999999999.99 then
    raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';
  end if;
  v_descricao:=nullif(btrim(coalesce(p_descricao,'')),'');
  if v_descricao is null then
    raise exception 'DESCRICAO_CUSTO_OBRIGATORIA';
  end if;

  select * into v_sol
  from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id
  for update;
  if not found then
    raise exception 'SOLICITACAO_NAO_ENCONTRADA';
  end if;
  if v_sol.excluida_em is not null or v_sol.status in('cancelada','recusada') then
    raise exception 'SOLICITACAO_NAO_PERMITE_EDICAO_DE_CUSTO';
  end if;
  if v_sol.aprovacao_status in('pendente','reprovada') then
    raise exception 'SOLICITACAO_NAO_LIBERADA';
  end if;

  if p_centro_custo_id is null
    or not(
      p_centro_custo_id is not distinct from v_sol.obra_id
      or p_centro_custo_id is not distinct from v_sol.centro_custo_destino_id
      or p_centro_custo_id is not distinct from v_sol.centro_custo_retorno_id
    )
    or not exists(
      select 1 from public.obras o
      where o.id=p_centro_custo_id
        and o.visivel_passagens
        and o.escopo_passagens in('comum','restrito_ro')
    )
  then
    raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';
  end if;

  insert into public.ro_passagem_custos(
    solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by
  ) values(
    p_solicitacao_id,'outros',v_descricao,v_valor,p_centro_custo_id,auth.uid()
  ) returning id into v_custo_id;

  insert into public.ro_passagem_historico(
    solicitacao_id,status_anterior,status_novo,descricao,criado_por
  ) values(
    p_solicitacao_id,v_sol.status,v_sol.status,
    format(
      'Custo operacional Outros incluído. Custo: %s. Valor: R$ %s. Centro de custo: %s. Descrição: %s',
      v_custo_id,
      replace(to_char(v_valor,'FM999999990D00'),'.',','),
      p_centro_custo_id,
      v_descricao
    ),
    auth.uid()
  );

  select coalesce(sum(valor),0) into v_total
  from public.ro_passagem_custos
  where solicitacao_id=p_solicitacao_id;

  return jsonb_build_object(
    'custo_id',v_custo_id,
    'tipo','outros',
    'valor',v_valor,
    'descricao',v_descricao,
    'centro_custo_id',p_centro_custo_id,
    'total',v_total
  );
end $$;

revoke all on function public.ro_adicionar_custo_operacional(uuid,numeric,text,uuid) from public,anon;
grant execute on function public.ro_adicionar_custo_operacional(uuid,numeric,text,uuid) to authenticated;

commit;
