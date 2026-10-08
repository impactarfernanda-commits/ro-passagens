begin;

create table public.ro_denise_autorizados(
  user_id uuid primary key,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table public.ro_denise_autorizados enable row level security;
revoke all on table public.ro_denise_autorizados from public,anon,authenticated;

insert into public.ro_denise_autorizados(user_id,ativo)
values('d6081413-3730-41f0-981d-935a44303993',true);

create or replace function public.ro_is_denise(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select p_user is not null and exists(
    select 1 from public.ro_denise_autorizados d
    where d.user_id=p_user and d.ativo
  );
$$;
revoke all on function public.ro_is_denise(uuid) from public,anon;
grant execute on function public.ro_is_denise(uuid) to authenticated;

commit;
