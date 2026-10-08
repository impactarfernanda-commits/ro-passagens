begin;
create table public.ro_denise_autorizados(user_id uuid primary key,ativo boolean not null default true,criado_em timestamptz not null default now());
alter table public.ro_denise_autorizados enable row level security;
revoke all on table public.ro_denise_autorizados from public,anon,authenticated;
insert into public.ro_denise_autorizados(user_id,ativo) values('d6081413-3730-41f0-981d-935a44303993',true);
create or replace function public.ro_is_denise(p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
 select p_user is not null and exists(select 1 from public.ro_denise_autorizados d where d.user_id=p_user and d.ativo);
$$;
revoke all on function public.ro_is_denise(uuid) from public,anon;
grant execute on function public.ro_is_denise(uuid) to authenticated;
do $teste$
declare v_teste uuid:=gen_random_uuid();begin
 if not public.ro_is_denise('d6081413-3730-41f0-981d-935a44303993') then raise exception 'SEED_DENISE_FALHOU';end if;
 if public.ro_is_denise(v_teste) or public.ro_is_denise(null) then raise exception 'NEGATIVO_INICIAL_FALHOU';end if;
 insert into public.ro_denise_autorizados(user_id) values(v_teste);
 if not public.ro_is_denise(v_teste) then raise exception 'FIXTURE_SINTETICA_FALHOU';end if;
 perform set_config('request.jwt.claim.sub',v_teste::text,true);
 if auth.uid() is distinct from v_teste or not public.ro_is_denise() then raise exception 'AUTH_UID_SINTETICO_FALHOU';end if;
 update public.ro_denise_autorizados set ativo=false where user_id=v_teste;
 if public.ro_is_denise(v_teste) then raise exception 'DESATIVACAO_FALHOU';end if;
 if has_table_privilege('authenticated','public.ro_denise_autorizados','INSERT') or has_table_privilege('authenticated','public.ro_denise_autorizados','UPDATE') or has_table_privilege('authenticated','public.ro_denise_autorizados','DELETE') then raise exception 'AUTHENTICATED_POSSUI_DML';end if;
end $teste$;
rollback;
