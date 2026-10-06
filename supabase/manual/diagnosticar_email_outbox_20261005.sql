-- Diagnóstico estritamente somente leitura da outbox de e-mails.
-- Não resolve e-mails, não reivindica itens e não altera qualquer status.

-- A_RESUMO: distribuição por status/tipo e totais globais da fila.
with base as (
  select status,tipo_evento
  from public.ro_email_outbox
), por_status_evento as (
  select status,tipo_evento,count(*)::bigint as quantidade
  from base
  group by status,tipo_evento
), totais as (
  select
    count(*)::bigint as total_linhas,
    count(*) filter(where status='pendente')::bigint as pendentes,
    count(*) filter(where status='processando')::bigint as processando,
    count(*) filter(where status='erro_retry')::bigint as erro_retry,
    count(*) filter(where status='enviado')::bigint as enviados,
    count(*) filter(where status='falha_permanente')::bigint as falha_permanente,
    count(*) filter(where status='cancelado')::bigint as cancelados
  from base
)
select
  'A_RESUMO'::text as resultado,
  p.status,
  p.tipo_evento,
  p.quantidade,
  t.total_linhas,
  t.pendentes,
  t.processando,
  t.erro_retry,
  t.enviados,
  t.falha_permanente,
  t.cancelados
from totais t
left join por_status_evento p on true
order by p.status nulls first,p.tipo_evento nulls first;

-- B_PENDENTES: itens potencialmente enviáveis e validade semântica atual.
with pendentes as (
  select
    o.id,
    o.solicitacao_id,
    o.tipo_evento,
    o.destinatario_user_id,
    o.status,
    o.tentativas,
    o.criado_em,
    o.proxima_tentativa_em,
    o.locked_at,
    o.enviado_em,
    o.chave_deduplicacao,
    s.id as solicitacao_encontrada,
    s.aprovacao_status,
    s.aprovador_id,
    s.excluida_em,
    s.status as solicitacao_status
  from public.ro_email_outbox o
  left join public.ro_passagem_solicitacoes s on s.id=o.solicitacao_id
  where o.status in('pendente','erro_retry','processando')
), avaliados as (
  select
    p.*,
    coalesce(p.solicitacao_encontrada is not null
      and p.excluida_em is null
      and p.aprovacao_status='pendente'
      and p.aprovador_id=p.destinatario_user_id,false)
      as evento_ainda_valido
  from pendentes p
)
select
  'B_PENDENTES'::text as resultado,
  id,
  solicitacao_id,
  tipo_evento,
  destinatario_user_id,
  status,
  tentativas,
  criado_em,
  round(extract(epoch from (now()-criado_em))/60.0,1) as idade_minutos,
  round(extract(epoch from (now()-criado_em))/3600.0,2) as idade_horas,
  proxima_tentativa_em,
  locked_at,
  enviado_em,
  chave_deduplicacao,
  aprovacao_status,
  aprovador_id is not distinct from destinatario_user_id as aprovador_ainda_corresponde,
  excluida_em is not null as solicitacao_excluida,
  solicitacao_status,
  evento_ainda_valido
from avaliados
order by evento_ainda_valido desc,criado_em,id;

-- C_DUPLICIDADES: deve retornar zero em quantidade_chaves_duplicadas.
with duplicadas as (
  select chave_deduplicacao,count(*)::bigint as quantidade
  from public.ro_email_outbox
  group by chave_deduplicacao
  having count(*)>1
)
select
  'C_DUPLICIDADES'::text as resultado,
  count(*)::bigint as quantidade_chaves_duplicadas,
  coalesce(sum(quantidade),0)::bigint as quantidade_linhas_em_duplicidade,
  count(*)=0 as sem_duplicidades
from duplicadas;

-- D_POR_DESTINATARIO: visão agregada sem e-mail ou outros dados pessoais.
with eventos as (
  select
    o.destinatario_user_id,
    coalesce(s.id is not null
      and s.excluida_em is null
      and s.aprovacao_status='pendente'
      and s.aprovador_id=o.destinatario_user_id,false)
      as evento_ainda_valido
  from public.ro_email_outbox o
  left join public.ro_passagem_solicitacoes s on s.id=o.solicitacao_id
  where o.tipo_evento='aprovacao_pendente'
    and o.status in('pendente','erro_retry','processando')
)
select
  'D_POR_DESTINATARIO'::text as resultado,
  destinatario_user_id,
  count(*) filter(where evento_ainda_valido)::bigint as quantidade_pendente_valida,
  count(*) filter(where not evento_ainda_valido)::bigint as quantidade_pendente_obsoleta
from eventos
group by destinatario_user_id
order by destinatario_user_id;
