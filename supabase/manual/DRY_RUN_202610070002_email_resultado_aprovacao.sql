-- DRY RUN transacional. Não chama a Edge Function e termina obrigatoriamente em ROLLBACK.
-- As solicitações, notificações e itens de outbox ficam sem commit nesta sessão:
-- o cron/worker em outra sessão não pode enxergá-los, e o ROLLBACK remove tudo.
-- O cron permanece ativo; não há chamada HTTP nem invocação da Edge Function.
begin;

-- MIGRATION_202610070002_BEGIN (corpo exato, sem delimitadores externos)
alter table public.ro_email_outbox
  drop constraint if exists ro_email_outbox_tipo_evento_check;
alter table public.ro_email_outbox
  add constraint ro_email_outbox_tipo_evento_check check (
    tipo_evento in (
      'aprovacao_pendente',
      'solicitacao_aprovada',
      'solicitacao_reprovada'
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
      'solicitacao_reprovada'
    )
  );

create or replace function public.ro_enfileirar_resultado_aprovacao()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_evento text;
  v_viajante text;
begin
  if old.aprovacao_status is distinct from 'pendente'
     or new.aprovacao_status not in ('aprovada','reprovada') then
    return new;
  end if;

  v_evento:=case new.aprovacao_status
    when 'aprovada' then 'solicitacao_aprovada'
    else 'solicitacao_reprovada'
  end;

  select coalesce(
    nullif(btrim(new.viajante_nome_informado),''),
    nullif(btrim(privado.nome),''),
    nullif(btrim(funcionario.nome),'')
  )
  into v_viajante
  from (select 1) base
  left join public.ro_funcionarios_enderecos_privados privado
    on privado.id=new.colaborador_id
  left join public.funcionarios funcionario
    on funcionario.id=new.funcionario_id;

  insert into public.ro_email_outbox(
    solicitacao_id,
    tipo_evento,
    destinatario_user_id,
    assunto,
    chave_deduplicacao
  )
  values(
    new.id,
    v_evento,
    new.solicitante_id,
    case new.aprovacao_status
      when 'aprovada' then 'Solicitação de passagem aprovada — '
      else 'Solicitação de passagem reprovada — '
    end || coalesce(v_viajante,'Viajante'),
    v_evento||':'||new.id::text||':'||new.solicitante_id::text
  )
  on conflict(chave_deduplicacao) do nothing;

  return new;
end $$;

drop trigger if exists ro_enfileirar_resultado_aprovacao
on public.ro_passagem_solicitacoes;

create trigger ro_enfileirar_resultado_aprovacao
after update of aprovacao_status
on public.ro_passagem_solicitacoes
for each row
execute function public.ro_enfileirar_resultado_aprovacao();

revoke all on function public.ro_enfileirar_resultado_aprovacao()
from public,anon,authenticated;
-- MIGRATION_202610070002_END

create temporary table dry_email_resultado_fixtures(
  ordem integer primary key,
  solicitacao_id uuid not null,
  aprovador_id uuid not null,
  solicitante_id uuid not null
) on commit drop;

create temporary table dry_email_resultado_checks(
  indicador text primary key,
  aprovado boolean not null,
  detalhe text not null
) on commit drop;

do $teste$
declare
  a dry_email_resultado_fixtures%rowtype;
  r dry_email_resultado_fixtures%rowtype;
  o dry_email_resultado_fixtures%rowtype;
  v_solicitante uuid;
  v_aprovador uuid;
  v_funcionario uuid;
  v_obra uuid;
  v_rh uuid;
  v_ro uuid;
  v_id uuid;
  v_payload jsonb;
  v_pix_fixture constant text:='dry-run-pix-nao-real@example.invalid';
  v_qtd bigint;
  v_ordem integer;
  v_repeticao_bloqueada boolean:=false;
  v_def text;
