-- SOMENTE SELECT/CTE. Não retorna CPF ou outros documentos completos.
with privados as (
 select e.id colaborador_id,e.nome,e.cpf is not null possui_cpf,e.funcionario_id,public.ro_normalizar_nome_colaborador(e.nome) nome_normalizado
 from public.ro_funcionarios_enderecos_privados e
), contagens_privadas as (
 select nome_normalizado,count(*) candidatos_privados from privados group by nome_normalizado
), contagens_obras as (
 select public.ro_normalizar_nome_colaborador(f.nome) nome_normalizado,count(*) candidatos_obras
 from public.funcionarios f where f.ativo and f.deleted_at is null and f.visivel_obras_control group by 1
)
select p.colaborador_id,p.nome,p.possui_cpf,p.funcionario_id,cp.candidatos_privados,coalesce(co.candidatos_obras,0) candidatos_obras,
 case when cp.candidatos_privados>1 then 'nome_privado_ambiguo'
      when p.funcionario_id is not null then 'cadastro_antigo_vinculado'
      when not p.possui_cpf then 'cadastro_antigo_apto_enriquecimento'
      else 'cadastro_privado_existente' end classificacao
from privados p join contagens_privadas cp using(nome_normalizado) left join contagens_obras co using(nome_normalizado)
order by classificacao,p.nome,p.colaborador_id;
