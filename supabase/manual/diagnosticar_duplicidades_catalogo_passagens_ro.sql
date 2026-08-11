-- Pré-migration, autônomo e somente leitura: legado restrito_ro x cadastro privado.
with privados as (
 select e.id,e.nome,
  regexp_replace(trim(regexp_replace(' '||trim(regexp_replace(public.ro_normalizar_nome_colaborador(e.nome),'[^a-z0-9]+',' ','g'))||' ',' (de|da|do|das|dos|e) ',' ','g')),' +',' ','g') significativo
 from public.ro_funcionarios_enderecos_privados e where e.ativo
),legados as (
 select f.id,f.nome,
  regexp_replace(trim(regexp_replace(' '||trim(regexp_replace(public.ro_normalizar_nome_colaborador(f.nome),'[^a-z0-9]+',' ','g'))||' ',' (de|da|do|das|dos|e) ',' ','g')),' +',' ','g') significativo
 from public.funcionarios f
 where f.ativo and f.deleted_at is null and f.visivel_passagens and f.escopo_passagens='restrito_ro' and not f.visivel_obras_control
),pares as (
 select l.id funcionario_legado_id,l.nome nome_legado,p.id colaborador_privado_id,p.nome nome_privado,
  public.ro_normalizar_nome_colaborador(l.nome) normalizado_legado,public.ro_normalizar_nome_colaborador(p.nome) normalizado_privado,
  l.significativo significativo_legado,p.significativo significativo_privado,
  string_to_array(l.significativo,' ') tokens_legado,string_to_array(p.significativo,' ') tokens_privado
 from legados l join privados p on split_part(l.significativo,' ',1)=split_part(p.significativo,' ',1)
),classificados as (
 select x.*,
 case
  when normalizado_legado=normalizado_privado then 'DUPLICIDADE_EXATA'
  when significativo_legado=significativo_privado then 'PARTICULA_DIVERGENTE'
  when cardinality(tokens_legado)=cardinality(tokens_privado) and cardinality(tokens_legado)>1
   and tokens_legado[1:cardinality(tokens_legado)-1]=tokens_privado[1:cardinality(tokens_privado)-1]
   and least(length(tokens_legado[cardinality(tokens_legado)]),length(tokens_privado[cardinality(tokens_privado)]))>=5
   and (tokens_legado[cardinality(tokens_legado)] like tokens_privado[cardinality(tokens_privado)]||'%' or tokens_privado[cardinality(tokens_privado)] like tokens_legado[cardinality(tokens_legado)]||'%')
   then 'SOBRENOME_TRUNCADO'
  when cardinality(tokens_legado)<cardinality(tokens_privado)
   and tokens_legado[1]=tokens_privado[1] and tokens_legado[cardinality(tokens_legado)]=tokens_privado[cardinality(tokens_privado)]
   and significativo_privado ~ ('^'||array_to_string(tokens_legado,' .+ ')||'$')
   then 'NOME_INTERMEDIARIO_AUSENTE'
  when cardinality(tokens_privado)<cardinality(tokens_legado)
   and tokens_privado[1]=tokens_legado[1] and tokens_privado[cardinality(tokens_privado)]=tokens_legado[cardinality(tokens_legado)]
   and significativo_legado ~ ('^'||array_to_string(tokens_privado,' .+ ')||'$')
   then 'NOME_INTERMEDIARIO_AUSENTE'
 end tipo_base
 from pares x
),candidatos as (
 select * from classificados where tipo_base is not null
),contados as (
 select c.*,count(*) over(partition by funcionario_legado_id)::int quantidade_candidatos_privados from candidatos c
)
select funcionario_legado_id,nome_legado,colaborador_privado_id,nome_privado,
 case when quantidade_candidatos_privados>1 then 'AMBIGUO' else tipo_base end tipo_correspondencia,
 'ALTA'::text confianca,quantidade_candidatos_privados,
 case when quantidade_candidatos_privados=1 then 'SUPRIMIR_LEGADO_DO_CATALOGO' else 'MANTER_AMBOS_PARA_REVISAO' end acao_proposta
from contados order by nome_legado,nome_privado;

