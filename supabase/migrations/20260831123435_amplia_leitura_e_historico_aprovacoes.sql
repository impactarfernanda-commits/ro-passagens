begin;

-- Considera ativo quem ainda existe no Auth, não está banido e não é uma
-- identidade anônima. Conforme a regra do sistema, não há filtro por domínio:
-- toda conta ativa do Supabase Auth é interna para esta permissão de leitura.
create or replace function public.ro_is_active_internal_user()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select auth.uid() is not null
    and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false
    and exists(
      select 1
      from auth.users u
      where u.id=auth.uid()
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=now())
    );
$$;

revoke all on function public.ro_is_active_internal_user() from public,anon;
grant execute on function public.ro_is_active_internal_user() to authenticated;

-- Amplia exclusivamente SELECT. Solicitações excluídas continuam visíveis
-- somente para a equipe que já possuía essa permissão administrativa.
drop policy if exists ro_sol_select on public.ro_passagem_solicitacoes;
create policy ro_sol_select
on public.ro_passagem_solicitacoes
for select
to authenticated
using(
  public.ro_is_active_internal_user()
  and (
    excluida_em is null
    or (excluida_em is not null and public.ro_can_operate())
  )
);

-- A RPC retorna apenas identidades ligadas a solicitações que o chamador
-- consegue ler; isso permite identificar solicitante/aprovador sem transformar
-- a função em um diretório irrestrito de usuários.
create or replace function public.ro_user_labels(p_user_ids uuid[])
returns table(id uuid,label text)
language sql
stable
security definer
set search_path=''
as $$
  select u.id,coalesce(nullif(btrim(up.full_name),''),u.email::text,'Usuário sem identificação')
  from auth.users u
  left join public.users_profiles up on up.id=u.id
  where public.ro_is_active_internal_user()
    and u.id=any(coalesce(p_user_ids,'{}'::uuid[]))
    and exists(
      select 1
      from public.ro_passagem_solicitacoes s
      where s.excluida_em is null
        and u.id in(s.solicitante_id,s.aprovador_id,s.responsavel_ro_id)
    );
$$;

revoke all on function public.ro_user_labels(uuid[]) from public,anon;
grant execute on function public.ro_user_labels(uuid[]) to authenticated;

commit;
