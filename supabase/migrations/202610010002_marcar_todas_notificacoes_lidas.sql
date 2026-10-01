begin;

create or replace function public.ro_marcar_todas_notificacoes_lidas()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_marcadas integer;
begin
  if v_user_id is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;

  insert into public.ro_passagem_notificacoes_lidas(notificacao_id,user_id)
  select n.id,v_user_id
  from public.ro_passagem_notificacoes n
  where n.canal='interno'
    and (
      (n.destinatario_tipo='solicitante' and n.destinatario=v_user_id::text)
      or (
        n.destinatario_tipo='ro'
        and n.destinatario is null
        and exists(
          select 1
          from public.ro_responsaveis r
          where r.user_id=v_user_id and r.ativo
        )
      )
    )
  on conflict(notificacao_id,user_id) do nothing;

  get diagnostics v_marcadas = row_count;
  return v_marcadas;
end $$;

revoke all on function public.ro_marcar_todas_notificacoes_lidas() from public,anon;
grant execute on function public.ro_marcar_todas_notificacoes_lidas() to authenticated;

commit;
