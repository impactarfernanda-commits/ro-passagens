begin;

create or replace function public.ro_prazo_regra(p_motivo text,p_subtipo text)
returns table(regra_codigo text,prazo_tipo text,prazo_quantidade integer,categoria_documento text)
language sql immutable set search_path=public,pg_temp as $$
 select case when p_motivo='desligamento' then 'desligamento_'||coalesce(p_subtipo,'invalido') else coalesce(p_motivo,'administrativo') end,
 case when p_motivo='desligamento' and p_subtipo in ('justa_causa','pedido_demissao') then 'sem_prazo_minimo'
      when p_motivo='desligamento' and p_subtipo='ma_conduta' or p_motivo='inicio_obra' then 'dias_uteis' else 'dias_corridos' end,
 case when p_motivo='desligamento' and p_subtipo in ('justa_causa','pedido_demissao') then 0
      when p_motivo='desligamento' and p_subtipo='ma_conduta' or p_motivo='inicio_obra' then 5
      when p_motivo='ferias' then 25 when p_motivo in ('folga_campo','transferencia_obra','admissao','retorno_obra') then 15
      when p_motivo='recesso' then 30
      when p_motivo='desligamento' and p_subtipo='programado_outros' then 15
      when p_motivo='desligamento' then 25 else 0 end,
 case when p_subtipo='justa_causa' then 'termo_justa_causa' when p_subtipo='pedido_demissao' then 'carta_pedido_demissao' end;
$$;

rollback;
