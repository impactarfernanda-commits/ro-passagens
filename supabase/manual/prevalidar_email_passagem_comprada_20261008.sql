-- Somente leitura. Execute antes de 202610080002_email_passagem_comprada.sql.
with funcoes as (
  select
    pg_get_functiondef('public.ro_registrar_compra_v2(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time,jsonb,boolean,text)'::regprocedure) compra_v2,
    pg_get_functiondef('public.ro_registrar_compra_pre_operacional(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb)'::regprocedure) compra_base,
    pg_get_functiondef('public.ro_registrar_documentos_pos_compra(uuid,uuid,jsonb,jsonb)'::regprocedure) pos_compra,
    pg_get_functiondef('public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb)'::regprocedure) complementar
), eventos as (
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
  position('ro_registrar_compra_pre_operacional' in f.compra_v2)>0 as v2_chama_compra_canonica,
  position('status = ''passagem_comprada''' in f.compra_base)>0
    or position('status=''passagem_comprada''' in regexp_replace(f.compra_base,'\s+','','g'))>0 as base_confirma_status,
  position('comprado_em' in f.compra_base)>0 and position('comprado_por' in f.compra_base)>0 as carimbos_compra_presentes,
  position('ro_passagem_custos' in f.compra_base)>0 as custos_atomicos,
  position('ro_passagem_historico' in f.compra_base)>0 as historico_presente,
  position('ro_passagem_notificacoes' in f.compra_base)>0 as notificacao_interna_presente,
  position('status not in(''passagem_comprada'',''finalizada'')' in lower(f.pos_compra))>0 as pos_compra_exige_compra_anterior,
  position('status not in(''passagem_comprada'',''finalizada'')' in lower(f.complementar))>0 as complementar_exige_compra_anterior,
  u.presente as deduplicacao_unique_presente,
  position('passagem_comprada' in e.definicao)=0
    and to_regprocedure('public.ro_enfileirar_passagem_comprada()') is null as nova_logica_ausente
from funcoes f cross join eventos e cross join unique_key u;

select tipo_evento,status,count(*) quantidade
from public.ro_email_outbox
group by tipo_evento,status
order by tipo_evento,status;
