-- Separa visualização ampla, operação RO e administração.
-- Idempotente e sem alteração de dados existentes.
create or replace function public.ro_can_operate(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ro_responsaveis
    where user_id = p_user
      and ativo
  );
$$;

create or replace function public.ro_can_view_all(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ro_can_operate(p_user) or public.ro_is_admin(p_user);
$$;

-- Mantém chamadas legadas seguras: o helper antigo não concede mais operação a admin.
create or replace function public.ro_is_admin_or_ro(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ro_can_operate(p_user);
$$;

revoke all on function public.ro_can_operate(uuid) from public;
revoke all on function public.ro_can_view_all(uuid) from public;
revoke all on function public.ro_is_admin_or_ro(uuid) from public;
grant execute on function public.ro_can_operate(uuid) to authenticated;
grant execute on function public.ro_can_view_all(uuid) to authenticated;
grant execute on function public.ro_is_admin_or_ro(uuid) to authenticated;

drop policy if exists ro_sol_select on public.ro_passagem_solicitacoes;
create policy ro_sol_select on public.ro_passagem_solicitacoes
for select to authenticated
using (solicitante_id = auth.uid() or public.ro_can_view_all());

drop policy if exists ro_sol_update on public.ro_passagem_solicitacoes;
create policy ro_sol_update on public.ro_passagem_solicitacoes
for update to authenticated
using (public.ro_can_operate())
with check (public.ro_can_operate());

drop policy if exists ro_child_cost_write on public.ro_passagem_custos;
create policy ro_child_cost_write on public.ro_passagem_custos
for all to authenticated
using (public.ro_can_operate())
with check (public.ro_can_operate());

drop policy if exists ro_child_notif_write on public.ro_passagem_notificacoes;
create policy ro_child_notif_write on public.ro_passagem_notificacoes
for all to authenticated
using (public.ro_can_operate())
with check (public.ro_can_operate());

drop policy if exists ro_child_hist_write on public.ro_passagem_historico;
create policy ro_child_hist_write on public.ro_passagem_historico
for insert to authenticated
with check (public.ro_can_operate());

drop policy if exists ro_anexos_write on public.ro_passagem_anexos;
create policy ro_anexos_write on public.ro_passagem_anexos
for all to authenticated
using (public.ro_can_operate())
with check (public.ro_can_operate() and uploaded_by = auth.uid());

drop policy if exists ro_storage_insert on storage.objects;
create policy ro_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ro-passagem-anexos'
  and public.ro_can_operate()
  and exists (
    select 1 from public.ro_passagem_solicitacoes s
    where s.id::text = (storage.foldername(name))[1]
      and s.status in ('solicitada', 'em_andamento')
  )
);

drop policy if exists ro_storage_delete on storage.objects;
create policy ro_storage_delete on storage.objects
for delete to authenticated
using (bucket_id = 'ro-passagem-anexos' and public.ro_can_operate());

create or replace function public.ro_alterar_status(
  p_solicitacao_id uuid,
  p_status text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_anterior text;
begin
  if not public.ro_can_operate() then
    raise exception 'Apenas responsáveis RO ativos podem executar esta ação.';
  end if;
  if p_status not in ('em_andamento', 'cancelada') then
    raise exception 'Transição de status inválida';
  end if;
  select status into v_anterior
  from public.ro_passagem_solicitacoes
  where id = p_solicitacao_id
  for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  update public.ro_passagem_solicitacoes
  set status = p_status
  where id = p_solicitacao_id;
  insert into public.ro_passagem_historico (
    solicitacao_id, status_anterior, status_novo, descricao, criado_por
  ) values (
    p_solicitacao_id, v_anterior, p_status,
    case when p_status = 'cancelada'
      then 'Solicitação cancelada pela equipe RO.'
      else 'Solicitação colocada em andamento.' end,
    auth.uid()
  );
end
$$;

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
set search_path = public
as $$
declare
  v_anterior text;
begin
  if not public.ro_can_operate() then
    raise exception 'Apenas responsáveis RO ativos podem executar esta ação.';
  end if;
  if (p_houve_imprevisto or not p_chegou_ao_destino)
     and nullif(trim(p_observacao_finalizacao), '') is null then
    raise exception 'A observação é obrigatória quando houve imprevisto ou não chegou ao destino';
  end if;
  select status into v_anterior
  from public.ro_passagem_solicitacoes
  where id = p_solicitacao_id
  for update;
  if v_anterior <> 'passagem_comprada' then
    raise exception 'Somente uma passagem comprada pode ser finalizada';
  end if;
  update public.ro_passagem_solicitacoes set
    status = 'finalizada',
    chegou_ao_destino = p_chegou_ao_destino,
    data_chegada_confirmada = p_data_chegada_confirmada::timestamptz,
    houve_imprevisto = p_houve_imprevisto,
    observacao_finalizacao = nullif(trim(p_observacao_finalizacao), ''),
    finalizado_por = auth.uid(),
    finalizado_em = now()
  where id = p_solicitacao_id;
  insert into public.ro_passagem_historico (
    solicitacao_id, status_anterior, status_novo, descricao, criado_por
  ) values (
    p_solicitacao_id, v_anterior, 'finalizada',
    'Chegada ao destino registrada e solicitação finalizada.', auth.uid()
  );
end
$$;

revoke all on function public.ro_alterar_status(uuid, text) from public;
revoke all on function public.ro_finalizar_solicitacao(uuid, boolean, date, boolean, text) from public;
grant execute on function public.ro_alterar_status(uuid, text) to authenticated;
grant execute on function public.ro_finalizar_solicitacao(uuid, boolean, date, boolean, text) to authenticated;
