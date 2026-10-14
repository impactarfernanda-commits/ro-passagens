-- SOMENTE LEITURA. Não instala nem altera objetos.
with defs as (
  select
    to_regprocedure('public.ro_funcionario_disponivel_para_usuario(uuid,uuid)') helper_oid,
    to_regprocedure('public.ro_validar_solicitacao_visibilidade()') validacao_oid,
    to_regprocedure('public.ro_catalogo_colaboradores_viagem()') catalogo_oid
), fontes as (
  select
    case when helper_oid is null then '' else pg_get_functiondef(helper_oid) end helper_def,
    case when validacao_oid is null then '' else pg_get_functiondef(validacao_oid) end validacao_def,
    case when catalogo_oid is null then '' else pg_get_functiondef(catalogo_oid) end catalogo_def
  from defs
), checks as (
  select
    helper_def<>'' helper_presente,
    helper_def ~* 'escopo_passagens\s+in\s*\(''comum''\s*,\s*''restrito_ro''\)' helper_aceita_restrito_ro,
    exists(
      select 1 from pg_trigger t
      where t.tgrelid='public.ro_passagem_solicitacoes'::regclass
        and t.tgname='ro_validar_solicitacao_visibilidade'
        and not t.tgisinternal and t.tgenabled<>'D'
    ) trigger_presente,
    validacao_def ~* 'v_restrito[\s\S]*f\.escopo_passagens\s*=\s*''comum''[\s\S]*v_restrito[\s\S]*f\.escopo_passagens\s*=\s*''restrito_ro''' regressao_presente,
    catalogo_def ~* 'ro_funcionario_disponivel_para_usuario\s*\(\s*auth\.uid\(\)\s*,\s*f\.id\s*\)' catalogo_canonico,
    validacao_def !~* 'ro_funcionario_disponivel_para_usuario\s*\(\s*auth\.uid\(\)\s*,\s*new\.funcionario_id\s*\)' nova_correcao_ausente
  from fontes
)
select
  helper_presente,
  helper_aceita_restrito_ro,
  trigger_presente,
  regressao_presente,
  catalogo_canonico,
  nova_correcao_ausente,
  helper_presente and helper_aceita_restrito_ro and trigger_presente
    and regressao_presente and catalogo_canonico and nova_correcao_ausente
    as pronto_para_dry_run
from checks;
