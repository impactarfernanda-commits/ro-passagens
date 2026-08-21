begin;

-- Autoriza o aprovador individual a resolver somente as identidades ligadas
-- às solicitações destinadas a ele. Não amplia a RLS das solicitações.
create or replace function public.ro_user_labels(p_user_ids uuid[])
returns table(id uuid,label text)
language sql stable security definer set search_path='' as $$
  select u.id,coalesce(nullif(btrim(up.full_name),''),u.email::text,'Usuário sem identificação')
  from auth.users u
  left join public.users_profiles up on up.id=u.id
  where auth.uid() is not null
    and u.id=any(coalesce(p_user_ids,'{}'::uuid[]))
    and (
      u.id=auth.uid()
      or public.ro_can_view_all()
      or exists(select 1 from public.ro_passagem_solicitacoes s where s.solicitante_id=auth.uid() and(s.solicitante_id=u.id or s.responsavel_ro_id=u.id))
      or exists(select 1 from public.ro_passagem_solicitacoes s where s.aprovador_id=auth.uid() and(s.solicitante_id=u.id or s.aprovador_id=u.id))
    );
$$;

revoke all on function public.ro_user_labels(uuid[]) from public,anon;
grant execute on function public.ro_user_labels(uuid[]) to authenticated;

commit;
