-- Somente leitura: definição efetiva da função central de prazo.
select
  p.oid::regprocedure as funcao,
  pg_get_functiondef(p.oid) as definicao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'ro_prazo_regra';

-- Regra alterada e regras vizinhas que precisam permanecer inalteradas.
select * from public.ro_prazo_regra('desligamento','programado_outros');
select * from public.ro_prazo_regra('desligamento','justa_causa');
select * from public.ro_prazo_regra('desligamento','pedido_demissao');
select * from public.ro_prazo_regra('desligamento','ma_conduta');
select * from public.ro_prazo_regra('recesso',null);
select * from public.ro_prazo_regra('admissao',null);
select * from public.ro_prazo_regra('folga_campo',null);
select * from public.ro_prazo_regra('transferencia_obra',null);
select * from public.ro_prazo_regra('retorno_obra',null);
select * from public.ro_prazo_regra('inicio_obra',null);

-- Snapshots históricos permanecem como foram gravados; nenhuma escrita é feita.
select
  prazo_tipo,
  prazo_quantidade,
  count(*) as solicitacoes
from public.ro_passagem_solicitacoes
where motivo = 'desligamento'
  and desligamento_subtipo = 'programado_outros'
group by prazo_tipo,prazo_quantidade
order by prazo_tipo,prazo_quantidade;
