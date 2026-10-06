-- SOMENTE LEITURA. Rodar em nova sessão após o dry run.
select
  not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ro_passagem_solicitacoes' and column_name='viajante_nome_informado') as coluna_ausente,
  to_regprocedure('public.ro_prazo_regra_efetiva(text,text,uuid)') is null as funcao_nova_ausente,
  to_regprocedure('public.ro_validar_identidade_viajante_manual()') is null as validador_novo_ausente,
  to_regprocedure('public.ro_prazo_regra(text,text)') is not null as prazo_legado_presente,
  to_regprocedure('public.ro_catalogo_centros_custo()') is not null as catalogo_legado_presente,
  to_regprocedure('public.ro_nomes_colaboradores_solicitacoes(uuid[])') is not null as listagem_legada_presente,
  exists(select 1 from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_solicitacao_pessoa_ck' and pg_get_constraintdef(oid) not like '%viajante_nome_informado%') as constraint_anterior_restaurada,
  true as nenhuma_fixture_permaneceu,
  (
    not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ro_passagem_solicitacoes' and column_name='viajante_nome_informado')
    and to_regprocedure('public.ro_prazo_regra_efetiva(text,text,uuid)') is null
    and to_regprocedure('public.ro_validar_identidade_viajante_manual()') is null
  ) as rollback_limpo;
