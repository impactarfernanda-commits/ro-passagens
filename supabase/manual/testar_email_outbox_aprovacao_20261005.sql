-- DRY RUN pré-migration: aplica a migration dentro da transação, não chama Edge Function/Resend e desfaz tudo.
begin;

-- MIGRATION_202610050001_BEGIN (corpo literal sem BEGIN/COMMIT externos)
alter table public.ro_passagem_notificacoes drop constraint if exists ro_passagem_notificacoes_destinatario_tipo_check;
alter table public.ro_passagem_notificacoes add constraint ro_passagem_notificacoes_destinatario_tipo_check
  check (destinatario_tipo in ('ro','solicitante','funcionario','aprovador'));

create unique index if not exists ro_notificacao_aprovador_evento_uidx
  on public.ro_passagem_notificacoes(solicitacao_id,destinatario_tipo,destinatario)
  where canal='interno' and destinatario_tipo='aprovador';

create table public.ro_email_outbox (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.ro_passagem_solicitacoes(id) on delete cascade,
  notificacao_id uuid references public.ro_passagem_notificacoes(id) on delete set null,
  tipo_evento text not null check (tipo_evento in ('aprovacao_pendente')),
  destinatario_user_id uuid not null references auth.users(id) on delete restrict,
  email_destinatario text, assunto text not null,
  status text not null default 'pendente' check (status in ('pendente','processando','erro_retry','enviado','falha_permanente','cancelado')),
  tentativas integer not null default 0 check (tentativas between 0 and 5),
  proxima_tentativa_em timestamptz not null default now(), ultimo_erro text,
  provider_message_id text, chave_deduplicacao text not null,
  locked_at timestamptz, locked_by text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(), enviado_em timestamptz,
  constraint ro_email_outbox_chave_deduplicacao_key unique(chave_deduplicacao),
  constraint ro_email_outbox_lock_coerente check ((status='processando' and locked_at is not null and locked_by is not null) or (status<>'processando' and locked_at is null and locked_by is null))
);
create index ro_email_outbox_consumo_idx on public.ro_email_outbox(proxima_tentativa_em,criado_em) where status in ('pendente','erro_retry');
create index ro_email_outbox_lease_idx on public.ro_email_outbox(locked_at) where status='processando';
create index ro_email_outbox_solicitacao_idx on public.ro_email_outbox(solicitacao_id,criado_em desc);
alter table public.ro_email_outbox enable row level security;
revoke all on table public.ro_email_outbox from public,anon,authenticated;
grant select,insert,update on table public.ro_email_outbox to service_role;

alter table public.ro_email_logs drop constraint if exists ro_email_logs_tipo_evento_check;
alter table public.ro_email_logs add constraint ro_email_logs_tipo_evento_check check (tipo_evento in ('nova_solicitacao_ro','passagem_comprada_solicitante','aprovacao_pendente'));
alter table public.ro_email_logs drop constraint if exists ro_email_logs_destinatario_tipo_check;
alter table public.ro_email_logs add constraint ro_email_logs_destinatario_tipo_check check (destinatario_tipo in ('ro','solicitante','aprovador'));

drop policy if exists ro_child_notif_select on public.ro_passagem_notificacoes;
create policy ro_child_notif_select on public.ro_passagem_notificacoes for select to authenticated using(
  canal='interno' and ((destinatario_tipo='solicitante' and destinatario=auth.uid()::text)
    or (destinatario_tipo='aprovador' and destinatario=auth.uid()::text)
    or (destinatario_tipo='ro' and exists(select 1 from public.ro_responsaveis r where r.user_id=auth.uid() and r.ativo)))
);

