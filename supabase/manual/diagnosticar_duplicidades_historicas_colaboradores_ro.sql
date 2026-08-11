-- SOMENTE SELECT/CTE. Planeja consolidação; não altera referências nem retorna documentos completos.
with base as (
 select e.id,e.nome,e.funcionario_id,e.cpf,public.ro_normalizar_nome_colaborador(e.nome) nome_normalizado,e.criado_em,
  (case when e.funcionario_id is not null then 1 else 0 end+case when e.cpf is not null then 1 else 0 end+case when e.data_nascimento is not null then 1 else 0 end+case when e.telefone is not null then 1 else 0 end+case when e.cidade is not null then 1 else 0 end+case when e.uf is not null then 1 else 0 end) completude,
  (select count(*) from public.ro_passagem_solicitacoes s where s.colaborador_id=e.id) referencias
 from public.ro_funcionarios_enderecos_privados e
), pares as (
 select a.id colaborador_id,a.nome,b.id possivel_duplicado_id,
  case when a.cpf is not null and a.cpf=b.cpf then 'cpf_igual_em_mais_de_um_registro'
       when a.funcionario_id is not null and a.funcionario_id=b.funcionario_id then 'mesmo_funcionario_id'
       when a.nome_normalizado=b.nome_normalizado and a.cpf is not null and b.cpf is not null and a.cpf<>b.cpf then 'conflito_cpf_possivel_homonimo'
       when a.nome_normalizado=b.nome_normalizado then 'nome_exato_duplicado'
       else 'possivel_duplicidade' end classificacao,
  case when row(a.referencias,case when a.funcionario_id is not null then 1 else 0 end,a.completude,-extract(epoch from a.criado_em))>=row(b.referencias,case when b.funcionario_id is not null then 1 else 0 end,b.completude,-extract(epoch from b.criado_em)) then a.id else b.id end registro_principal_sugerido
 from base a join base b on a.id<b.id and (a.nome_normalizado=b.nome_normalizado or (a.cpf is not null and a.cpf=b.cpf) or (a.funcionario_id is not null and a.funcionario_id=b.funcionario_id))
)
select colaborador_id,nome,possivel_duplicado_id,classificacao,registro_principal_sugerido from pares order by classificacao,nome,colaborador_id;
