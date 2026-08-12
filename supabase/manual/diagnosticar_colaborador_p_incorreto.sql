-- Somente leitura. Não retorna CPF, RG, telefone ou endereço.
with referencias_versionadas as (
  select jsonb_agg(jsonb_build_object(
    'tabela', n.nspname || '.' || r.relname,
    'coluna', a.attname,
    'constraint', c.conname
  ) order by n.nspname, r.relname, a.attname) as todas
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  cross join lateral generate_subscripts(c.confkey, 1) pos
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[pos]
  where c.contype = 'f'
    and c.confrelid = 'public.ro_funcionarios_enderecos_privados'::regclass
    and c.confkey[pos] = (
      select attnum from pg_attribute
      where attrelid = 'public.ro_funcionarios_enderecos_privados'::regclass
        and attname = 'id' and not attisdropped
    )
), candidatos as (
  select e.id, e.nome, e.funcionario_id, e.ativo, e.criado_em,
    (select count(*) from public.ro_passagem_solicitacoes s where s.colaborador_id = e.id) as solicitacoes,
    (select count(*) from public.ro_colaboradores_auditoria a where a.colaborador_id = e.id) as auditorias
  from public.ro_funcionarios_enderecos_privados e
  where trim(e.nome) = 'P'
)
select
  c.id,
  c.nome,
  c.funcionario_id,
  c.ativo,
  c.criado_em as created_at,
  c.solicitacoes as quantidade_solicitacoes_associadas,
  jsonb_build_object(
    'possui_referencia_conhecida', c.auditorias > 0,
    'quantidade_auditorias', c.auditorias,
    'fks_atuais_para_o_cadastro', coalesce(r.todas, '[]'::jsonb)
  ) as outras_referencias_conhecidas,
  case
    when (select count(*) from candidatos) <> 1 then 'ABORTAR_AMBIGUIDADE'
    when c.funcionario_id is not null then 'NAO_EXCLUIR_POSSUI_FUNCIONARIO_INATIVAR'
    when c.solicitacoes > 0 or c.auditorias > 0 then 'NAO_EXCLUIR_POSSUI_HISTORICO_INATIVAR'
    else 'VALIDAR_TODAS_AS_FKS_NO_SCRIPT_CONTROLADO'
  end as acao_segura_sugerida
from candidatos c
cross join referencias_versionadas r;
