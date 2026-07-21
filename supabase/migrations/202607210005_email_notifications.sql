create table if not exists public.ro_email_logs (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid references public.ro_passagem_solicitacoes(id) on delete set null,
  tipo_evento text not null check (tipo_evento in ('nova_solicitacao_ro','passagem_comprada_solicitante')),
  canal text not null default 'email' check (canal='email'),
  destinatario_tipo text not null check (destinatario_tipo in ('ro','solicitante')),
  destinatario_user_id uuid,
  destinatario_email text,
  assunto text,
  status text not null check (status in ('pendente','enviado','erro','ignorado')),
  erro text,
  provider_message_id text,
  payload jsonb,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);

create index if not exists ro_email_logs_solicitacao_idx on public.ro_email_logs(solicitacao_id);
create index if not exists ro_email_logs_status_criado_idx on public.ro_email_logs(status,criado_em desc);
alter table public.ro_email_logs enable row level security;

drop policy if exists ro_email_logs_select on public.ro_email_logs;
create policy ro_email_logs_select on public.ro_email_logs
for select to authenticated using(public.ro_can_view_all());

-- Escrita é exclusiva do backend com service role. Não existe policy de escrita
-- para authenticated/anon e a Edge Function nunca repassa destinatários do cliente.
revoke insert,update,delete on public.ro_email_logs from anon,authenticated;
grant select on public.ro_email_logs to authenticated;