create or replace function public.ro_listar_minhas_notificacoes()
returns table(id uuid,solicitacao_id uuid,canal text,destinatario_tipo text,destinatario text,mensagem text,status text,created_at timestamptz,lida_em timestamptz)
language sql stable security definer set search_path='' as $$
  select n.id,n.solicitacao_id,n.canal,n.destinatario_tipo,n.destinatario,n.mensagem,n.status,n.created_at,l.lida_em
  from public.ro_passagem_notificacoes n left join public.ro_passagem_notificacoes_lidas l on l.notificacao_id=n.id and l.user_id=auth.uid()
  where auth.uid() is not null and n.canal='interno' and ((n.destinatario_tipo='solicitante' and n.destinatario=auth.uid()::text)
    or (n.destinatario_tipo='aprovador' and n.destinatario=auth.uid()::text)
    or (n.destinatario_tipo='ro' and n.destinatario is null and exists(select 1 from public.ro_responsaveis r where r.user_id=auth.uid() and r.ativo)))
  order by n.created_at desc limit 100;
$$;

create or replace function public.ro_marcar_todas_notificacoes_lidas()
returns integer language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid();v_marcadas integer;
begin
  if v_user_id is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
  insert into public.ro_passagem_notificacoes_lidas(notificacao_id,user_id)
  select n.id,v_user_id from public.ro_passagem_notificacoes n where n.canal='interno' and(
    (n.destinatario_tipo='solicitante' and n.destinatario=v_user_id::text)
    or (n.destinatario_tipo='aprovador' and n.destinatario=v_user_id::text)
    or (n.destinatario_tipo='ro' and n.destinatario is null and exists(select 1 from public.ro_responsaveis r where r.user_id=v_user_id and r.ativo)))
  on conflict(notificacao_id,user_id) do nothing;
  get diagnostics v_marcadas=row_count;return v_marcadas;
end $$;

create or replace function public.ro_notificar_equipe_nova_solicitacao()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce(current_setting('ro.approval_creation',true),'')='1' then return new;end if;
  insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem) values(new.id,'interno','ro',null,'Nova solicitação de passagem criada.');
  return new;
end $$;

create or replace function public.ro_enfileirar_aprovacao_pendente()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_notificacao_id uuid;v_solicitante text;
begin
  if new.aprovacao_status='pendente' and new.aprovador_id is not null
     and (old.aprovacao_status,old.aprovador_id) is distinct from (new.aprovacao_status,new.aprovador_id) then
    insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem)
    values(new.id,'interno','aprovador',new.aprovador_id::text,'Existe uma solicitação de passagem aguardando sua aprovação.')
    on conflict(solicitacao_id,destinatario_tipo,destinatario) where canal='interno' and destinatario_tipo='aprovador'
    do update set solicitacao_id=excluded.solicitacao_id returning id into v_notificacao_id;
    select nullif(btrim(p.full_name),'') into v_solicitante from public.users_profiles p where p.id=new.solicitante_id;
    insert into public.ro_email_outbox(solicitacao_id,notificacao_id,tipo_evento,destinatario_user_id,assunto,chave_deduplicacao)
    values(new.id,v_notificacao_id,'aprovacao_pendente',new.aprovador_id,'Passagem aguardando sua aprovação — '||coalesce(v_solicitante,'Solicitante'),'aprovacao_pendente:'||new.id::text||':'||new.aprovador_id::text)
    on conflict(chave_deduplicacao) do nothing;
  end if;return new;
end $$;
drop trigger if exists ro_enfileirar_aprovacao_pendente on public.ro_passagem_solicitacoes;
create trigger ro_enfileirar_aprovacao_pendente after update of aprovacao_status,aprovador_id on public.ro_passagem_solicitacoes for each row execute function public.ro_enfileirar_aprovacao_pendente();

