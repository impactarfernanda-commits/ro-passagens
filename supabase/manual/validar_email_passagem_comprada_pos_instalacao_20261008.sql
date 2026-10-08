-- Somente leitura. Não chama worker nem envia e-mail.
with defs as (
  select
    pg_get_functiondef('public.ro_enfileirar_passagem_comprada()'::regprocedure) enfileirar,
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
  position('passagem_comprada' in d.eventos)>0 as evento_permitido,
  position('old.status is not distinct from ''passagem_comprada''' in lower(d.enfileirar))>0 as somente_transicao_inicial,
  position('new.comprado_em is null' in lower(d.enfileirar))>0
    and position('new.comprado_por is null' in lower(d.enfileirar))>0 as exige_compra_concluida,
  position('new.excluida_em is not null' in lower(d.enfileirar))>0 as excluida_bloqueada,
  position('new.solicitante_id' in d.enfileirar)>0 as destinatario_solicitante,
  position('passagem_comprada:''||new.id::text||'':''||new.solicitante_id::text' in regexp_replace(lower(d.enfileirar),'\s+','','g'))>0 as chave_canonica,
  position('onconflict(chave_deduplicacao)donothing' in regexp_replace(lower(d.enfileirar),'\s+','','g'))>0 as conflito_ignorado,
  u.presente as unique_deduplicacao_presente,
  not has_table_privilege('authenticated','public.ro_email_outbox','INSERT')
    and not has_table_privilege('authenticated','public.ro_email_outbox','UPDATE') as frontend_sem_dml
from defs d cross join unique_key u;

select tipo_evento,status,count(*) quantidade
from public.ro_email_outbox
where tipo_evento='passagem_comprada'
group by tipo_evento,status;
