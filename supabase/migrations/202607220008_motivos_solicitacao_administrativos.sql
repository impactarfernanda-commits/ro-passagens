-- Novos motivos operacionais e motivo opcional apenas para funcionários restritos RO.

alter table public.ro_passagem_solicitacoes alter column motivo drop not null;

do $$
declare v record;
begin
  for v in
    select conname from pg_constraint
     where conrelid = 'public.ro_passagem_solicitacoes'::regclass
       and contype = 'c' and pg_get_constraintdef(oid) ilike '%motivo%'
  loop
    execute format('alter table public.ro_passagem_solicitacoes drop constraint %I', v.conname);
  end loop;
  alter table public.ro_passagem_solicitacoes add constraint ro_motivo_valido
    check (motivo is null or motivo in (
      'ferias','folga_campo','desligamento','transferencia_obra','viagem_diretoria',
      'admissao','inicio_obra','retorno_obra'
    ));
end $$;

create or replace function public.ro_validar_motivo_funcionario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_restrito boolean;
begin
  select coalesce(
    not f.visivel_obras_control
    and f.visivel_passagens
    and f.escopo_passagens = 'restrito_ro', false
  ) into v_restrito
  from public.funcionarios f where f.id = new.funcionario_id;

  if new.motivo is null and not coalesce(v_restrito, false) then
    raise exception 'Motivo é obrigatório para funcionário operacional';
  end if;
  return new;
end;
$$;

drop trigger if exists ro_validar_motivo_funcionario on public.ro_passagem_solicitacoes;
create trigger ro_validar_motivo_funcionario
before insert or update of funcionario_id, motivo on public.ro_passagem_solicitacoes
for each row execute function public.ro_validar_motivo_funcionario();

create or replace function public.ro_catalogo_funcionarios_solicitacao()
returns table (
  id uuid,
  nome text,
  obra_id uuid,
  visivel_obras_control boolean,
  visivel_passagens boolean,
  escopo_passagens text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.id, f.nome,
         (select a.obra_id from public.alocacoes a where a.funcionario_id=f.id order by a.data desc limit 1),
         f.visivel_obras_control, f.visivel_passagens, f.escopo_passagens
    from public.funcionarios f
   where f.ativo and f.deleted_at is null and f.visivel_passagens
     and f.escopo_passagens in ('comum','restrito_ro')
     and (f.escopo_passagens='comum' or public.ro_can_view_all())
   order by f.nome;
$$;

revoke all on function public.ro_validar_motivo_funcionario() from public;
revoke all on function public.ro_catalogo_funcionarios_solicitacao() from public;
revoke all on function public.ro_catalogo_funcionarios_solicitacao() from anon;
grant execute on function public.ro_catalogo_funcionarios_solicitacao() to authenticated;

-- Mantém a compra compatível com motivo nulo: apenas desligamento bloqueia a notificação.
create or replace function public.ro_registrar_compra(
  p_solicitacao_id uuid, p_tipo_transporte text, p_companhia text, p_localizador text,
  p_origem_comprada text, p_destino_comprado text, p_partida_em timestamptz,
  p_chegada_em timestamptz, p_observacoes_ro text, p_custos jsonb
) returns void language plpgsql security invoker set search_path = public as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype; v_item jsonb; v_nome text;
begin
  if not public.ro_can_operate() then raise exception 'Apenas responsáveis RO ativos podem registrar compras'; end if;
  select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  update public.ro_passagem_solicitacoes set tipo_transporte=p_tipo_transporte, companhia=p_companhia,
    localizador=p_localizador, origem_comprada=p_origem_comprada, destino_comprado=p_destino_comprado,
    partida_em=p_partida_em, chegada_em=p_chegada_em, observacoes_ro=p_observacoes_ro,
    status='passagem_comprada', comprado_em=now(), comprado_por=auth.uid() where id=p_solicitacao_id;
  delete from public.ro_passagem_custos where solicitacao_id=p_solicitacao_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_custos,'[]'::jsonb)) loop
    insert into public.ro_passagem_custos (solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by)
    values (p_solicitacao_id,v_item->>'tipo',v_item->>'descricao',coalesce((v_item->>'valor')::numeric,0),
      nullif(v_item->>'centro_custo_id','')::uuid,auth.uid());
  end loop;
  select nome into v_nome from public.funcionarios where id=v_sol.funcionario_id;
  insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem)
  values(p_solicitacao_id,'interno','solicitante',v_sol.solicitante_id::text,
    format('Passagem comprada para %s. Localizador: %s.',v_nome,p_localizador));
  if v_sol.motivo is distinct from 'desligamento' then
    insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem)
    values(p_solicitacao_id,'interno','funcionario',v_sol.funcionario_id::text,
      format('Sua passagem foi comprada. Localizador: %s.',p_localizador));
  else
    insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
    values(p_solicitacao_id,v_sol.status,'passagem_comprada',
      'Notificação ao funcionário não enviada automaticamente por se tratar de desligamento.',auth.uid());
  end if;
  insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
  values(p_solicitacao_id,v_sol.status,'passagem_comprada','Compra registrada pela equipe RO.',auth.uid());
end $$;
