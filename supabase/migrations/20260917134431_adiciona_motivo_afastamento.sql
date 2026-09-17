-- Registra a alteração de Afastamento já aplicada manualmente em produção.
begin;

alter table public.ro_passagem_solicitacoes drop constraint if exists ro_motivo_valido;
alter table public.ro_passagem_solicitacoes add constraint ro_motivo_valido
  check (motivo is null or motivo in (
    'ferias','folga_campo','desligamento','transferencia_obra','viagem_diretoria',
    'admissao','inicio_obra','retorno_obra','recesso','viagem_administrativa','afastamento'
  ));

alter table public.ro_passagem_solicitacoes add constraint ro_afastamento_justificativa_obrigatoria
  check (motivo is distinct from 'afastamento' or nullif(btrim(observacoes_solicitante), '') is not null);

create or replace function public.ro_prazo_regra(p_motivo text,p_subtipo text)
returns table(regra_codigo text,prazo_tipo text,prazo_quantidade integer,categoria_documento text)
language sql immutable set search_path=public,pg_temp as $$
 select case when p_motivo='desligamento' then 'desligamento_'||coalesce(p_subtipo,'invalido') else coalesce(p_motivo,'administrativo') end,
 case when p_motivo in ('viagem_administrativa','afastamento') then 'sem_prazo_minimo'
      when p_motivo='desligamento' and p_subtipo in ('justa_causa','pedido_demissao') then 'sem_prazo_minimo'
      when p_motivo='desligamento' and p_subtipo='ma_conduta' or p_motivo='inicio_obra' then 'dias_uteis' else 'dias_corridos' end,
 case when p_motivo in ('viagem_administrativa','afastamento') then 0
      when p_motivo='desligamento' and p_subtipo in ('justa_causa','pedido_demissao') then 0
      when p_motivo='desligamento' and p_subtipo='ma_conduta' or p_motivo='inicio_obra' then 5
      when p_motivo='ferias' then 25 when p_motivo in ('folga_campo','transferencia_obra','admissao','retorno_obra') then 15
      when p_motivo='recesso' then 30
      when p_motivo='desligamento' and p_subtipo='programado_outros' then 15
      when p_motivo='desligamento' then 25 else 0 end,
 case when p_subtipo='justa_causa' then 'termo_justa_causa' when p_subtipo='pedido_demissao' then 'carta_pedido_demissao' end;
$$;

commit;
