-- RO Passagens: objetos isolados. Não altera dados nem políticas das tabelas existentes.
create extension if not exists pgcrypto;

create table if not exists public.ro_passagem_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id),
  obra_id uuid references public.obras(id),
  solicitante_id uuid not null references auth.users(id),
  origem text not null,
  destino text not null,
  motivo text not null check (motivo in ('ferias','folga_campo','desligamento')),
  data_ida date not null,
  data_retorno date,
  status text not null default 'solicitada' check (status in ('solicitada','em_analise','passagem_comprada','finalizada','cancelada')),
  observacoes_solicitante text,
  observacoes_ro text,
  tipo_transporte text check (tipo_transporte is null or tipo_transporte in ('aereo','onibus','outro')),
  companhia text,
  localizador text,
  origem_comprada text,
  destino_comprado text,
  partida_em timestamptz,
  chegada_em timestamptz,
  comprado_em timestamptz,
  comprado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ro_datas_validas check (data_retorno is null or data_retorno >= data_ida),
  constraint ro_horarios_validos check (chegada_em is null or partida_em is null or chegada_em >= partida_em)
);

create table if not exists public.ro_passagem_custos (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.ro_passagem_solicitacoes(id) on delete cascade,
  tipo text not null check (tipo in ('passagem','uber','refeicao','outros')),
  descricao text,
  valor numeric(12,2) not null default 0 check (valor >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.ro_passagem_notificacoes (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.ro_passagem_solicitacoes(id) on delete cascade,
  canal text not null check (canal in ('email','whatsapp','interno')),
  destinatario_tipo text not null check (destinatario_tipo in ('ro','solicitante','funcionario')),
  destinatario text,
  mensagem text not null,
  status text not null default 'pendente',
  erro text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.ro_responsaveis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.ro_passagem_historico (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.ro_passagem_solicitacoes(id) on delete cascade,
  status_anterior text,
  status_novo text,
  descricao text not null,
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists ro_sol_status_idx on public.ro_passagem_solicitacoes(status);
create index if not exists ro_sol_solicitante_idx on public.ro_passagem_solicitacoes(solicitante_id);
create index if not exists ro_sol_funcionario_idx on public.ro_passagem_solicitacoes(funcionario_id);
create index if not exists ro_custos_sol_idx on public.ro_passagem_custos(solicitacao_id);
create index if not exists ro_notif_sol_idx on public.ro_passagem_notificacoes(solicitacao_id);

create or replace function public.ro_is_admin_or_ro(p_user uuid default auth.uid())
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
  )
  or exists (
    select 1
    from public.user_roles
    where user_id = p_user
      and role::text in ('gerente','diretor')
  );
$$;

create or replace function public.ro_is_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = p_user
      and role::text in ('gerente','diretor')
  );
$$;

revoke all on function public.ro_is_admin_or_ro(uuid) from public;
grant execute on function public.ro_is_admin_or_ro(uuid) to authenticated;

revoke all on function public.ro_is_admin(uuid) from public;
grant execute on function public.ro_is_admin(uuid) to authenticated;

alter table public.ro_passagem_solicitacoes enable row level security;
alter table public.ro_passagem_custos enable row level security;
alter table public.ro_passagem_notificacoes enable row level security;
alter table public.ro_responsaveis enable row level security;
alter table public.ro_passagem_historico enable row level security;

drop policy if exists ro_sol_select on public.ro_passagem_solicitacoes;
create policy ro_sol_select
on public.ro_passagem_solicitacoes
for select
to authenticated
using (
  solicitante_id = auth.uid()
  or public.ro_is_admin_or_ro()
);

drop policy if exists ro_sol_insert on public.ro_passagem_solicitacoes;
create policy ro_sol_insert
on public.ro_passagem_solicitacoes
for insert
to authenticated
with check (
  solicitante_id = auth.uid()
  and status = 'solicitada'
);

drop policy if exists ro_sol_update on public.ro_passagem_solicitacoes;
create policy ro_sol_update
on public.ro_passagem_solicitacoes
for update
to authenticated
using (public.ro_is_admin_or_ro())
with check (public.ro_is_admin_or_ro());

drop policy if exists ro_child_cost_select on public.ro_passagem_custos;
create policy ro_child_cost_select
on public.ro_passagem_custos
for select
to authenticated
using (
  exists (
    select 1
    from public.ro_passagem_solicitacoes s
    where s.id = solicitacao_id
  )
);

drop policy if exists ro_child_cost_write on public.ro_passagem_custos;
create policy ro_child_cost_write
on public.ro_passagem_custos
for all
to authenticated
using (public.ro_is_admin_or_ro())
with check (public.ro_is_admin_or_ro());

drop policy if exists ro_child_notif_select on public.ro_passagem_notificacoes;
create policy ro_child_notif_select
on public.ro_passagem_notificacoes
for select
to authenticated
using (
  exists (
    select 1
    from public.ro_passagem_solicitacoes s
    where s.id = solicitacao_id
  )
);

drop policy if exists ro_child_notif_write on public.ro_passagem_notificacoes;
create policy ro_child_notif_write
on public.ro_passagem_notificacoes
for all
to authenticated
using (public.ro_is_admin_or_ro())
with check (public.ro_is_admin_or_ro());

drop policy if exists ro_child_hist_select on public.ro_passagem_historico;
create policy ro_child_hist_select
on public.ro_passagem_historico
for select
to authenticated
using (
  exists (
    select 1
    from public.ro_passagem_solicitacoes s
    where s.id = solicitacao_id
  )
);

drop policy if exists ro_child_hist_write on public.ro_passagem_historico;
create policy ro_child_hist_write
on public.ro_passagem_historico
for insert
to authenticated
with check (public.ro_is_admin_or_ro());

drop policy if exists ro_resp_select on public.ro_responsaveis;
create policy ro_resp_select
on public.ro_responsaveis
for select
to authenticated
using (
  user_id = auth.uid()
  or public.ro_is_admin()
);

drop policy if exists ro_resp_admin on public.ro_responsaveis;
create policy ro_resp_admin
on public.ro_responsaveis
for all
to authenticated
using (public.ro_is_admin())
with check (public.ro_is_admin());

create or replace function public.ro_on_solicitacao_criada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_ro record;
begin
  select nome
  into v_nome
  from public.funcionarios
  where id = new.funcionario_id;

  insert into public.ro_passagem_historico (
    solicitacao_id,
    status_novo,
    descricao,
    criado_por
  )
  values (
    new.id,
    new.status,
    'Solicitação criada.',
    new.solicitante_id
  );

  for v_ro in
    select user_id
    from public.ro_responsaveis
    where ativo
  loop
    insert into public.ro_passagem_notificacoes (
      solicitacao_id,
      canal,
      destinatario_tipo,
      destinatario,
      mensagem
    )
    values (
      new.id,
      'interno',
      'ro',
      v_ro.user_id::text,
      format(
        'Nova solicitação de passagem criada para %s, motivo %s, origem %s, destino %s.',
        v_nome,
        new.motivo,
        new.origem,
        new.destino
      )
    );
  end loop;

  return new;
end
$$;

drop trigger if exists ro_solicitacao_criada on public.ro_passagem_solicitacoes;
create trigger ro_solicitacao_criada
after insert on public.ro_passagem_solicitacoes
for each row
execute function public.ro_on_solicitacao_criada();

create or replace function public.ro_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists ro_updated_at on public.ro_passagem_solicitacoes;
create trigger ro_updated_at
before update on public.ro_passagem_solicitacoes
for each row
execute function public.ro_set_updated_at();

create or replace function public.ro_registrar_compra(
  p_solicitacao_id uuid,
  p_tipo_transporte text,
  p_companhia text,
  p_localizador text,
  p_origem_comprada text,
  p_destino_comprado text,
  p_partida_em timestamptz,
  p_chegada_em timestamptz,
  p_observacoes_ro text,
  p_custos jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sol public.ro_passagem_solicitacoes%rowtype;
  v_nome text;
  v_item jsonb;
begin
  if not public.ro_is_admin_or_ro() then
    raise exception 'Apenas responsáveis RO podem registrar compras';
  end if;

  select *
  into v_sol
  from public.ro_passagem_solicitacoes
  where id = p_solicitacao_id
  for update;

  if not found then
    raise exception 'Solicitação não encontrada';
  end if;

  update public.ro_passagem_solicitacoes
  set
    tipo_transporte = p_tipo_transporte,
    companhia = p_companhia,
    localizador = p_localizador,
    origem_comprada = p_origem_comprada,
    destino_comprado = p_destino_comprado,
    partida_em = p_partida_em,
    chegada_em = p_chegada_em,
    observacoes_ro = p_observacoes_ro,
    status = 'passagem_comprada',
    comprado_em = now(),
    comprado_por = auth.uid()
  where id = p_solicitacao_id;

  delete from public.ro_passagem_custos
  where solicitacao_id = p_solicitacao_id;

  for v_item in
    select *
    from jsonb_array_elements(coalesce(p_custos, '[]'::jsonb))
  loop
    insert into public.ro_passagem_custos (
      solicitacao_id,
      tipo,
      descricao,
      valor,
      created_by
    )
    values (
      p_solicitacao_id,
      v_item ->> 'tipo',
      v_item ->> 'descricao',
      coalesce((v_item ->> 'valor')::numeric, 0),
      auth.uid()
    );
  end loop;

  select nome
  into v_nome
  from public.funcionarios
  where id = v_sol.funcionario_id;

  insert into public.ro_passagem_notificacoes (
    solicitacao_id,
    canal,
    destinatario_tipo,
    destinatario,
    mensagem
  )
  values (
    p_solicitacao_id,
    'interno',
    'solicitante',
    v_sol.solicitante_id::text,
    format('Passagem comprada para %s. Localizador: %s.', v_nome, p_localizador)
  );

  if v_sol.motivo <> 'desligamento' then
    insert into public.ro_passagem_notificacoes (
      solicitacao_id,
      canal,
      destinatario_tipo,
      destinatario,
      mensagem
    )
    values (
      p_solicitacao_id,
      'interno',
      'funcionario',
      v_sol.funcionario_id::text,
      format('Sua passagem foi comprada. Localizador: %s.', p_localizador)
    );
  else
    insert into public.ro_passagem_historico (
      solicitacao_id,
      status_anterior,
      status_novo,
      descricao,
      criado_por
    )
    values (
      p_solicitacao_id,
      v_sol.status,
      'passagem_comprada',
      'Notificação ao funcionário não enviada automaticamente por se tratar de desligamento.',
      auth.uid()
    );
  end if;

  insert into public.ro_passagem_historico (
    solicitacao_id,
    status_anterior,
    status_novo,
    descricao,
    criado_por
  )
  values (
    p_solicitacao_id,
    v_sol.status,
    'passagem_comprada',
    'Compra registrada pela equipe RO.',
    auth.uid()
  );
end
$$;

revoke all on function public.ro_registrar_compra(
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  jsonb
) from public;

grant execute on function public.ro_registrar_compra(
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  jsonb
) to authenticated;
