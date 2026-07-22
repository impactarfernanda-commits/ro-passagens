-- Visibilidade compartilhada entre RO Passagens e Obras Control.
-- Compatibilidade: registros existentes permanecem comuns e visíveis nos dois módulos.

alter table public.funcionarios
  add column if not exists visivel_obras_control boolean not null default true,
  add column if not exists visivel_passagens boolean not null default true,
  add column if not exists escopo_passagens text not null default 'comum';

alter table public.obras
  add column if not exists visivel_obras_control boolean not null default true,
  add column if not exists visivel_passagens boolean not null default true,
  add column if not exists escopo_passagens text not null default 'comum',
  add column if not exists tipo_centro_custo text default 'obra';

alter table public.ro_passagem_custos
  add column if not exists centro_custo_id uuid references public.obras(id);

do $$ begin
  alter table public.funcionarios add constraint funcionarios_escopo_passagens_check
    check (escopo_passagens in ('comum','restrito_ro','indisponivel'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.obras add constraint obras_escopo_passagens_check
    check (escopo_passagens in ('comum','restrito_ro','indisponivel'));
exception when duplicate_object then null; end $$;

create index if not exists funcionarios_visibilidade_modulos_idx
  on public.funcionarios (visivel_obras_control, visivel_passagens, escopo_passagens);
create index if not exists obras_visibilidade_modulos_idx
  on public.obras (visivel_obras_control, visivel_passagens, escopo_passagens);
create index if not exists ro_passagem_custos_centro_custo_idx
  on public.ro_passagem_custos (centro_custo_id);

-- Expõe apenas o indicador operacional na view segura já usada pelo Obras Control.
create or replace view public.funcionarios_safe with (security_invoker = on) as
select f.id, f.nome, f.categoria_mo, f.ativo, f.created_at, f.data_admissao,
  f.data_desligamento, f.deleted_at, f.deleted_by,
  (select s.salario from public.get_funcionario_salario_masked(f.id) s) as salario,
  (select s.encargos from public.get_funcionario_salario_masked(f.id) s) as encargos,
  f.visivel_obras_control
from public.funcionarios f;
grant select on public.funcionarios_safe to authenticated;

create or replace function public.ro_is_system_admin(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1
      from public.user_roles ur
      join auth.users u on u.id = ur.user_id
     where p_user = auth.uid()
       and ur.user_id = auth.uid()
       and ur.role::text = 'diretor'
       and lower(coalesce(u.email, '')) = 'fernanda.souza@tanksbr.com.br'
  );
$$;
revoke all on function public.ro_is_system_admin(uuid) from public;
grant execute on function public.ro_is_system_admin(uuid) to authenticated;

create or replace function public.ro_catalogo_funcionarios()
returns table (id uuid, nome text, obra_id uuid)
language sql stable security definer set search_path = public as $$
  select f.id, f.nome,
         (select a.obra_id from public.alocacoes a where a.funcionario_id = f.id order by a.data desc limit 1)
    from public.funcionarios f
   where f.ativo
     and f.deleted_at is null
     and f.visivel_passagens
     and f.escopo_passagens in ('comum','restrito_ro')
     and (f.escopo_passagens = 'comum' or public.ro_can_view_all())
   order by f.nome;
$$;

create or replace function public.ro_catalogo_centros_custo()
returns table (id uuid, nome text)
language sql stable security definer set search_path = public as $$
  select o.id, o.nome
    from public.obras o
   where o.visivel_passagens
     and o.escopo_passagens in ('comum','restrito_ro')
     and (o.escopo_passagens = 'comum' or public.ro_can_view_all())
   order by o.nome;
$$;
revoke all on function public.ro_catalogo_funcionarios() from public;
revoke all on function public.ro_catalogo_centros_custo() from public;
grant execute on function public.ro_catalogo_funcionarios() to authenticated;
grant execute on function public.ro_catalogo_centros_custo() to authenticated;

create or replace function public.ro_validar_solicitacao_visibilidade()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_restrito boolean := public.ro_can_view_all();
begin
  if new.obra_id is null then raise exception 'Centro de custo atual é obrigatório'; end if;
  if not exists (
    select 1 from public.funcionarios f where f.id = new.funcionario_id and f.ativo
      and f.deleted_at is null and f.visivel_passagens
      and (f.escopo_passagens = 'comum' or (v_restrito and f.escopo_passagens = 'restrito_ro'))
  ) then raise exception 'Funcionário indisponível para este solicitante'; end if;
  if not exists (
    select 1 from public.obras o where o.id = new.obra_id and o.visivel_passagens
      and (o.escopo_passagens = 'comum' or (v_restrito and o.escopo_passagens = 'restrito_ro'))
  ) then raise exception 'Centro de custo indisponível para este solicitante'; end if;
  return new;
end $$;
drop trigger if exists ro_validar_solicitacao_visibilidade on public.ro_passagem_solicitacoes;
create trigger ro_validar_solicitacao_visibilidade
before insert or update of funcionario_id, obra_id on public.ro_passagem_solicitacoes
for each row execute function public.ro_validar_solicitacao_visibilidade();

create or replace function public.ro_validar_custo_centro_custo()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.valor > 0 and new.centro_custo_id is null then
    raise exception 'Centro de custo financeiro é obrigatório para custos com valor';
  end if;
  if new.centro_custo_id is not null and not exists (
    select 1 from public.obras o where o.id = new.centro_custo_id and o.visivel_passagens
      and o.escopo_passagens in ('comum','restrito_ro')
  ) then raise exception 'Centro de custo financeiro indisponível'; end if;
  return new;
end $$;
drop trigger if exists ro_validar_custo_centro_custo on public.ro_passagem_custos;
create trigger ro_validar_custo_centro_custo
before insert or update of valor, centro_custo_id on public.ro_passagem_custos
for each row execute function public.ro_validar_custo_centro_custo();

create or replace function public.ro_importar_funcionarios(p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_linha jsonb; v_nome text; v_funcao text; v_ativo boolean; v_existente uuid;
  v_importados integer := 0; v_atualizados integer := 0; v_ignorados integer := 0;
  v_erros jsonb := '[]'::jsonb;
begin
  if not public.ro_is_system_admin() then raise exception 'Acesso restrito à administradora do sistema'; end if;
  for v_linha in select value from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    begin
      v_nome := nullif(trim(v_linha->>'nome'), '');
      if v_nome is null then raise exception 'Nome obrigatório'; end if;
      v_funcao := coalesce(nullif(trim(v_linha->>'funcao'), ''), 'Administrativo');
      v_ativo := lower(coalesce(v_linha->>'status', 'ativo')) not in ('inativo','desligado','false','0');
      select f.id into v_existente from public.funcionarios f
       where public.normalizar_nome_funcionario(f.nome) = public.normalizar_nome_funcionario(v_nome)
       order by (f.deleted_at is null) desc limit 1;
      if v_existente is null then
        insert into public.funcionarios (nome, categoria_mo, ativo, visivel_obras_control, visivel_passagens, escopo_passagens)
        values (v_nome, v_funcao, v_ativo, false, true, 'restrito_ro');
        v_importados := v_importados + 1;
      else
        update public.funcionarios set visivel_obras_control=false, visivel_passagens=true,
          escopo_passagens='restrito_ro' where id=v_existente
          and (visivel_obras_control or not visivel_passagens or escopo_passagens <> 'restrito_ro');
        if found then v_atualizados := v_atualizados + 1; else v_ignorados := v_ignorados + 1; end if;
      end if;
    exception when others then
      v_erros := v_erros || jsonb_build_array(jsonb_build_object('nome', coalesce(v_nome,''), 'erro', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('importados',v_importados,'atualizados',v_atualizados,'ignorados',v_ignorados,'erros',v_erros);
end $$;
revoke all on function public.ro_importar_funcionarios(jsonb) from public;
grant execute on function public.ro_importar_funcionarios(jsonb) to authenticated;

-- Mantém a assinatura existente. Cada item de p_custos agora carrega centro_custo_id.
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
  if v_sol.motivo <> 'desligamento' then
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
