-- Verificação somente leitura do calendário corporativo de 2026.
select
  count(*) as total_2026,
  count(*) filter (where ativo) as ativos,
  count(*) filter (where not ativo) as inativos
from public.ro_calendario_nao_util
where data between date '2026-01-01' and date '2026-12-31';

select tipo,count(*) as total
from public.ro_calendario_nao_util
where data between date '2026-01-01' and date '2026-12-31'
group by tipo order by tipo;

select abrangencia,count(*) as total
from public.ro_calendario_nao_util
where data between date '2026-01-01' and date '2026-12-31'
group by abrangencia order by abrangencia;

select data,descricao,tipo,abrangencia,estado,municipio,ativo
from public.ro_calendario_nao_util
where data between date '2026-01-01' and date '2026-12-31'
order by data,tipo,abrangencia;

select ano,completo,validado_em,validado_por,observacoes
from public.ro_calendario_anos where ano=2026;

select data,tipo,abrangencia,estado,municipio,count(*) as quantidade
from public.ro_calendario_nao_util
where data between date '2026-01-01' and date '2026-12-31'
group by data,tipo,abrangencia,estado,municipio
having count(*)>1 order by data;

select
  count(*) as recessos_esperados,
  count(*) filter (where not ativo) as recessos_inativos,
  count(*) filter (where ativo) as recessos_indevidamente_ativos
from public.ro_calendario_nao_util
where tipo='recesso' and abrangencia='empresa'
  and data in (date '2026-12-21',date '2026-12-22',date '2026-12-23',date '2026-12-28',date '2026-12-29',date '2026-12-30');
