begin;

create table if not exists public.ro_passagem_notificacoes_lidas (
  notificacao_id uuid not null references public.ro_passagem_notificacoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lida_em timestamptz not null default now(),
  primary key (notificacao_id,user_id)
);
alter table public.ro_passagem_notificacoes_lidas enable row level security;
revoke all on table public.ro_passagem_notificacoes_lidas from anon,authenticated;
revoke all on table public.ro_passagem_notificacoes from public,anon,authenticated;
grant select on table public.ro_passagem_notificacoes to authenticated;

drop policy if exists ro_child_notif_select on public.ro_passagem_notificacoes;
create policy ro_child_notif_select on public.ro_passagem_notificacoes
for select to authenticated using(
  canal='interno' and(
    (destinatario_tipo='solicitante' and destinatario=auth.uid()::text)
    or(
      destinatario_tipo='ro'
      and exists(select 1 from public.ro_responsaveis r where r.user_id=auth.uid() and r.ativo)
    )
  )
);

create or replace function public.ro_listar_minhas_notificacoes()
returns table(id uuid,solicitacao_id uuid,canal text,destinatario_tipo text,destinatario text,mensagem text,status text,created_at timestamptz,lida_em timestamptz)
language sql stable security definer set search_path=''
as $$
  select n.id,n.solicitacao_id,n.canal,n.destinatario_tipo,n.destinatario,n.mensagem,n.status,n.created_at,l.lida_em
  from public.ro_passagem_notificacoes n
  left join public.ro_passagem_notificacoes_lidas l on l.notificacao_id=n.id and l.user_id=auth.uid()
  where auth.uid() is not null and n.canal='interno' and (
    (n.destinatario_tipo='solicitante' and n.destinatario=auth.uid()::text)
    or (n.destinatario_tipo='ro' and n.destinatario is null and exists(select 1 from public.ro_responsaveis r where r.user_id=auth.uid() and r.ativo))
  )
  order by n.created_at desc limit 100;
$$;

create or replace function public.ro_marcar_notificacao_lida(p_notificacao_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not exists(select 1 from public.ro_listar_minhas_notificacoes() n where n.id=p_notificacao_id) then raise exception 'NOTIFICACAO_NAO_DISPONIVEL'; end if;
  insert into public.ro_passagem_notificacoes_lidas(notificacao_id,user_id) values(p_notificacao_id,auth.uid())
  on conflict(notificacao_id,user_id) do update set lida_em=excluded.lida_em;
end $$;

create or replace function public.ro_notificar_mudanca_aprovacao()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.aprovacao_status='aprovada' and old.aprovacao_status is distinct from 'aprovada' then
    insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem) values(new.id,'interno','solicitante',new.solicitante_id::text,'Sua solicitação de passagem foi aprovada.');
  elsif new.aprovacao_status='reprovada' and old.aprovacao_status is distinct from 'reprovada' then
    insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem) values(new.id,'interno','solicitante',new.solicitante_id::text,'Sua solicitação de passagem foi reprovada. Consulte o motivo no Portal.');
  end if;
  return new;
end $$;

drop trigger if exists ro_notificar_mudanca_aprovacao on public.ro_passagem_solicitacoes;
create trigger ro_notificar_mudanca_aprovacao after update of aprovacao_status on public.ro_passagem_solicitacoes for each row execute function public.ro_notificar_mudanca_aprovacao();

create or replace function public.ro_notificar_equipe_nova_solicitacao()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem)
  values(new.id,'interno','ro',null,'Nova solicitação de passagem criada.');
  return new;
end $$;

drop trigger if exists ro_notificar_equipe_nova_solicitacao on public.ro_passagem_solicitacoes;
create trigger ro_notificar_equipe_nova_solicitacao after insert on public.ro_passagem_solicitacoes for each row execute function public.ro_notificar_equipe_nova_solicitacao();
revoke all on function public.ro_listar_minhas_notificacoes(),public.ro_marcar_notificacao_lida(uuid) from public,anon;
grant execute on function public.ro_listar_minhas_notificacoes(),public.ro_marcar_notificacao_lida(uuid) to authenticated;

commit;
