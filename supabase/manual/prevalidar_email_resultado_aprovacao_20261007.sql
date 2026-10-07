-- READ-ONLY. Execute antes da migration. Não chama a Edge Function.
with funcoes as (
  select
    pg_get_functiondef('public.ro_aprovar_solicitacao(uuid)'::regprocedure) as aprovar,
    pg_get_functiondef('public.ro_reprovar_solicitacao(uuid,text)'::regprocedure) as reprovar
),
outbox_check as (
  select pg_get_constraintdef(c.oid,true) as definicao
  from pg_constraint c
  where c.conrelid='public.ro_email_outbox'::regclass
    and c.conname='ro_email_outbox_tipo_evento_check'
),
deduplicacao as (
  select count(*)::integer as quantidade
  from pg_constraint c
  where c.conrelid='public.ro_email_outbox'::regclass
    and c.contype='u'
    and pg_get_constraintdef(c.oid,true) ilike '%chave_deduplicacao%'
)
select
  to_regprocedure('public.ro_aprovar_solicitacao(uuid)') is not null as rpc_aprovar_presente,
  to_regprocedure('public.ro_reprovar_solicitacao(uuid,text)') is not null as rpc_reprovar_presente,
  position('for update' in lower(f.aprovar)) > 0
    and position(
      'aprovacao_status<>''pendente'''
      in regexp_replace(lower(f.aprovar),'\s+','','g')
    ) > 0
    and position(
      'status<>''solicitada'''
      in regexp_replace(lower(f.aprovar),'\s+','','g')
    ) > 0
    and position('aprovacao_nao_pendente' in lower(f.aprovar)) > 0
    as aprovacao_protegida,
  position('for update' in lower(f.reprovar)) > 0
    and position(
      'aprovacao_status<>''pendente'''
      in regexp_replace(lower(f.reprovar),'\s+','','g')
    ) > 0
    and position(
      'status<>''solicitada'''
      in regexp_replace(lower(f.reprovar),'\s+','','g')
    ) > 0
    and position('aprovacao_nao_pendente' in lower(f.reprovar)) > 0
    as reprovacao_protegida,
  position('ro_passagem_historico' in f.aprovar) > 0 as aprovacao_auditada,
  position('ro_passagem_historico' in f.reprovar) > 0 as reprovacao_auditada,
  to_regprocedure('public.ro_notificar_mudanca_aprovacao()') is not null
    as notificacao_interna_presente,
  to_regclass('public.ro_email_outbox') is not null as outbox_presente,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ro_email_outbox'
      and column_name='destinatario_user_id' and data_type='uuid'
  ) as destinatario_backend_presente,
  d.quantidade = 1 as deduplicacao_unica_presente,
  position('aprovacao_pendente' in o.definicao) > 0 as evento_anterior_presente,
  position('solicitacao_aprovada' in o.definicao) = 0
    and position('solicitacao_reprovada' in o.definicao) = 0
    as eventos_novos_ausentes,
  to_regprocedure('public.ro_enfileirar_resultado_aprovacao()') is null
    and not exists (
      select 1 from pg_trigger
      where tgrelid='public.ro_passagem_solicitacoes'::regclass
        and tgname='ro_enfileirar_resultado_aprovacao'
        and not tgisinternal
    ) as nova_logica_ausente
from funcoes f
cross join outbox_check o
cross join deduplicacao d;
