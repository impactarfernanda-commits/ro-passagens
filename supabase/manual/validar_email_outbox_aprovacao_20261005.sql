-- Somente leitura. Validação estrutural pós-instalação; não consome a fila.
with v as(
  select
    to_regclass('public.ro_email_outbox') is not null as outbox_presente,
    exists(select 1 from pg_indexes where schemaname='public' and indexname='ro_email_outbox_chave_deduplicacao_key') as unique_deduplicacao_presente,
    exists(select 1 from pg_indexes where schemaname='public' and indexname='ro_email_outbox_consumo_idx') as indice_consumo_presente,
    to_regprocedure('public.ro_claim_email_outbox(text,integer,integer)') is not null as claim_presente,
    to_regprocedure('public.ro_finalizar_email_outbox(uuid,text,text,text,text,text,timestamp with time zone)') is not null as finalizacao_presente,
    not has_table_privilege('anon','public.ro_email_outbox','SELECT,INSERT,UPDATE,DELETE') as anon_sem_acesso,
    not has_table_privilege('authenticated','public.ro_email_outbox','SELECT,INSERT,UPDATE,DELETE') as authenticated_sem_acesso,
    position('for update skip locked' in lower(pg_get_functiondef('public.ro_claim_email_outbox(text,integer,integer)'::regprocedure)))>0 as claim_concorrente,
    position('destinatario_tipo=''aprovador''' in pg_get_functiondef('public.ro_listar_minhas_notificacoes()'::regprocedure))>0 as aprovador_na_listagem,
    position('ro.approval_creation' in pg_get_functiondef('public.ro_notificar_equipe_nova_solicitacao()'::regprocedure))>0 as ro_prematuro_bloqueado
)
select v.* from v;
