-- SOMENTE LEITURA. Não instala nem altera objetos.
with objetos(nome,ok) as (
  values
    ('ro_rh_responsaveis',to_regclass('public.ro_rh_responsaveis') is not null),
    ('ro_is_rh_active',to_regprocedure('public.ro_is_rh_active(uuid)') is not null),
    ('ro_can_manage_rh',to_regprocedure('public.ro_can_manage_rh()') is not null),
    ('ro_criar_solicitacao_com_aprovador',to_regprocedure('public.ro_criar_solicitacao_com_aprovador(jsonb,jsonb)') is not null),
    ('ro_criar_solicitacao_colaborador_validada',to_regprocedure('public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb)') is not null),
    ('ro_prazo_regra',to_regprocedure('public.ro_prazo_regra(text,text)') is not null),
    ('ro_catalogo_centros_custo',to_regprocedure('public.ro_catalogo_centros_custo()') is not null),
    ('ro_validar_solicitacao_visibilidade',to_regprocedure('public.ro_validar_solicitacao_visibilidade()') is not null),
    ('ro_nomes_colaboradores_solicitacoes',to_regprocedure('public.ro_nomes_colaboradores_solicitacoes(uuid[])') is not null),
    ('ro_approval_exempt',to_regprocedure('public.ro_approval_exempt(uuid)') is not null)
), estado as (
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='ro_passagem_solicitacoes' and column_name='viajante_nome_informado') coluna_ja_existe,
         exists(select 1 from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_solicitacao_pessoa_ck') constraint_identidade_existe,
         (select count(*) from public.ro_rh_responsaveis where ativo) rh_ativos,
         (select count(*) from public.obras where visivel_passagens and escopo_passagens='comum') cc_comuns,
         (select count(*) from public.obras where visivel_passagens and escopo_passagens='restrito_ro') cc_restritos,
         (select count(*) from public.funcionarios where ativo and deleted_at is null and visivel_passagens) funcionarios_fixture
)
select jsonb_build_object(
  'objetos',jsonb_object_agg(o.nome,o.ok),
  'todos_objetos_presentes',bool_and(o.ok),
  'viajante_nome_informado_ainda_ausente',not e.coluna_ja_existe,
  'constraint_identidade_presente',e.constraint_identidade_existe,
  'rh_ativos',e.rh_ativos,'cc_comuns',e.cc_comuns,'cc_restritos',e.cc_restritos,
  'funcionarios_fixture',e.funcionarios_fixture,
  'fixtures_suficientes',e.rh_ativos>0 and e.cc_comuns>0 and e.cc_restritos>0 and e.funcionarios_fixture>0
) resultado
from objetos o cross join estado e
group by e.coluna_ja_existe,e.constraint_identidade_existe,e.rh_ativos,e.cc_comuns,e.cc_restritos,e.funcionarios_fixture;
