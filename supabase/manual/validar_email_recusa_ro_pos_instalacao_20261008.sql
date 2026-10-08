-- Somente leitura. Não chama worker nem envia e-mail.
with defs as (
  select
    pg_get_functiondef('public.ro_recusar_solicitacao(uuid,text)'::regprocedure) recusar,
    pg_get_constraintdef(c.oid) eventos
  from pg_constraint c
  where c.conrelid='public.ro_email_outbox'::regclass
    and c.conname='ro_email_outbox_tipo_evento_check'
), unique_key as (
  select exists(
    select 1 from pg_index i
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
    where i.indrelid='public.ro_email_outbox'::regclass
      and i.indisunique and i.indnkeyatts=1 and a.attname='chave_deduplicacao'
  ) presente
)
select
  position('solicitacao_recusada_ro' in d.eventos)>0 as evento_permitido,
  position('solicitacao_recusada_ro' in d.recusar)>0 as rpc_enfileira_evento,
  position('onconflict(chave_deduplicacao)donothing' in regexp_replace(lower(d.recusar),'\s+','','g'))>0 as conflito_ignorado,
  position('v_sol.solicitante_id' in d.recusar)>0 as destinatario_solicitante,
  position('solicitacao_recusada_ro:''||p_solicitacao_id::text||'':''||v_sol.solicitante_id::text' in regexp_replace(lower(d.recusar),'\s+','','g'))>0 as chave_canonica,
  position('for update' in lower(d.recusar))>0 as trava_preservada,
  u.presente as unique_deduplicacao_presente,
  not has_table_privilege('authenticated','public.ro_email_outbox','INSERT')
    and not has_table_privilege('authenticated','public.ro_email_outbox','UPDATE') as frontend_sem_dml
from defs d cross join unique_key u;

select tipo_evento,status,count(*) quantidade
from public.ro_email_outbox
where tipo_evento='solicitacao_recusada_ro'
group by tipo_evento,status;
