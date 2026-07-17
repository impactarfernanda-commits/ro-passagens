create table if not exists public.ro_passagem_anexos (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.ro_passagem_solicitacoes(id) on delete cascade,
  tipo text not null default 'passagem_pdf' check (tipo = 'passagem_pdf'),
  nome_arquivo text not null,
  storage_path text not null unique,
  mime_type text,
  tamanho_bytes bigint check (tamanho_bytes is null or tamanho_bytes >= 0),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists ro_anexos_solicitacao_idx
on public.ro_passagem_anexos(solicitacao_id);

alter table public.ro_passagem_anexos enable row level security;

drop policy if exists ro_anexos_select on public.ro_passagem_anexos;
create policy ro_anexos_select on public.ro_passagem_anexos
for select to authenticated
using (
  exists (
    select 1 from public.ro_passagem_solicitacoes s
    where s.id = solicitacao_id
  )
);

drop policy if exists ro_anexos_write on public.ro_passagem_anexos;
create policy ro_anexos_write on public.ro_passagem_anexos
for all to authenticated
using (public.ro_is_admin_or_ro())
with check (public.ro_is_admin_or_ro() and uploaded_by = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ro-passagem-anexos', 'ro-passagem-anexos', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ro_storage_select on storage.objects;
create policy ro_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'ro-passagem-anexos'
  and exists (
    select 1 from public.ro_passagem_solicitacoes s
    where s.id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists ro_storage_insert on storage.objects;
create policy ro_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ro-passagem-anexos'
  and public.ro_is_admin_or_ro()
  and exists (
    select 1 from public.ro_passagem_solicitacoes s
    where s.id::text = (storage.foldername(name))[1]
      and s.status in ('solicitada', 'em_analise')
  )
);

drop policy if exists ro_storage_delete on storage.objects;
create policy ro_storage_delete on storage.objects
for delete to authenticated
using (bucket_id = 'ro-passagem-anexos' and public.ro_is_admin_or_ro());

create or replace function public.ro_marcar_notificacao_com_anexo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ro_passagem_notificacoes
  set mensagem = mensagem || ' A passagem possui PDF anexado.'
  where solicitacao_id = new.solicitacao_id
    and destinatario_tipo in ('solicitante', 'funcionario')
    and mensagem not like '%possui PDF anexado.%';
  return new;
end
$$;

drop trigger if exists ro_notificacao_anexo on public.ro_passagem_anexos;
create trigger ro_notificacao_anexo
after insert on public.ro_passagem_anexos
for each row execute function public.ro_marcar_notificacao_com_anexo();

create or replace function public.ro_incluir_anexo_na_notificacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.destinatario_tipo in ('solicitante', 'funcionario')
     and exists (
       select 1 from public.ro_passagem_anexos a
       where a.solicitacao_id = new.solicitacao_id
     ) then
    new.mensagem = new.mensagem || ' A passagem possui PDF anexado.';
  end if;
  return new;
end
$$;

drop trigger if exists ro_notificacao_possui_anexo
on public.ro_passagem_notificacoes;

create trigger ro_notificacao_possui_anexo
before insert on public.ro_passagem_notificacoes
for each row execute function public.ro_incluir_anexo_na_notificacao();
