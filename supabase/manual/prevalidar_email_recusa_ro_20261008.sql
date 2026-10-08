-- Somente leitura. Execute antes de 202610080001_email_recusa_ro.sql.
with funcoes as (
  select
    pg_get_functiondef('public.ro_recusar_solicitacao(uuid,text)'::regprocedure) recusar,
    pg_get_functiondef('public.ro_reprovar_solicitacao(uuid,text)'::regprocedure) reprovar
), outbox_check as (
  select pg_get_constraintdef(c.oid) definicao
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
  to_regprocedure('public.ro_recusar_solicitacao(uuid,text)') is not null as rpc_canonica_presente,
  position('for update' in lower(f.recusar))>0 as trava_linha,
  position(
    'ifnotpublic.ro_is_operador_ativo(auth.uid())thenraiseexception''nao_pertence_equipe_ro'''
    in lower(regexp_replace(f.recusar,'\s+','','g'))
  )>0
  or position(
    'ifnotro_is_operador_ativo(auth.uid())thenraiseexception''nao_pertence_equipe_ro'''
    in lower(regexp_replace(f.recusar,'\s+','','g'))
  )>0 as exige_operador_ro,
  position('solicitacao_ja_recusada' in lower(f.recusar))>0 as repeticao_bloqueada,
  position('statusnotin(''solicitada'',''em_andamento'')' in lower(regexp_replace(f.recusar,'\s+','','g')))>0 as estados_restritos,
  position('ro_passagem_historico' in f.recusar)>0 as historico_presente,
  position('ro_auditoria_interna' in f.recusar)>0 as auditoria_presente,
  position('ro_passagem_notificacoes' in f.recusar)>0 as notificacao_interna_presente,
  position('recusada_por=auth.uid()' in regexp_replace(f.recusar,'\s+','','g'))>0 as responsavel_ro_registrado,
  position('aprovacao_status' in f.reprovar)>0 and position('motivo_reprovacao_aprovador' in f.reprovar)>0 as reprovacao_aprovador_separada,
  u.presente as deduplicacao_unique_presente,
  position('solicitacao_recusada_ro' in o.definicao)=0
    and position('solicitacao_recusada_ro' in f.recusar)=0 as nova_logica_ausente
from funcoes f cross join outbox_check o cross join unique_key u;

select tipo_evento,status,count(*) quantidade
from public.ro_email_outbox
group by tipo_evento,status
order by tipo_evento,status;
