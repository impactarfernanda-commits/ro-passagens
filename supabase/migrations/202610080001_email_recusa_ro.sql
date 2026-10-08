begin;

alter table public.ro_email_outbox
  drop constraint if exists ro_email_outbox_tipo_evento_check;
alter table public.ro_email_outbox
  add constraint ro_email_outbox_tipo_evento_check check (
    tipo_evento in (
      'aprovacao_pendente',
      'solicitacao_aprovada',
      'solicitacao_reprovada',
      'solicitacao_recusada_ro'
    )
  );

alter table public.ro_email_logs
  drop constraint if exists ro_email_logs_tipo_evento_check;
alter table public.ro_email_logs
  add constraint ro_email_logs_tipo_evento_check check (
    tipo_evento in (
      'nova_solicitacao_ro',
      'passagem_comprada_solicitante',
      'aprovacao_pendente',
      'solicitacao_aprovada',
      'solicitacao_reprovada',
      'solicitacao_recusada_ro'
    )
  );

create or replace function public.ro_recusar_solicitacao(
  p_solicitacao_id uuid,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_sol public.ro_passagem_solicitacoes%rowtype;
  v_motivo text:=trim(coalesce(p_motivo,''));
  v_viajante text;
begin
  if auth.uid() is null then raise exception 'NAO_AUTENTICADO';end if;
  if not public.ro_is_operador_ativo(auth.uid()) then raise exception 'NAO_PERTENCE_EQUIPE_RO';end if;
  if length(v_motivo)<10 then raise exception 'MOTIVO_RECUSA_OBRIGATORIO';end if;

  select * into v_sol
  from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id and excluida_em is null
  for update;

  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
  if v_sol.status='recusada' then raise exception 'SOLICITACAO_JA_RECUSADA';end if;
  if v_sol.aprovacao_status='reprovada' then raise exception 'SOLICITACAO_JA_REPROVADA';end if;
  if public.ro_solicitacao_foi_comprada(p_solicitacao_id) then raise exception 'PASSAGEM_JA_COMPRADA';end if;
  if v_sol.status not in ('solicitada','em_andamento') then raise exception 'STATUS_NAO_PERMITE_RECUSA';end if;

  perform set_config('ro.recusa_rpc','1',true);
  update public.ro_passagem_solicitacoes
  set status='recusada',recusada_em=now(),recusada_por=auth.uid(),motivo_recusa=v_motivo
  where id=p_solicitacao_id;

  insert into public.ro_passagem_historico(
    solicitacao_id,status_anterior,status_novo,descricao,criado_por
  )
  values(
    p_solicitacao_id,v_sol.status,'recusada',
    'Solicitação recusada pela equipe RO.'
      ||case when v_sol.folga_antecipada then ' A solicitação envolvia antecipação de folga de campo.' else '' end
      ||' Motivo: '||v_motivo,
    auth.uid()
  );

  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  values(
    'solicitacao_recusada',p_solicitacao_id,
    jsonb_build_object(
      'status_anterior',v_sol.status,
      'aprovacao_status_anterior',v_sol.aprovacao_status,
      'motivo',v_motivo,
      'sem_compra',true,
      'antecipacao_folga',v_sol.folga_antecipada
    ),
    auth.uid()
  );

  insert into public.ro_passagem_notificacoes(
    solicitacao_id,canal,destinatario_tipo,destinatario,mensagem
  )
  select
    p_solicitacao_id,'interno','solicitante',v_sol.solicitante_id::text,
    'Sua solicitação foi recusada. Consulte o motivo no Portal e faça uma nova solicitação com os dados corrigidos.'
  where not exists(
    select 1
    from public.ro_passagem_notificacoes n
    where n.solicitacao_id=p_solicitacao_id
      and n.canal='interno'
      and n.destinatario_tipo='solicitante'
      and n.destinatario=v_sol.solicitante_id::text
      and n.mensagem='Sua solicitação foi recusada. Consulte o motivo no Portal e faça uma nova solicitação com os dados corrigidos.'
  );

  select coalesce(
    nullif(btrim(v_sol.viajante_nome_informado),''),
    nullif(btrim(privado.nome),''),
    nullif(btrim(funcionario.nome),'')
  )
  into v_viajante
  from (select 1) base
  left join public.ro_funcionarios_enderecos_privados privado
    on privado.id=v_sol.colaborador_id
  left join public.funcionarios funcionario
    on funcionario.id=v_sol.funcionario_id;

  insert into public.ro_email_outbox(
    solicitacao_id,tipo_evento,destinatario_user_id,assunto,chave_deduplicacao
  )
  values(
    p_solicitacao_id,
    'solicitacao_recusada_ro',
    v_sol.solicitante_id,
    'Solicitação de passagem recusada — '||coalesce(v_viajante,'Viajante'),
    'solicitacao_recusada_ro:'||p_solicitacao_id::text||':'||v_sol.solicitante_id::text
  )
  on conflict(chave_deduplicacao) do nothing;

  return jsonb_build_object('id',p_solicitacao_id,'status','recusada');
end $$;

revoke all on function public.ro_recusar_solicitacao(uuid,text) from public,anon;
grant execute on function public.ro_recusar_solicitacao(uuid,text) to authenticated;

commit;
