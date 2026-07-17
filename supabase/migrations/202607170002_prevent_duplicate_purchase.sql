-- Impede uma segunda compra antes que custos ou notificacoes sejam alterados.
-- A protecao vale para chamadas RPC e para updates diretos permitidos por RLS.
create or replace function public.ro_impedir_compra_duplicada()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('passagem_comprada', 'finalizada', 'cancelada')
     and new.status = 'passagem_comprada' then
    raise exception 'Esta solicitação já foi comprada, finalizada ou cancelada.';
  end if;

  return new;
end
$$;

drop trigger if exists ro_impedir_compra_duplicada
on public.ro_passagem_solicitacoes;

create trigger ro_impedir_compra_duplicada
before update on public.ro_passagem_solicitacoes
for each row
execute function public.ro_impedir_compra_duplicada();
