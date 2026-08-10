begin;

-- Conteúdo integral da migration 202608100002_sso_portal_obras_control.sql.
create table public.portal_sso_handoffs (
  id uuid primary key default gen_random_uuid(), code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade, target_app text not null check (target_app = 'obras-control'),
  return_path text not null check (return_path in ('/alocacoes','/funcionarios','/obras','/dashboard','/relatorios','/custos','/registros','/configuracoes')),
  created_at timestamptz not null default now(), expires_at timestamptz not null check (expires_at > created_at and expires_at <= created_at + interval '120 seconds'),
  consumed_at timestamptz, check (consumed_at is null or consumed_at >= created_at)
);
create index portal_sso_handoffs_cleanup_idx on public.portal_sso_handoffs (expires_at, consumed_at);
alter table public.portal_sso_handoffs enable row level security;
revoke all on public.portal_sso_handoffs from public, anon, authenticated;
grant select, insert, update, delete on public.portal_sso_handoffs to service_role;
create or replace function public.portal_consumir_sso_handoff(p_code_hash text, p_target_app text)
returns table(user_id uuid, return_path text) language sql security definer set search_path = public, pg_temp as $$
 update public.portal_sso_handoffs set consumed_at=now() where code_hash=p_code_hash and target_app=p_target_app and consumed_at is null and expires_at>now()
 returning portal_sso_handoffs.user_id,portal_sso_handoffs.return_path; $$;
revoke all on function public.portal_consumir_sso_handoff(text,text) from public,anon,authenticated;
grant execute on function public.portal_consumir_sso_handoff(text,text) to service_role;
create or replace function public.portal_limpar_sso_handoffs() returns bigint language sql security definer set search_path=public,pg_temp as $$
 with removed as (delete from public.portal_sso_handoffs where expires_at<now()-interval '1 day' returning 1) select count(*) from removed; $$;
revoke all on function public.portal_limpar_sso_handoffs() from public,anon,authenticated;
grant execute on function public.portal_limpar_sso_handoffs() to service_role;

rollback;
