-- SOMENTE LEITURA. Não retorna documentos, telefone ou endereço.
with privados as (
 select public.ro_normalizar_nome_colaborador(e.nome) nome_normalizado,count(*) quantidade_privados
 from public.ro_funcionarios_enderecos_privados e group by 1
), obras as (
 select public.ro_normalizar_nome_colaborador(f.nome) nome_normalizado,count(*) quantidade_obras
 from public.funcionarios f where f.ativo and f.deleted_at is null group by 1
)
select f.id,f.nome,f.ativo,f.deleted_at,f.visivel_obras_control,
 coalesce(p.quantidade_privados,0) quantidade_privados_por_nome,
 coalesce(o.quantidade_obras,0) quantidade_funcionarios_obras_por_nome,
 exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.funcionario_id=f.id) possui_vinculo_privado,
 case when f.ativo and f.deleted_at is null and not f.visivel_obras_control then 'explicada_por_visibilidade_anterior'
      when not f.ativo then 'funcionario_inativo'
      when f.deleted_at is not null then 'funcionario_excluido'
      else 'elegivel_matching' end classificacao
from public.funcionarios f
left join privados p on p.nome_normalizado=public.ro_normalizar_nome_colaborador(f.nome)
left join obras o on o.nome_normalizado=public.ro_normalizar_nome_colaborador(f.nome)
order by classificacao,f.nome,f.id;