begin
  select u.id into v_solicitante
  from auth.users u
  where not coalesce(public.ro_approval_exempt(u.id),false)
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
  order by u.id
  limit 1;

  select u.id into v_aprovador
  from auth.users u
  where u.id is distinct from v_solicitante
    and public.ro_is_approval_candidate(u.id)
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
  order by u.id
  limit 1;

  select f.id into v_funcionario
  from public.funcionarios f
  where f.ativo and f.deleted_at is null and f.visivel_passagens
    and f.escopo_passagens='comum'
  order by f.id
  limit 1;

  select ob.id into v_obra
  from public.obras ob
  where ob.visivel_passagens and ob.escopo_passagens='comum'
  order by ob.id
  limit 1;

  select rr.user_id into v_rh
  from public.ro_rh_responsaveis rr
  where rr.ativo
  order by rr.user_id
  limit 1;

  select rr.user_id into v_ro
  from public.ro_responsaveis rr
  where rr.ativo
  order by rr.user_id
  limit 1;

  if v_solicitante is null or v_aprovador is null or v_funcionario is null
     or v_obra is null or v_rh is null or v_ro is null then
    raise exception 'PREFLIGHT_ESTRUTURAL: usuário, aprovador, funcionário, centro de custo, RH ou RO elegível ausente';
  end if;

  v_payload:=jsonb_build_object(
    'funcionario_id',v_funcionario,
    'obra_id',v_obra,
    'origem','Rio Claro - SP',
    'destino','Porto Velho - RO',
    'motivo','transferencia_obra',
    'data_ida',((now() at time zone 'America/Sao_Paulo')::date+60)::text,
    -- Valor obviamente sintético, persistido somente nesta transação revertida.
    'pix_viajante',v_pix_fixture,
    'aprovador_id',v_aprovador
  );

  perform set_config('request.jwt.claim.sub',v_solicitante::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_solicitante,'role','authenticated')::text,true);
  for v_ordem in 1..3 loop
    v_id:=public.ro_criar_solicitacao_com_aprovador(v_payload,'[]'::jsonb);
    insert into dry_email_resultado_fixtures
    values(v_ordem,v_id,v_aprovador,v_solicitante);
  end loop;

  select * into a from dry_email_resultado_fixtures where ordem=1;
  select * into r from dry_email_resultado_fixtures where ordem=2;
  select * into o from dry_email_resultado_fixtures where ordem=3;

  -- Exercita a identidade manual canônica sem relaxar regras: somente o RH
  -- ativo converte a fixture A antes da decisão do aprovador.
  perform set_config('request.jwt.claim.sub',v_rh::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_rh,'role','authenticated')::text,true);
  update public.ro_passagem_solicitacoes
  set funcionario_id=null,colaborador_id=null,
      viajante_nome_informado='Viajante Manual Dry Run'
  where id=a.solicitacao_id;

  perform set_config('request.jwt.claim.sub',a.aprovador_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a.aprovador_id,'role','authenticated')::text,true);
  perform public.ro_aprovar_solicitacao(a.solicitacao_id);

  select count(*) into v_qtd
  from public.ro_email_outbox e
  where e.chave_deduplicacao='solicitacao_aprovada:'||a.solicitacao_id||':'||a.solicitante_id
    and e.tipo_evento='solicitacao_aprovada'
    and e.destinatario_user_id=a.solicitante_id;
  insert into dry_email_resultado_checks values(
    'aprovacao_outbox_unica_solicitante',v_qtd=1,'quantidade='||v_qtd
  );

  begin
    perform public.ro_aprovar_solicitacao(a.solicitacao_id);
  exception when others then
    v_repeticao_bloqueada:=position('APROVACAO_NAO_PENDENTE' in sqlerrm)>0;
  end;
  select count(*) into v_qtd
  from public.ro_email_outbox
  where chave_deduplicacao='solicitacao_aprovada:'||a.solicitacao_id||':'||a.solicitante_id;
  insert into dry_email_resultado_checks values(
    'aprovacao_repetida_nao_duplica',v_repeticao_bloqueada and v_qtd=1,
    'rpc_bloqueou='||v_repeticao_bloqueada||', quantidade='||v_qtd
  );

  perform set_config('request.jwt.claim.sub',r.aprovador_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',r.aprovador_id,'role','authenticated')::text,true);
  perform public.ro_reprovar_solicitacao(
    r.solicitacao_id,
    'Dados insuficientes para aprovação desta solicitação.'
  );

  select count(*) into v_qtd
  from public.ro_email_outbox e
  where e.chave_deduplicacao='solicitacao_reprovada:'||r.solicitacao_id||':'||r.solicitante_id
    and e.tipo_evento='solicitacao_reprovada'
    and e.destinatario_user_id=r.solicitante_id;
  insert into dry_email_resultado_checks values(
    'reprovacao_outbox_unica_solicitante',v_qtd=1,'quantidade='||v_qtd
  );

  v_repeticao_bloqueada:=false;
  begin
    perform public.ro_reprovar_solicitacao(
      r.solicitacao_id,
      'Dados insuficientes para aprovação desta solicitação.'
    );
  exception when others then
    v_repeticao_bloqueada:=position('APROVACAO_NAO_PENDENTE' in sqlerrm)>0;
  end;
  select count(*) into v_qtd
  from public.ro_email_outbox
  where chave_deduplicacao='solicitacao_reprovada:'||r.solicitacao_id||':'||r.solicitante_id;
  insert into dry_email_resultado_checks values(
    'reprovacao_repetida_nao_duplica',v_repeticao_bloqueada and v_qtd=1,
    'rpc_bloqueou='||v_repeticao_bloqueada||', quantidade='||v_qtd
  );

  perform set_config('request.jwt.claim.sub',v_ro::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ro,'role','authenticated')::text,true);
  perform public.ro_recusar_solicitacao(
    o.solicitacao_id,
    'Recusa operacional controlada exclusivamente pelo dry run.'
  );
  select count(*) into v_qtd
  from public.ro_email_outbox
  where solicitacao_id=o.solicitacao_id
    and tipo_evento in('solicitacao_aprovada','solicitacao_reprovada');
  insert into dry_email_resultado_checks values(
    'recusa_ro_nao_gera_resultado_aprovador',v_qtd=0,'quantidade='||v_qtd
  );

  -- Cria uma quarta solicitação pela RPC canônica como RH. Ela nasce
  -- dispensada e não pode materializar evento de resultado de aprovação.
  perform set_config('request.jwt.claim.sub',v_rh::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_rh,'role','authenticated')::text,true);
  v_id:=public.ro_criar_solicitacao_com_aprovador(
    jsonb_build_object(
      'viajante_nome_informado','Viajante RH Dispensado Dry Run',
      'obra_id',v_obra,
      'origem','Rio Claro - SP',
      'destino','Porto Velho - RO',
      'motivo','viagem_administrativa',
      'data_ida',((now() at time zone 'America/Sao_Paulo')::date+1)::text,
      -- O modo manual do RH percorre a mesma validação obrigatória de PIX.
      'pix_viajante',v_pix_fixture
    ),
    '[]'::jsonb
  );
  select count(*) into v_qtd
  from public.ro_email_outbox
  where solicitacao_id=v_id
    and tipo_evento in('solicitacao_aprovada','solicitacao_reprovada');
  insert into dry_email_resultado_checks values(
    'rh_dispensado_nao_gera_resultado',v_qtd=0,'quantidade='||v_qtd
  );

  select pg_get_functiondef(
    'public.ro_enfileirar_resultado_aprovacao()'::regprocedure
  ) into v_def;
  insert into dry_email_resultado_checks values
    ('viajante_manual_prioritario',
      exists(
        select 1 from public.ro_email_outbox e
        where e.solicitacao_id=a.solicitacao_id
          and e.assunto like '%Viajante Manual Dry Run'
      )
      and position('new.viajante_nome_informado' in v_def)>0,
      'fixture aprovada resolveu o nome manual antes dos cadastros'),
    ('evento_pendente_preservado',
      to_regprocedure('public.ro_enfileirar_aprovacao_pendente()') is not null,
      'trigger anterior permanece instalado');
end
$teste$;

select indicador,aprovado,detalhe,
       bool_and(aprovado) over() as todos_aprovados
from dry_email_resultado_checks
order by indicador;

rollback;