create or replace function public.ro_claim_email_outbox(p_worker_id text,p_limite integer default 10,p_lease_segundos integer default 300)
returns setof public.ro_email_outbox language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'ACESSO_NEGADO';end if;
  if nullif(btrim(p_worker_id),'') is null then raise exception 'WORKER_ID_OBRIGATORIO';end if;
  update public.ro_email_outbox set status='falha_permanente',ultimo_erro='Lease expirado após a última tentativa',locked_at=null,locked_by=null,atualizado_em=now()
  where status='processando' and tentativas>=5 and locked_at<now()-make_interval(secs=>greatest(30,least(p_lease_segundos,3600)));
  return query with candidatas as(
    select o.id from public.ro_email_outbox o where o.tentativas<5 and(
      (o.status in('pendente','erro_retry') and o.proxima_tentativa_em<=now())
      or(o.status='processando' and o.locked_at<now()-make_interval(secs=>greatest(30,least(p_lease_segundos,3600)))))
    order by o.proxima_tentativa_em,o.criado_em for update skip locked limit greatest(1,least(p_limite,50))
  ) update public.ro_email_outbox o set status='processando',tentativas=o.tentativas+1,locked_at=now(),locked_by=left(p_worker_id,200),atualizado_em=now()
    from candidatas c where o.id=c.id returning o.*;
end $$;

