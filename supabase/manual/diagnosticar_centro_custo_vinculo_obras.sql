-- Somente leitura. Não retorna salário, custo, endereço ou outros dados pessoais.
select
  e.id as colaborador_id,
  e.nome as colaborador_nome,
  e.funcionario_id,
  f.visivel_obras_control,
  f.ativo as funcionario_ativo,
  f.deleted_at is null as funcionario_nao_excluido,
  f.escopo_passagens,
  case when e.funcionario_id is null then null else atual.obra_id end as obra_atual_id,
  case when e.funcionario_id is null then null else o.nome end as obra_atual_nome,
  case
    when e.funcionario_id is null then 'SEM_VINCULO_EXPLICITO_SEM_PREFILL'
    when f.id is null or not f.ativo or f.deleted_at is not null then 'VINCULO_INVALIDO_SEM_PREFILL'
    when not f.visivel_obras_control then 'NAO_PERTENCE_AO_OBRAS_SEM_PREFILL'
    when atual.obra_id is null then 'OBRAS_SEM_ALOCACAO_SEM_PREFILL'
    else 'VINCULO_OBRAS_VALIDO_COM_PREFILL'
  end as resultado_esperado
from public.ro_funcionarios_enderecos_privados e
left join public.funcionarios f on f.id=e.funcionario_id
left join lateral(
  select a.obra_id from public.alocacoes a
  where a.funcionario_id=f.id and f.ativo and f.deleted_at is null and f.visivel_obras_control
  order by a.data desc limit 1
) atual on true
left join public.obras o on o.id=atual.obra_id
where e.ativo
order by e.nome;
