begin;

-- MIGRATION_202610080001_BEGIN
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
-- MIGRATION_202610080001_END

create temporary table dry_email_recusa_ro_fixtures(
  caso text primary key,
  solicitacao_id uuid not null,
  solicitante_id uuid not null
);
create temporary table dry_email_recusa_ro_checks(
  indicador text primary key,
  aprovado boolean not null,
  detalhe text not null
);

do $teste$
declare
  v_solicitante uuid;
  v_aprovador uuid;
  v_funcionario uuid;
  v_obra uuid;
  v_rh uuid;
  v_ro uuid;
  v_id uuid;
  v_payload jsonb;
  v_qtd bigint;
  v_caso text;
  v_bloqueada boolean:=false;
  v_pix_fixture constant text:='dry-run-pix-nao-real@example.invalid';
  r record;
begin
  select u.id into v_solicitante from auth.users u
  where not coalesce(public.ro_approval_exempt(u.id),false)
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
  order by u.id limit 1;
  select u.id into v_aprovador from auth.users u
  where u.id is distinct from v_solicitante and public.ro_is_approval_candidate(u.id)
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
  order by u.id limit 1;
  select f.id into v_funcionario from public.funcionarios f
  where f.ativo and f.deleted_at is null and f.visivel_passagens and f.escopo_passagens='comum'
  order by f.id limit 1;
  select o.id into v_obra from public.obras o
  where o.visivel_passagens and o.escopo_passagens='comum' order by o.id limit 1;
  select user_id into v_rh from public.ro_rh_responsaveis where ativo order by user_id limit 1;
  select user_id into v_ro from public.ro_responsaveis where ativo order by user_id limit 1;
  if v_solicitante is null or v_aprovador is null or v_funcionario is null
     or v_obra is null or v_rh is null or v_ro is null then
    raise exception 'PREFLIGHT_ESTRUTURAL: recursos estruturais insuficientes';
  end if;

  v_payload:=jsonb_build_object(
    'funcionario_id',v_funcionario,'obra_id',v_obra,
    'origem','Origem Sintética - SP','destino','Destino Sintético - RO',
    'motivo','transferencia_obra',
    'data_ida',((now() at time zone 'America/Sao_Paulo')::date+60)::text,
    'pix_viajante',v_pix_fixture,'aprovador_id',v_aprovador
  );
  perform set_config('request.jwt.claim.sub',v_solicitante::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_solicitante,'role','authenticated')::text,true);
  foreach v_caso in array array['recusa_ro','reprovacao_aprovador','aprovacao','exclusao'] loop
    v_id:=public.ro_criar_solicitacao_com_aprovador(v_payload,'[]'::jsonb);
    insert into dry_email_recusa_ro_fixtures values(v_caso,v_id,v_solicitante);
  end loop;

  -- Fixture manual própria, criada na mesma transação e revertida ao final.
  perform set_config('request.jwt.claim.sub',v_rh::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_rh,'role','authenticated')::text,true);
  v_id:=public.ro_criar_solicitacao_com_aprovador(
    jsonb_build_object('viajante_nome_informado','Viajante Manual Dry Run',
      'obra_id',v_obra,'origem','Origem Sintética - SP','destino','Destino Sintético - RO',
      'motivo','viagem_administrativa','data_ida',((now() at time zone 'America/Sao_Paulo')::date+1)::text,
      'pix_viajante',v_pix_fixture),
    '[]'::jsonb
  );
  insert into dry_email_recusa_ro_fixtures values('viajante_manual',v_id,v_rh);

  select * into r from dry_email_recusa_ro_fixtures where caso='recusa_ro';
  perform set_config('request.jwt.claim.sub',v_ro::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ro,'role','authenticated')::text,true);
  perform public.ro_recusar_solicitacao(r.solicitacao_id,'Motivo operacional sintético para validação controlada.');
  select count(*) into v_qtd from public.ro_email_outbox e
  where e.chave_deduplicacao='solicitacao_recusada_ro:'||r.solicitacao_id||':'||r.solicitante_id
    and e.tipo_evento='solicitacao_recusada_ro' and e.destinatario_user_id=r.solicitante_id;
  insert into dry_email_recusa_ro_checks values('recusa_cria_uma_outbox_solicitante',v_qtd=1,'quantidade='||v_qtd);
  select count(*) into v_qtd from public.ro_email_outbox where solicitacao_id=r.solicitacao_id and tipo_evento='solicitacao_reprovada';
  insert into dry_email_recusa_ro_checks values('recusa_ro_nao_gera_reprovada',v_qtd=0,'quantidade='||v_qtd);
  begin
    perform public.ro_recusar_solicitacao(r.solicitacao_id,'Motivo operacional sintético para validação controlada.');
  exception when others then v_bloqueada:=position('SOLICITACAO_JA_RECUSADA' in sqlerrm)>0; end;
  select count(*) into v_qtd from public.ro_email_outbox
  where chave_deduplicacao='solicitacao_recusada_ro:'||r.solicitacao_id||':'||r.solicitante_id;
  insert into dry_email_recusa_ro_checks values('recusa_repetida_bloqueada_sem_duplicar',v_bloqueada and v_qtd=1,'bloqueada='||v_bloqueada||', quantidade='||v_qtd);

  select * into r from dry_email_recusa_ro_fixtures where caso='viajante_manual';
  perform public.ro_recusar_solicitacao(r.solicitacao_id,'Motivo operacional sintético para viajante manual.');
  insert into dry_email_recusa_ro_checks
  select 'viajante_manual_no_assunto',count(*)=1,'quantidade='||count(*)
  from public.ro_email_outbox where solicitacao_id=r.solicitacao_id
    and tipo_evento='solicitacao_recusada_ro' and assunto like '%Viajante Manual Dry Run';

  select * into r from dry_email_recusa_ro_fixtures where caso='reprovacao_aprovador';
  perform set_config('request.jwt.claim.sub',v_aprovador::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_aprovador,'role','authenticated')::text,true);
  perform public.ro_reprovar_solicitacao(r.solicitacao_id,'Motivo sintético suficiente para reprovação do aprovador.');
  insert into dry_email_recusa_ro_checks
  select 'reprovacao_aprovador_somente_evento_proprio',
    count(*) filter(where tipo_evento='solicitacao_reprovada')=1 and count(*) filter(where tipo_evento='solicitacao_recusada_ro')=0,
    'eventos='||string_agg(tipo_evento,',')
  from public.ro_email_outbox where solicitacao_id=r.solicitacao_id;

  select * into r from dry_email_recusa_ro_fixtures where caso='aprovacao';
  perform public.ro_aprovar_solicitacao(r.solicitacao_id);
  insert into dry_email_recusa_ro_checks
  select 'aprovacao_nao_gera_recusa_ro',count(*)=0,'quantidade='||count(*)
  from public.ro_email_outbox where solicitacao_id=r.solicitacao_id and tipo_evento='solicitacao_recusada_ro';

  select * into r from dry_email_recusa_ro_fixtures where caso='exclusao';
  perform set_config('ro.aprovacao_rpc','1',true);
  update public.ro_passagem_solicitacoes set excluida_em=now() where id=r.solicitacao_id;
  insert into dry_email_recusa_ro_checks
  select 'exclusao_nao_gera_recusa_ro',count(*)=0,'quantidade='||count(*)
  from public.ro_email_outbox where solicitacao_id=r.solicitacao_id and tipo_evento='solicitacao_recusada_ro';

  insert into dry_email_recusa_ro_checks values
    ('evento_anterior_preservado',to_regprocedure('public.ro_enfileirar_aprovacao_pendente()') is not null,'RPC anterior presente'),
    ('rh_dispensado_por_si_nao_gera_recusa',not exists(select 1 from public.ro_email_outbox e join dry_email_recusa_ro_fixtures f on f.solicitacao_id=e.solicitacao_id where f.caso='viajante_manual' and e.tipo_evento='solicitacao_recusada_ro' and e.criado_em < transaction_timestamp()),'nenhum evento anterior à recusa explícita');
end
$teste$;

select indicador,aprovado,detalhe,bool_and(aprovado) over() todos_aprovados
from dry_email_recusa_ro_checks order by indicador;

-- O cron/worker em outra sessão não pode enxergar as fixtures não confirmadas.
rollback;
