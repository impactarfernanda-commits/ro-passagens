-- Relatório seguro de solicitações e custos por centro de custo.
-- Não altera tabelas, dados ou políticas existentes.

create or replace function public.ro_relatorio_centros_custo(
  p_inicio date default null,
  p_fim date default null,
  p_centro_custo_id uuid default null,
  p_sem_centro boolean default false,
  p_status text default null,
  p_motivo text default null,
  p_responsavel_ro_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_resultado jsonb;
begin
  if not public.ro_can_view_all() then
    raise exception 'Acesso restrito a diretores, gerentes e equipe RO ativa';
  end if;
  if p_inicio is not null and p_fim is not null and p_inicio > p_fim then
    raise exception 'Período inicial não pode ser posterior ao período final';
  end if;

  with base as (
    select s.*
      from public.ro_passagem_solicitacoes s
     where (p_inicio is null or s.created_at >= p_inicio::timestamptz)
       and (p_fim is null or s.created_at < (p_fim + 1)::timestamptz)
       and (p_status is null or s.status = p_status)
       and (p_motivo is null or s.motivo = p_motivo)
       and (p_responsavel_ro_id is null or s.responsavel_ro_id = p_responsavel_ro_id)
       and (
         (p_centro_custo_id is null and not p_sem_centro)
         or (not p_sem_centro and (
           s.obra_id = p_centro_custo_id
           or exists (
             select 1 from public.ro_passagem_custos cf
              where cf.solicitacao_id = s.id
                and coalesce(cf.centro_custo_id, s.obra_id) = p_centro_custo_id
           )
         ))
         or (p_sem_centro and (
           s.obra_id is null
           or exists (
             select 1 from public.ro_passagem_custos cf
              where cf.solicitacao_id = s.id
                and coalesce(cf.centro_custo_id, s.obra_id) is null
           )
         ))
       )
  ),
  operacional as (
    select s.obra_id as centro_custo_id,
           count(*)::integer as solicitacoes,
           count(*) filter (where s.comprado_em is not null)::integer as compradas,
           count(*) filter (where s.status not in ('passagem_comprada','finalizada','cancelada'))::integer as abertas,
           count(*) filter (where s.status in ('em_analise','em_andamento'))::integer as aguardando_compra,
           count(*) filter (
             where s.status not in ('passagem_comprada','finalizada','cancelada')
               and s.data_ida <= current_date + case when s.motivo in ('ferias','folga_campo') then 2 else 0 end
           )::integer as atrasadas,
           count(*) filter (
             where s.houve_imprevisto
                or exists (select 1 from public.ro_passagem_anexos a where a.solicitacao_id=s.id and (a.complementar or a.imprevisto))
           )::integer as imprevistos
      from base s
     where (p_centro_custo_id is null and not p_sem_centro)
        or (not p_sem_centro and s.obra_id = p_centro_custo_id)
        or (p_sem_centro and s.obra_id is null)
     group by s.obra_id
  ),
  financeiro as (
    select coalesce(c.centro_custo_id, s.obra_id) as centro_custo_id,
           coalesce(sum(c.valor), 0)::numeric as valor_total,
           coalesce(sum(c.valor) filter (where c.descricao ilike 'Passagem complementar:%'), 0)::numeric as valor_complementar
      from base s
      join public.ro_passagem_custos c on c.solicitacao_id = s.id
     where (p_centro_custo_id is null and not p_sem_centro)
        or (not p_sem_centro and coalesce(c.centro_custo_id, s.obra_id) = p_centro_custo_id)
        or (p_sem_centro and coalesce(c.centro_custo_id, s.obra_id) is null)
     group by coalesce(c.centro_custo_id, s.obra_id)
  ),
  centros_relatorio as (
    select centro_custo_id from operacional
    union
    select centro_custo_id from financeiro
  ),
  grupos as (
    select cr.centro_custo_id,
           coalesce(op.solicitacoes, 0) as solicitacoes,
           coalesce(op.compradas, 0) as compradas,
           coalesce(op.abertas, 0) as abertas,
           coalesce(op.aguardando_compra, 0) as aguardando_compra,
           coalesce(op.atrasadas, 0) as atrasadas,
           coalesce(op.imprevistos, 0) as imprevistos,
           coalesce(fi.valor_total, 0) as valor_total,
           coalesce(fi.valor_complementar, 0) as valor_complementar
      from centros_relatorio cr
      left join operacional op on op.centro_custo_id is not distinct from cr.centro_custo_id
      left join financeiro fi on fi.centro_custo_id is not distinct from cr.centro_custo_id
  )
  select jsonb_build_object(
    'linhas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'centro_custo_id', g.centro_custo_id,
        'codigo', o.codigo,
        'nome', o.nome,
        'descricao', o.descricao,
        'solicitacoes', g.solicitacoes,
        'compradas', g.compradas,
        'abertas', g.abertas,
        'aguardando_compra', g.aguardando_compra,
        'atrasadas', g.atrasadas,
        'imprevistos', g.imprevistos,
        'valor_total', g.valor_total,
        'valor_complementar', g.valor_complementar
      )) from grupos g left join public.obras o on o.id = g.centro_custo_id
    ), '[]'::jsonb),
    'centros', coalesce((
      select jsonb_agg(jsonb_build_object('id',o.id,'codigo',o.codigo,'nome',o.nome,'descricao',o.descricao)
                       order by lower(coalesce(o.codigo,'')), lower(coalesce(o.nome,o.descricao,'')))
        from public.obras o
    ), '[]'::jsonb),
    'responsaveis', coalesce((
      select jsonb_agg(jsonb_build_object('id', ids.id, 'nome', coalesce(up.full_name, 'Responsável sem identificação'))
                       order by lower(coalesce(up.full_name,'')))
        from (
          select distinct responsavel_ro_id as id from public.ro_passagem_solicitacoes where responsavel_ro_id is not null
          union select user_id from public.ro_responsaveis where ativo
        ) ids left join public.users_profiles up on up.id = ids.id
    ), '[]'::jsonb),
    'resumo', jsonb_build_object(
      'solicitacoes', (select count(*) from base),
      'compradas', (select count(*) from base where comprado_em is not null),
      'abertas', (select count(*) from base where status not in ('passagem_comprada','finalizada','cancelada')),
      'imprevistos', (select count(*) from base s where s.houve_imprevisto or exists (
        select 1 from public.ro_passagem_anexos a where a.solicitacao_id=s.id and (a.complementar or a.imprevisto)
      )),
      'valor_total', (select coalesce(sum(c.valor),0) from base s join public.ro_passagem_custos c on c.solicitacao_id=s.id
        where (p_centro_custo_id is null and not p_sem_centro)
           or (not p_sem_centro and coalesce(c.centro_custo_id,s.obra_id)=p_centro_custo_id)
           or (p_sem_centro and coalesce(c.centro_custo_id,s.obra_id) is null)),
      'valor_complementar', (select coalesce(sum(c.valor),0) from base s join public.ro_passagem_custos c on c.solicitacao_id=s.id
        where c.descricao ilike 'Passagem complementar:%'
          and ((p_centro_custo_id is null and not p_sem_centro)
            or (not p_sem_centro and coalesce(c.centro_custo_id,s.obra_id)=p_centro_custo_id)
            or (p_sem_centro and coalesce(c.centro_custo_id,s.obra_id) is null)))
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.ro_relatorio_centros_custo(date,date,uuid,boolean,text,text,uuid) from public;
revoke all on function public.ro_relatorio_centros_custo(date,date,uuid,boolean,text,text,uuid) from anon;
grant execute on function public.ro_relatorio_centros_custo(date,date,uuid,boolean,text,text,uuid) to authenticated;
