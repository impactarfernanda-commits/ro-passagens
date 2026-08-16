begin;

-- UPDATE direto fica fechado: inserções/remoções dos fluxos existentes continuam
-- protegidas por ro_can_operate(), e edições passam exclusivamente pela RPC auditada.
drop policy if exists ro_child_cost_write on public.ro_passagem_custos;
drop policy if exists ro_child_cost_insert on public.ro_passagem_custos;
create policy ro_child_cost_insert on public.ro_passagem_custos
for insert to authenticated with check(public.ro_can_operate());
drop policy if exists ro_child_cost_delete on public.ro_passagem_custos;
create policy ro_child_cost_delete on public.ro_passagem_custos
for delete to authenticated using(public.ro_can_operate());

create or replace function public.ro_atualizar_custo_operacional(
  p_solicitacao_id uuid,
  p_custo_id uuid,
  p_novo_valor numeric
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_sol public.ro_passagem_solicitacoes%rowtype;
  v_custo public.ro_passagem_custos%rowtype;
  v_total numeric(12,2);
  v_tipo_label text;
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA'; end if;
  if not coalesce(public.ro_can_operate(),false) then
    raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_EDITAR_CUSTOS';
  end if;
  if p_novo_valor is null or p_novo_valor::text in ('NaN','Infinity','-Infinity') or p_novo_valor<=0 then
    raise exception 'VALOR_CUSTO_DEVE_SER_MAIOR_QUE_ZERO';
  end if;

  select * into v_sol from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id for update;
  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA'; end if;
  if v_sol.status in ('cancelada','recusada') then
    raise exception 'SOLICITACAO_NAO_PERMITE_EDICAO_DE_CUSTO';
  end if;

  select * into v_custo from public.ro_passagem_custos
  where id=p_custo_id and solicitacao_id=p_solicitacao_id for update;
  if not found then raise exception 'CUSTO_NAO_PERTENCE_A_SOLICITACAO'; end if;
  if v_custo.tipo not in ('hospedagem','uber','refeicao','outros') then
    raise exception 'TIPO_CUSTO_NAO_EDITAVEL';
  end if;

  update public.ro_passagem_custos
  set valor=p_novo_valor
  where id=v_custo.id;

  v_tipo_label:=case v_custo.tipo when 'hospedagem' then 'Hospedagem' when 'uber' then 'Uber'
    when 'refeicao' then 'Refeição' else 'Outros' end;
  insert into public.ro_passagem_historico(
    solicitacao_id,status_anterior,status_novo,descricao,criado_por
  ) values(
    p_solicitacao_id,v_sol.status,v_sol.status,
    format('%s atualizado de R$ %s para R$ %s.',v_tipo_label,
      replace(to_char(v_custo.valor,'FM999999990D00'),'.',','),
      replace(to_char(p_novo_valor,'FM999999990D00'),'.',',')),auth.uid()
  );

  select coalesce(sum(valor),0) into v_total from public.ro_passagem_custos
  where solicitacao_id=p_solicitacao_id;
  return jsonb_build_object('custo_id',v_custo.id,'tipo',v_custo.tipo,
    'valor_anterior',v_custo.valor,'valor_novo',p_novo_valor,'total',v_total);
end $$;

revoke all on function public.ro_atualizar_custo_operacional(uuid,uuid,numeric) from public,anon;
grant execute on function public.ro_atualizar_custo_operacional(uuid,uuid,numeric) to authenticated;

commit;
