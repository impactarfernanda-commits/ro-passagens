-- Somente leitura, para uso depois de um rollback controlado da Fase 1.
with v as(
  select
    to_regclass('public.ro_email_outbox') is null as outbox_ausente,
    to_regprocedure('public.ro_claim_email_outbox(text,integer,integer)') is null as claim_ausente,
    to_regprocedure('public.ro_finalizar_email_outbox(uuid,text,text,text,text,text,timestamp with time zone)') is null as finalizacao_ausente,
    to_regprocedure('public.ro_listar_minhas_notificacoes()') is not null as listagem_legada_presente,
    to_regprocedure('public.ro_marcar_notificacao_lida(uuid)') is not null as marcar_uma_presente,
    to_regprocedure('public.ro_marcar_todas_notificacoes_lidas()') is not null as marcar_todas_presente
)
select v.*,outbox_ausente and claim_ausente and finalizacao_ausente and listagem_legada_presente and marcar_uma_presente and marcar_todas_presente as rollback_limpo from v;
