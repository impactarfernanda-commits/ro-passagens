-- PRÉ-MIGRATION / SOMENTE LEITURA.
-- Autônomo: usa a mesma expressão da migration 202608110002, sem criar ou chamar funções.
-- Não retorna documentos, contatos, endereço ou outros dados pessoais.
with privados as (
  select e.id colaborador_id,e.nome,e.funcionario_id,
    trim(regexp_replace(regexp_replace(lower(translate(e.nome,
      'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn')),
      '[._:/\\-]+',' ','g'),'\s+',' ','g')) nome_normalizado
  from public.ro_funcionarios_enderecos_privados e
), obras as (
  select f.id funcionario_id,
    trim(regexp_replace(regexp_replace(lower(translate(f.nome,
      'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn')),
      '[._:/\\-]+',' ','g'),'\s+',' ','g')) nome_normalizado
  from public.funcionarios f
  where f.ativo and f.deleted_at is null and f.visivel_obras_control
), candidatos as (
  select p.colaborador_id,count(o.funcionario_id) quantidade_candidatos,
    (array_agg(o.funcionario_id order by o.funcionario_id) filter(where o.funcionario_id is not null))[1] funcionario_id_candidato
  from privados p left join obras o using(nome_normalizado) group by p.colaborador_id
), duplicidade_privada as (
  select nome_normalizado,count(*) quantidade from privados group by nome_normalizado having count(*)>1
), vinculos_ocupados as (
  select funcionario_id,(array_agg(colaborador_id order by colaborador_id))[1] colaborador_vinculado_id
  from privados where funcionario_id is not null group by funcionario_id
)
select p.colaborador_id,p.nome,p.funcionario_id,c.funcionario_id_candidato,c.quantidade_candidatos,
 case when d.quantidade>1 then 'duplicidade_privada_real'
      when p.funcionario_id is not null then 'ja_vinculado'
      when c.quantidade_candidatos=0 then 'sem_candidato'
      when c.quantidade_candidatos>1 then 'candidato_ambiguo'
      when v.colaborador_vinculado_id is not null and v.colaborador_vinculado_id<>p.colaborador_id then 'conflito_funcionario_ja_vinculado'
      else 'candidato_unico' end classificacao
from privados p join candidatos c using(colaborador_id)
left join duplicidade_privada d using(nome_normalizado)
left join vinculos_ocupados v on v.funcionario_id=c.funcionario_id_candidato
order by classificacao,p.nome,p.colaborador_id;