create or replace function public.ro_finalizar_email_outbox(p_id uuid,p_worker_id text,p_status text,p_email text default null,p_provider_message_id text default null,p_ultimo_erro text default null,p_proxima_tentativa_em timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'ACESSO_NEGADO';end if;
  if p_status not in('erro_retry','enviado','falha_permanente','cancelado') then raise exception 'STATUS_FINAL_INVALIDO';end if;
  update public.ro_email_outbox set status=p_status,email_destinatario=coalesce(p_email,email_destinatario),provider_message_id=case when p_status='enviado' then p_provider_message_id else provider_message_id end,
    ultimo_erro=left(nullif(p_ultimo_erro,''),500),proxima_tentativa_em=case when p_status='erro_retry' then coalesce(p_proxima_tentativa_em,now()+interval '1 minute') else proxima_tentativa_em end,
    locked_at=null,locked_by=null,atualizado_em=now(),enviado_em=case when p_status='enviado' then now() else enviado_em end
  where id=p_id and status='processando' and locked_by=p_worker_id;
  if not found then raise exception 'LEASE_INVALIDO';end if;
end $$;

revoke all on function public.ro_enfileirar_aprovacao_pendente(),public.ro_claim_email_outbox(text,integer,integer),public.ro_finalizar_email_outbox(uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.ro_claim_email_outbox(text,integer,integer),public.ro_finalizar_email_outbox(uuid,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.ro_listar_minhas_notificacoes(),public.ro_marcar_notificacao_lida(uuid),public.ro_marcar_todas_notificacoes_lidas() to authenticated;
-- MIGRATION_202610050001_END

create temporary table ro_email_outbox_resultados(
  indicador text primary key,
  aprovado boolean not null,
  detalhe text not null
) on commit drop;

do $$
declare
  v_sol public.ro_passagem_solicitacoes%rowtype;v_aprovador uuid;v_outbox uuid;v_notificacao uuid;
  v_ro_antes bigint;v_ro_depois bigint;v_qtd bigint;v_ok boolean;v_fixture boolean:=false;
begin
  select * into v_sol from public.ro_passagem_solicitacoes
  where status='solicitada' and excluida_em is null and aprovador_id is not null and solicitante_id<>aprovador_id
  order by created_at desc limit 1;
  v_fixture:=found;

  if v_fixture then
    v_aprovador:=v_sol.aprovador_id;
    select count(*) into v_ro_antes from public.ro_passagem_notificacoes where solicitacao_id=v_sol.id and destinatario_tipo='ro';
    perform set_config('ro.aprovacao_rpc','1',true);
    update public.ro_passagem_solicitacoes set aprovacao_status='aprovada',aprovado_em=now(),reprovado_em=null,motivo_reprovacao_aprovador=null where id=v_sol.id;
    update public.ro_passagem_solicitacoes set aprovacao_status='pendente',aprovador_id=v_aprovador,aprovado_em=null,reprovado_em=null,motivo_reprovacao_aprovador=null where id=v_sol.id;
    select id into v_notificacao from public.ro_passagem_notificacoes where solicitacao_id=v_sol.id and destinatario_tipo='aprovador' and destinatario=v_aprovador::text;
    select id into v_outbox from public.ro_email_outbox where chave_deduplicacao='aprovacao_pendente:'||v_sol.id||':'||v_aprovador;

    insert into ro_email_outbox_resultados values
      ('A_NOTIFICACAO_APROVADOR',v_notificacao is not null,case when v_notificacao is not null then '1 notificação interna individual criada' else 'A_FALHOU_NOTIFICACAO_APROVADOR' end),
      ('B_OUTBOX_APROVACAO_PENDENTE',v_outbox is not null,case when v_outbox is not null then '1 evento criado na outbox' else 'B_FALHOU_OUTBOX_APROVACAO_PENDENTE' end);

    insert into public.ro_email_outbox(solicitacao_id,notificacao_id,tipo_evento,destinatario_user_id,assunto,chave_deduplicacao)
    values(v_sol.id,v_notificacao,'aprovacao_pendente',v_aprovador,'Teste','aprovacao_pendente:'||v_sol.id||':'||v_aprovador)
    on conflict(chave_deduplicacao) do nothing;
    select count(*) into v_qtd from public.ro_email_outbox where chave_deduplicacao='aprovacao_pendente:'||v_sol.id||':'||v_aprovador;
    insert into ro_email_outbox_resultados values('C_DEDUPLICACAO',v_qtd=1,case when v_qtd=1 then 'chave persistiu uma única vez' else 'C_FALHOU_DEDUPLICACAO: quantidade='||v_qtd end);

    v_ok:=not exists(select 1 from public.ro_passagem_notificacoes where id=v_notificacao and destinatario<>v_aprovador::text);
    insert into ro_email_outbox_resultados values('D_DESTINATARIO_INDIVIDUAL',v_ok,case when v_ok then 'somente o aprovador indicado é destinatário' else 'D_FALHOU_OUTRO_APROVADOR' end);

    select count(*) into v_ro_depois from public.ro_passagem_notificacoes where solicitacao_id=v_sol.id and destinatario_tipo='ro';
    insert into ro_email_outbox_resultados values('G_SEM_AVISO_RO_PREMATURO',v_ro_depois=v_ro_antes,case when v_ro_depois=v_ro_antes then 'transição pendente não criou aviso RO' else 'G_FALHOU_SUPRESSAO_RO' end);

    update public.ro_passagem_solicitacoes set aprovacao_status='aprovada',aprovado_em=now(),reprovado_em=null,motivo_reprovacao_aprovador=null where id=v_sol.id;
    update public.ro_email_outbox o set status='cancelado',locked_at=null,locked_by=null,atualizado_em=now()
    where o.id=v_outbox and not exists(select 1 from public.ro_passagem_solicitacoes s where s.id=o.solicitacao_id and s.excluida_em is null and s.aprovacao_status='pendente' and s.aprovador_id=o.destinatario_user_id);
    select status='cancelado' into v_ok from public.ro_email_outbox where id=v_outbox;
    insert into ro_email_outbox_resultados values('I_EVENTO_OBSOLETO_CANCELAVEL',coalesce(v_ok,false),case when coalesce(v_ok,false) then 'evento aprovado antes do processamento foi cancelado' else 'I_FALHOU_REVALIDACAO' end);
  else
    insert into ro_email_outbox_resultados values
      ('A_NOTIFICACAO_APROVADOR',false,'PREFLIGHT_FIXTURE ausente: necessária solicitação ativa com aprovador distinto'),
      ('B_OUTBOX_APROVACAO_PENDENTE',false,'PREFLIGHT_FIXTURE ausente'),
      ('C_DEDUPLICACAO',false,'PREFLIGHT_FIXTURE ausente'),
      ('D_DESTINATARIO_INDIVIDUAL',false,'PREFLIGHT_FIXTURE ausente'),
      ('G_SEM_AVISO_RO_PREMATURO',false,'PREFLIGHT_FIXTURE ausente'),
      ('I_EVENTO_OBSOLETO_CANCELAVEL',false,'PREFLIGHT_FIXTURE ausente');
  end if;

  v_ok:=position('destinatario_tipo=''aprovador''' in pg_get_functiondef('public.ro_listar_minhas_notificacoes()'::regprocedure))>0
    and position('destinatario=auth.uid()::text' in pg_get_functiondef('public.ro_listar_minhas_notificacoes()'::regprocedure))>0;
  insert into ro_email_outbox_resultados values
    ('E_VISIVEL_AO_APROVADOR',v_ok,case when v_ok then 'listagem inclui o aprovador autenticado' else 'E_F_FALHOU_VISIBILIDADE_APROVADOR' end),
    ('F_NAO_VISIVEL_A_OUTRO',v_ok,case when v_ok then 'listagem exige destinatário igual a auth.uid()' else 'E_F_FALHOU_VISIBILIDADE_APROVADOR' end);

  v_ok:=position('ro.approval_creation' in pg_get_functiondef('public.ro_notificar_equipe_nova_solicitacao()'::regprocedure))>0;
  insert into ro_email_outbox_resultados values('G2_FLAG_SUPRESSAO_RO',v_ok,case when v_ok then 'trigger de criação respeita approval_creation' else 'G_FALHOU_SUPRESSAO_RO' end);
  v_ok:=position('ro_notificar_equipe_solicitacao_liberada' in pg_get_functiondef('public.ro_aprovar_solicitacao(uuid)'::regprocedure))>0;
  insert into ro_email_outbox_resultados values('H_LIBERACAO_RO_PRESERVADA',v_ok,case when v_ok then 'aprovação mantém liberação RO canônica' else 'H_FALHOU_LIBERACAO_RO' end);

  v_ok:=not has_table_privilege('authenticated','public.ro_email_outbox','INSERT') and not has_table_privilege('authenticated','public.ro_email_outbox','UPDATE') and not has_table_privilege('authenticated','public.ro_email_outbox','DELETE');
  insert into ro_email_outbox_resultados values('J_SEGURANCA_OUTBOX',v_ok,case when v_ok then 'authenticated sem DML direto' else 'J_FALHOU_PRIVILEGIOS' end);

  v_ok:=to_regprocedure('public.ro_marcar_notificacao_lida(uuid)') is not null;
  insert into ro_email_outbox_resultados values('K1_MARCAR_UMA_PRESERVADO',v_ok,case when v_ok then 'RPC marcar uma presente' else 'K_FALHOU_NOTIFICACOES_LEGADAS' end);
  v_ok:=to_regprocedure('public.ro_marcar_todas_notificacoes_lidas()') is not null and position('destinatario_tipo=''solicitante''' in pg_get_functiondef('public.ro_marcar_todas_notificacoes_lidas()'::regprocedure))>0 and position('destinatario_tipo=''ro''' in pg_get_functiondef('public.ro_marcar_todas_notificacoes_lidas()'::regprocedure))>0;
  insert into ro_email_outbox_resultados values('K2_MARCAR_TODAS_E_FLUXOS_ATUAIS',v_ok,case when v_ok then 'solicitante, RO e marcar todas preservados' else 'K_FALHOU_NOTIFICACOES_LEGADAS' end);
end $$;

select
  indicador,
  aprovado,
  detalhe,
  count(*) filter (where aprovado) over() as aprovados,
  count(*) over() as total,
  bool_and(aprovado) over() as todos_aprovados
from ro_email_outbox_resultados
order by indicador;

rollback;
