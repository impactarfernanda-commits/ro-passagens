begin;

-- Uma folga só bloqueia nova solicitação quando o fluxo operacional e a
-- aprovação ainda estão efetivamente ativos. A conjunção também impede que
-- uma antecipação pendente mantenha canceladas/recusadas no bloqueio.
create or replace function public.ro_funcionario_possui_folga_futura_ativa(
  p_funcionario_id uuid,
  p_ignorar_solicitacao_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select s.id
  from public.ro_passagem_solicitacoes s
  where s.funcionario_id=p_funcionario_id
    and s.motivo='folga_campo'
    and s.id is distinct from p_ignorar_solicitacao_id
    and s.excluida_em is null
    and s.data_ida >= (now() at time zone 'America/Sao_Paulo')::date
    and s.status in ('solicitada','em_andamento','passagem_comprada')
    and s.aprovacao_status is distinct from 'reprovada'
  order by s.data_ida,s.created_at
  limit 1;
$$;

-- Expõe os dois eixos para a interface apresentar o estado efetivo.
create or replace function public.ro_obter_ciclo_folga_funcionario(p_funcionario_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_ultima public.ro_passagem_solicitacoes%rowtype;
  v_futura public.ro_passagem_solicitacoes%rowtype;
  v_proxima date;
begin
  if auth.uid() is null then raise exception 'NAO_AUTENTICADO'; end if;
  select * into v_ultima
  from public.ro_passagem_solicitacoes s
  where s.funcionario_id=p_funcionario_id and s.motivo='folga_campo'
    and s.status='finalizada'
    and s.data_ida <= (now() at time zone 'America/Sao_Paulo')::date
  order by coalesce(s.folga_data_prevista_ciclo,s.data_ida) desc,s.data_ida desc
  limit 1;
  if found then v_proxima:=coalesce(v_ultima.folga_data_prevista_ciclo,v_ultima.data_ida)+90; end if;
  select * into v_futura
  from public.ro_passagem_solicitacoes s
  where s.id=public.ro_funcionario_possui_folga_futura_ativa(p_funcionario_id,null);
  return jsonb_build_object(
    'possui_historico',v_ultima.id is not null,
    'ultima_solicitacao_id',v_ultima.id,
    'ultima_folga_realizada',v_ultima.data_ida,
    'ultima_data_prevista_ciclo',v_ultima.folga_data_prevista_ciclo,
    'proxima_folga_prevista',v_proxima,
    'data_limite_recomendada',v_proxima-15,
    'solicitacao_futura_existente_id',v_futura.id,
    'solicitacao_futura_data',v_futura.data_ida,
    'solicitacao_futura_status',v_futura.status,
    'solicitacao_futura_aprovacao_status',v_futura.aprovacao_status
  );
end $$;

-- Mantém a recusa operacional disponível durante a aprovação pendente, sem
-- transformar uma reprovação já encerrada pelo coordenador em recusa da RO.
create or replace function public.ro_recusar_solicitacao(p_solicitacao_id uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;v_motivo text:=trim(coalesce(p_motivo,''));
begin
 if auth.uid() is null then raise exception 'NAO_AUTENTICADO';end if;
 if not public.ro_is_operador_ativo(auth.uid()) then raise exception 'NAO_PERTENCE_EQUIPE_RO';end if;
 if length(v_motivo)<10 then raise exception 'MOTIVO_RECUSA_OBRIGATORIO';end if;
 select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id and excluida_em is null for update;
 if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
 if v_sol.status='recusada' then raise exception 'SOLICITACAO_JA_RECUSADA';end if;
 if v_sol.aprovacao_status='reprovada' then raise exception 'SOLICITACAO_JA_REPROVADA';end if;
 if public.ro_solicitacao_foi_comprada(p_solicitacao_id) then raise exception 'PASSAGEM_JA_COMPRADA';end if;
 if v_sol.status not in ('solicitada','em_andamento') then raise exception 'STATUS_NAO_PERMITE_RECUSA';end if;
 perform set_config('ro.recusa_rpc','1',true);
 update public.ro_passagem_solicitacoes set status='recusada',recusada_em=now(),recusada_por=auth.uid(),motivo_recusa=v_motivo where id=p_solicitacao_id;
 insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
 values(p_solicitacao_id,v_sol.status,'recusada','Solicitação recusada pela equipe RO.'||case when v_sol.folga_antecipada then ' A solicitação envolvia antecipação de folga de campo.' else '' end||' Motivo: '||v_motivo,auth.uid());
 insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
 values('solicitacao_recusada',p_solicitacao_id,jsonb_build_object('status_anterior',v_sol.status,'aprovacao_status_anterior',v_sol.aprovacao_status,'motivo',v_motivo,'sem_compra',true,'antecipacao_folga',v_sol.folga_antecipada),auth.uid());
 insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem)
 select p_solicitacao_id,'interno','solicitante',v_sol.solicitante_id::text,'Sua solicitação foi recusada. Consulte o motivo no Portal e faça uma nova solicitação com os dados corrigidos.'
 where not exists(select 1 from public.ro_passagem_notificacoes n where n.solicitacao_id=p_solicitacao_id and n.canal='interno' and n.destinatario_tipo='solicitante' and n.destinatario=v_sol.solicitante_id::text and n.mensagem='Sua solicitação foi recusada. Consulte o motivo no Portal e faça uma nova solicitação com os dados corrigidos.');
 return jsonb_build_object('id',p_solicitacao_id,'status','recusada');
end $$;

revoke all on function public.ro_funcionario_possui_folga_futura_ativa(uuid,uuid),
  public.ro_obter_ciclo_folga_funcionario(uuid),public.ro_recusar_solicitacao(uuid,text) from public,anon;
grant execute on function public.ro_obter_ciclo_folga_funcionario(uuid),
  public.ro_recusar_solicitacao(uuid,text) to authenticated;

commit;
