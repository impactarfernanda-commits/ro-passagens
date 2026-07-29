-- Torna notificacoes internas para RO coletivas e idempotentes.
-- A trava transacional impede duplicidade mesmo em insercoes concorrentes.
create or replace function public.ro_prevenir_notificacao_duplicada()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event_key text;
begin
  if new.canal = 'interno' and new.destinatario_tipo = 'ro' then
    new.destinatario := null;
  end if;

  v_event_key := concat_ws(
    '|',
    new.solicitacao_id::text,
    new.canal,
    new.destinatario_tipo,
    coalesce(new.destinatario, ''),
    new.mensagem
  );

  perform pg_advisory_xact_lock(hashtextextended(v_event_key, 0));

  if exists (
    select 1
    from public.ro_passagem_notificacoes existente
    where existente.solicitacao_id = new.solicitacao_id
      and existente.canal = new.canal
      and existente.destinatario_tipo = new.destinatario_tipo
      and coalesce(existente.destinatario, '') = coalesce(new.destinatario, '')
      and existente.mensagem = new.mensagem
      and abs(
        extract(
          epoch from existente.created_at - coalesce(new.created_at, now())
        )
      ) <= 60
  ) then
    return null;
  end if;

  return new;
end
$$;

drop trigger if exists ro_prevenir_notificacao_duplicada
on public.ro_passagem_notificacoes;

create trigger ro_prevenir_notificacao_duplicada
before insert on public.ro_passagem_notificacoes
for each row
execute function public.ro_prevenir_notificacao_duplicada();
