-- Somente leitura. Execute antes da migration e confirme todos os indicadores.
with v as(
  select
    to_regclass('public.ro_passagem_solicitacoes') is not null as solicitacoes_presente,
    to_regclass('public.ro_passagem_notificacoes') is not null as notificacoes_presente,
    to_regclass('public.ro_passagem_notificacoes_lidas') is not null as leituras_presente,
    to_regclass('public.ro_email_logs') is not null as email_logs_presente,
    to_regprocedure('public.ro_criar_solicitacao_com_aprovador(jsonb,jsonb)') is not null as criacao_canonica_presente,
    to_regprocedure('public.ro_notificar_equipe_solicitacao_liberada(uuid)') is not null as liberacao_ro_presente,
    to_regprocedure('public.ro_listar_minhas_notificacoes()') is not null as listagem_presente,
    to_regprocedure('public.ro_marcar_notificacao_lida(uuid)') is not null as marcar_uma_presente,
    to_regprocedure('public.ro_marcar_todas_notificacoes_lidas()') is not null as marcar_todas_presente,
    position('ro.approval_creation' in pg_get_functiondef(to_regprocedure('public.ro_criar_solicitacao_com_aprovador(jsonb,jsonb)'))) > 0 as flag_criacao_confirmada,
    position('ro_notificar_equipe_solicitacao_liberada' in pg_get_functiondef(to_regprocedure('public.ro_aprovar_solicitacao(uuid)'))) > 0 as aprovacao_libera_ro
)
select v.* from v;
