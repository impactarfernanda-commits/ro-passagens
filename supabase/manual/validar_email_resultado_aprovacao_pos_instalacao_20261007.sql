-- READ-ONLY. Execute depois da instalação. Não consome a outbox.
with outbox_check as (
  select pg_get_constraintdef(c.oid,true) as definicao
  from pg_constraint c
  where c.conrelid='public.ro_email_outbox'::regclass
    and c.conname='ro_email_outbox_tipo_evento_check'
),
logs_check as (
  select pg_get_constraintdef(c.oid,true) as definicao
  from pg_constraint c
  where c.conrelid='public.ro_email_logs'::regclass
    and c.conname='ro_email_logs_tipo_evento_check'
),
funcao as (
  select
    pg_get_functiondef(
      'public.ro_enfileirar_resultado_aprovacao()'::regprocedure
    ) as definicao,
    regexp_replace(
      lower(pg_get_functiondef(
        'public.ro_enfileirar_resultado_aprovacao()'::regprocedure
      )),
      '\s+','','g'
    ) as normalizada
),
unicidade_chave as (
  select exists (
    select 1
    from pg_index i
    join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    join pg_attribute a
      on a.attrelid=t.oid
     and a.attname='chave_deduplicacao'
     and not a.attisdropped
    where n.nspname='public'
      and t.relname='ro_email_outbox'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indpred is null
      and i.indexprs is null
      and i.indnkeyatts=1
      and i.indkey[0]=a.attnum
  ) as presente
)
select
  to_regprocedure('public.ro_enfileirar_resultado_aprovacao()') is not null
    as funcao_presente,
  exists (
    select 1 from pg_trigger
    where tgrelid='public.ro_passagem_solicitacoes'::regclass
      and tgname='ro_enfileirar_resultado_aprovacao'
      and not tgisinternal and tgenabled <> 'D'
  ) as trigger_ativo,
  position('solicitacao_aprovada' in o.definicao) > 0
    and position('solicitacao_reprovada' in o.definicao) > 0
    and position('aprovacao_pendente' in o.definicao) > 0
    as tipos_outbox_corretos,
  position('solicitacao_aprovada' in l.definicao) > 0
    and position('solicitacao_reprovada' in l.definicao) > 0
    and position('aprovacao_pendente' in l.definicao) > 0
    as tipos_logs_corretos,
  position('old.aprovacao_status is distinct from ''pendente''' in f.definicao) > 0
    as somente_transicao_pendente,
  position('new.solicitante_id' in f.definicao) > 0 as destinatario_solicitante,
  u.presente
    and position('onconflict(chave_deduplicacao)donothing' in f.normalizada) > 0
    as deduplicacao_presente,
  position('solicitacao_aprovada:' in f.normalizada) = 0
    and position(
      'v_evento||'':''||new.id::text||'':''||new.solicitante_id::text'
      in f.normalizada
    ) > 0
    as chave_deduplicacao_dinamica,
  not has_table_privilege('authenticated','public.ro_email_outbox','INSERT')
    and not has_table_privilege('authenticated','public.ro_email_outbox','UPDATE')
    as frontend_sem_escrita_outbox
from outbox_check o
cross join logs_check l
cross join funcao f
cross join unicidade_chave u;
