
-- Executar manualmente no Supabase SQL Editor.
-- Mantem a notificacao mais antiga e remove apenas repeticoes no mesmo segundo.
begin;

with classificadas as (
  select
    id,
    row_number() over (
      partition by
        solicitacao_id,
        canal,
        destinatario_tipo,
        case
          when canal = 'interno' and destinatario_tipo = 'ro' then ''
          else coalesce(destinatario, '')
        end,
        mensagem,
        status,
        date_trunc('second', created_at)
      order by created_at asc, id asc
    ) as ordem
  from public.ro_passagem_notificacoes
),
removidas as (
  delete from public.ro_passagem_notificacoes
  where id in (
    select id
    from classificadas
    where ordem > 1
  )
  returning *
)
select *
from removidas
order by created_at, id;

commit;
