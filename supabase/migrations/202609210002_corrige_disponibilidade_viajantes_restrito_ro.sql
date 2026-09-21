begin;

-- escopo_passagens separa a visibilidade entre sistemas; no RO Passagens,
-- comum e restrito_ro são igualmente elegíveis como viajantes.
-- A assinatura é preservada porque catálogo e trigger já dependem dela.
create or replace function public.ro_funcionario_disponivel_para_usuario(
  p_user_id uuid,
  p_funcionario_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_funcionario_id is not null
    and exists(
      select 1
      from public.funcionarios f
      where f.id=p_funcionario_id
        and f.ativo
        and f.deleted_at is null
        and f.visivel_passagens
        and f.escopo_passagens in ('comum','restrito_ro')
    );
$$;

revoke all on function public.ro_funcionario_disponivel_para_usuario(uuid,uuid)
from public,anon,authenticated;
grant execute on function public.ro_funcionario_disponivel_para_usuario(uuid,uuid)
to service_role;

commit;
