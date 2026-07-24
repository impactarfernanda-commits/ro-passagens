create or replace function public.ro_auto_finalizar_solicitacoes()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item record;
  v_total integer := 0;
  v_mensagem constant text :=
    'Solicitação finalizada automaticamente um dia após a última passagem comprada, sem registro de imprevisto, complementar pendente ou nova compra.';
begin
  if auth.uid() is null or not public.ro_can_view_all(auth.uid()) then
    raise exception 'Apenas diretor, gerente ou responsável RO ativo pode executar esta rotina.';
  end if;

  for v_item in
    with viagens as (
      select
        s.id,
        coalesce(
          max(a.partida_em) filter (where a.partida_em is not null),
          case
            when exists (
              select 1
              from public.ro_passagem_custos c
              where c.solicitacao_id = s.id
                and c.tipo = 'passagem'
                and c.valor > 0
            ) then s.partida_em
          end
        ) as ultima_partida
      from public.ro_passagem_solicitacoes s
      left join public.ro_passagem_anexos a on a.solicitacao_id = s.id
      where s.status = 'passagem_comprada'
        and coalesce(s.houve_imprevisto, false) = false
        and not exists (
          select 1
          from public.ro_passagem_anexos pendente
          where pendente.solicitacao_id = s.id
            and (
              pendente.imprevisto
              or (pendente.complementar and pendente.partida_em is null)
            )
        )
      group by s.id, s.partida_em
    )
    select id, ultima_partida
    from viagens
    where ultima_partida is not null
      and current_date > (ultima_partida at time zone 'America/Sao_Paulo')::date
  loop
    update public.ro_passagem_solicitacoes
    set status = 'finalizada',
        chegou_ao_destino = true,
        data_chegada_confirmada = v_item.ultima_partida,
        houve_imprevisto = false,
        observacao_finalizacao = v_mensagem,
        finalizado_por = auth.uid(),
        finalizado_em = now()
    where id = v_item.id
      and status = 'passagem_comprada';

    if found then
      insert into public.ro_passagem_historico (
        solicitacao_id,
        status_anterior,
        status_novo,
        descricao,
        criado_por
      )
      select
        v_item.id,
        'passagem_comprada',
        'finalizada',
        v_mensagem,
        auth.uid()
      where not exists (
        select 1
        from public.ro_passagem_historico h
        where h.solicitacao_id = v_item.id
          and h.status_novo = 'finalizada'
          and h.descricao = v_mensagem
      );
      v_total := v_total + 1;
    end if;
  end loop;

  return v_total;
end
$$;

revoke all on function public.ro_auto_finalizar_solicitacoes() from public;
revoke all on function public.ro_auto_finalizar_solicitacoes() from anon;
grant execute on function public.ro_auto_finalizar_solicitacoes() to authenticated;
