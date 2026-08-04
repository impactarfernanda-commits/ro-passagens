-- SOMENTE LEITURA. Pode ser executado após a aplicação manual das migrations.
-- Não cadastra, altera ou remove dados.

select ano, completo, validado_em, validado_por, observacoes
from public.ro_calendario_anos order by ano;

select extract(year from data)::integer as ano,
       count(*) filter (where ativo) as dias_ativos,
       count(*) filter (where not ativo) as dias_inativos,
       count(*) filter (where tipo='feriado') as feriados,
       count(*) filter (where tipo='ponto_facultativo') as pontos_facultativos
from public.ro_calendario_nao_util group by 1 order by 1;

select data, count(*) as quantidade, array_agg(id order by id) as ids
from public.ro_calendario_nao_util where ativo group by data having count(*)>1 order by data;

select * from public.ro_calendario_nao_util
where not (
  (abrangencia='nacional' and estado is null and municipio is null) or
  (abrangencia='estadual' and estado='SP' and municipio is null) or
  (abrangencia='municipal' and estado='SP' and municipio='Rio Claro')
) order by data;

select id,data,descricao,tipo,abrangencia,estado,municipio
from public.ro_calendario_nao_util where not ativo order by data;

with solicitacoes_abertas as (
  select id,motivo,desligamento_subtipo,
         coalesce(primeiro_embarque_em,data_ida::timestamp at time zone 'America/Sao_Paulo') as embarque
  from public.ro_passagem_solicitacoes
  where status in ('solicitada','em_analise','em_andamento')
    and (motivo='inicio_obra' or (motivo='desligamento' and desligamento_subtipo='ma_conduta'))
), anos_necessarios as (
  select distinct extract(year from d)::integer as ano
  from solicitacoes_abertas s
  cross join lateral generate_series((now() at time zone 'America/Sao_Paulo')::date,(s.embarque at time zone 'America/Sao_Paulo')::date,interval '1 day') d
)
select n.ano,coalesce(a.completo,false) as completo,a.validado_em,
       (select count(*) from public.ro_calendario_nao_util c where extract(year from c.data)=n.ano and c.ativo) as dias_ativos
from anos_necessarios n left join public.ro_calendario_anos a using(ano) order by n.ano;

