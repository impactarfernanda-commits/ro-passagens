begin;

-- MIGRATION_202610080002_BEGIN
alter table public.ro_email_outbox
  drop constraint if exists ro_email_outbox_tipo_evento_check;
alter table public.ro_email_outbox
  add constraint ro_email_outbox_tipo_evento_check check (
    tipo_evento in (
      'aprovacao_pendente',
      'solicitacao_aprovada',
      'solicitacao_reprovada',
      'solicitacao_recusada_ro',
      'passagem_comprada'
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
      'solicitacao_recusada_ro',
      'passagem_comprada'
    )
  );

create or replace function public.ro_enfileirar_passagem_comprada()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_viajante text;
begin
  if old.status is not distinct from 'passagem_comprada'
     or new.status is distinct from 'passagem_comprada'
     or new.comprado_em is null
     or new.comprado_por is null
     or new.excluida_em is not null then
    return new;
  end if;

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
    solicitacao_id,tipo_evento,destinatario_user_id,assunto,chave_deduplicacao
  )
  values(
    new.id,
    'passagem_comprada',
    new.solicitante_id,
    'Passagem comprada — '||coalesce(v_viajante,'Viajante'),
    'passagem_comprada:'||new.id::text||':'||new.solicitante_id::text
  )
  on conflict(chave_deduplicacao) do nothing;

  return new;
end $$;

drop trigger if exists ro_enfileirar_passagem_comprada
on public.ro_passagem_solicitacoes;
create trigger ro_enfileirar_passagem_comprada
after update of status,comprado_em,comprado_por
on public.ro_passagem_solicitacoes
for each row
execute function public.ro_enfileirar_passagem_comprada();

revoke all on function public.ro_enfileirar_passagem_comprada()
from public,anon,authenticated;
-- MIGRATION_202610080002_END

create temporary table dry_email_compra_checks(indicador text primary key,aprovado boolean not null,detalhe text not null);

do $teste$
declare
  v_rh uuid;
  v_ro uuid;
  v_denise uuid;
  v_solicitante uuid;
  v_aprovador uuid;
  v_funcionario uuid;
  v_obra uuid;
  v_id uuid;
  v_id_exclusao uuid;
  v_id_recusa uuid;
  v_id_reprovacao uuid;
  v_custo uuid;
  v_qtd bigint;
  v_operacao_pos_compra uuid:=gen_random_uuid();
  v_path_pos_compra text;
  v_path_complementar text;
  v_pix_fixture constant text:='dry-run-pix-nao-real@example.invalid';
begin
  select user_id into v_rh from public.ro_rh_responsaveis where ativo order by user_id limit 1;
  select user_id into v_ro from public.ro_responsaveis where ativo order by user_id limit 1;
  select u.id into v_denise from auth.users u
  where u.deleted_at is null and public.ro_is_denise(u.id)
  order by u.id limit 1;
  select u.id into v_solicitante from auth.users u
  where u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
    and not public.ro_approval_exempt(u.id)
  order by u.id limit 1;
  select u.id into v_aprovador from auth.users u
  where u.id is distinct from v_solicitante
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
    and public.ro_is_approval_candidate(u.id)
  order by u.id limit 1;
  select f.id into v_funcionario from public.funcionarios f
  where f.ativo and f.deleted_at is null and f.visivel_passagens
    and f.escopo_passagens='comum'
  order by f.id limit 1;
  select id into v_obra from public.obras where visivel_passagens and escopo_passagens='comum' order by id limit 1;
  if v_rh is null or v_ro is null or v_denise is null or v_solicitante is null
     or v_aprovador is null or v_funcionario is null or v_obra is null then
    raise exception 'PREFLIGHT_ESTRUTURAL: RH, RO, Denise, solicitante, aprovador, funcionário ou centro de custo elegível ausente';
  end if;

  perform set_config('request.jwt.claim.sub',v_rh::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_rh,'role','authenticated')::text,true);
  v_id:=public.ro_criar_solicitacao_com_aprovador(
    jsonb_build_object(
      'viajante_nome_informado','Viajante Manual Compra Dry Run',
      'obra_id',v_obra,'origem','Origem Sintética - SP','destino','Destino Sintético - RO',
      'motivo','viagem_administrativa',
      'data_ida',((now() at time zone 'America/Sao_Paulo')::date+30)::text,
      'pix_viajante',v_pix_fixture
    ),
    '[]'::jsonb
  );

  insert into dry_email_compra_checks
  select 'antes_compra_sem_evento',count(*)=0,'quantidade='||count(*)
  from public.ro_email_outbox where solicitacao_id=v_id and tipo_evento='passagem_comprada';

  perform set_config('request.jwt.claim.sub',v_ro::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ro,'role','authenticated')::text,true);
  -- Reproduz o botão "Assumir solicitação": a compra canônica só pode partir
  -- de em_andamento e a RPC registra responsável RO, instante e histórico.
  perform public.ro_alterar_status(v_id,'em_andamento');
  insert into dry_email_compra_checks
  select 'fixture_entra_em_andamento_pelo_fluxo_canonico',
    status='em_andamento' and responsavel_ro_id=v_ro and assumida_em is not null,
    'status='||status||', responsavel_ro='||coalesce(responsavel_ro_id::text,'ausente')
  from public.ro_passagem_solicitacoes where id=v_id;

  perform public.ro_registrar_compra_v2(
    v_id,'aereo','Companhia Sintética','LOC-DRY-RUN',
    'Origem Sintética - SP','Destino Sintético - RO',
    (((now() at time zone 'America/Sao_Paulo')::date+30)::timestamp+time '12:00') at time zone 'America/Sao_Paulo',
    (((now() at time zone 'America/Sao_Paulo')::date+30)::timestamp+time '15:00') at time zone 'America/Sao_Paulo',
    'Observação sintética do dry run',
    jsonb_build_array(
      jsonb_build_object(
        'tipo','passagem','descricao','Trecho sintético de ida','valor','100.00',
        'centro_custo_id',v_obra,'compra_chave','dry-run-compra-ida'
      ),
      jsonb_build_object(
        'tipo','passagem','descricao','Trecho sintético adicional','valor','80.00',
        'centro_custo_id',v_obra,'compra_chave','dry-run-compra-trecho-adicional'
      ),
      jsonb_build_object(
        'tipo','outros','descricao','Taxa operacional sintética','valor','20.00',
        'centro_custo_id',v_obra
      )
    ),
    false,null,
    jsonb_build_array(
      jsonb_build_object(
        'origem','Origem Sintética - SP','destino','Destino Sintético - RO',
        'partida_em',((now() at time zone 'America/Sao_Paulo')::date+30)::text
      ),
      jsonb_build_object(
        'origem','Origem Sintética - SP','destino','Destino Sintético - RO',
        'partida_em',((now() at time zone 'America/Sao_Paulo')::date+30)::text
      )
    ),
    false,null
  );

  select count(*) into v_qtd from public.ro_email_outbox
  where chave_deduplicacao='passagem_comprada:'||v_id||':'||v_rh
    and tipo_evento='passagem_comprada' and destinatario_user_id=v_rh;
  insert into dry_email_compra_checks values('compra_real_cria_uma_outbox_solicitante',v_qtd=1,'quantidade='||v_qtd);
  insert into dry_email_compra_checks
  select 'multiplos_trechos_custos_um_evento',
    (select count(*) from public.ro_passagem_custos where solicitacao_id=v_id and tipo='passagem')=2
      and (select count(*) from public.ro_email_outbox where solicitacao_id=v_id and tipo_evento='passagem_comprada')=1,
    'custos_passagem='||(select count(*) from public.ro_passagem_custos where solicitacao_id=v_id and tipo='passagem')
      ||', eventos='||(select count(*) from public.ro_email_outbox where solicitacao_id=v_id and tipo_evento='passagem_comprada');
  insert into dry_email_compra_checks
  select 'viajante_manual_no_assunto',count(*)=1,'quantidade='||count(*)
  from public.ro_email_outbox where solicitacao_id=v_id and tipo_evento='passagem_comprada'
    and assunto like '%Viajante Manual Compra Dry Run';

  -- Edição posterior permitida pelo produto: a RPC operacional edita custos
  -- não-passagem. O valor da passagem permanece protegido pela RPC da Denise.
  select id into v_custo from public.ro_passagem_custos
  where solicitacao_id=v_id and tipo='outros' order by created_at,id limit 1;
  perform public.ro_atualizar_custo_operacional(v_id,v_custo,21.00);
  select count(*) into v_qtd from public.ro_email_outbox where solicitacao_id=v_id and tipo_evento='passagem_comprada';
  insert into dry_email_compra_checks
  select 'edicao_custo_operacional_nao_duplica',
    c.tipo='outros' and c.valor=21.00 and v_qtd=1,
    'tipo='||c.tipo||', valor='||c.valor||', eventos='||v_qtd
  from public.ro_passagem_custos c where c.id=v_custo;

  -- O upload é externo ao banco; o objeto abaixo apenas representa, dentro da
  -- transação revertida, um PDF sintético já enviado. O vínculo é feito pela RPC.
  v_path_pos_compra:=v_id::text||'/pos-compra/'||v_operacao_pos_compra::text||'/apoio.pdf';
  insert into storage.objects(id,bucket_id,name,owner_id,metadata)
  values(
    gen_random_uuid(),'ro-passagem-anexos',v_path_pos_compra,v_ro,
    jsonb_build_object('size',100,'mimetype','application/pdf')
  );
  perform public.ro_registrar_documentos_pos_compra(
    v_id,v_operacao_pos_compra,
    jsonb_build_array(jsonb_build_object(
      'client_ref','apoio-pos-compra','nome_arquivo','apoio-sintetico.pdf',
      'storage_path',v_path_pos_compra,'mime_type','application/pdf','tamanho_bytes',100,
      'conteudo_sha256',repeat('a',64)
    )),
    '[]'::jsonb
  );
  select count(*) into v_qtd from public.ro_email_outbox where solicitacao_id=v_id and tipo_evento='passagem_comprada';
  insert into dry_email_compra_checks values('pos_compra_canonico_nao_duplica',v_qtd=1,'quantidade='||v_qtd);

  -- Replay idempotente da operação pós-compra também não recria a notificação.
  perform public.ro_registrar_documentos_pos_compra(
    v_id,v_operacao_pos_compra,
    jsonb_build_array(jsonb_build_object(
      'client_ref','apoio-pos-compra','nome_arquivo','apoio-sintetico.pdf',
      'storage_path',v_path_pos_compra,'mime_type','application/pdf','tamanho_bytes',100,
      'conteudo_sha256',repeat('a',64)
    )),
    '[]'::jsonb
  );
  select count(*) into v_qtd from public.ro_email_outbox where solicitacao_id=v_id and tipo_evento='passagem_comprada';
  insert into dry_email_compra_checks values('reprocessamento_nao_duplica',v_qtd=1,'quantidade='||v_qtd);

  -- Passagem complementar: mantém a fixture comprada e usa a RPC exclusiva da
  -- Denise. O objeto sintético simula somente o upload, sem HTTP.
  perform set_config('request.jwt.claim.sub',v_denise::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_denise,'role','authenticated')::text,true);
  v_path_complementar:=v_id::text||'/complementares/'||gen_random_uuid()::text||'.pdf';
  insert into storage.objects(id,bucket_id,name,owner_id,metadata)
  values(
    gen_random_uuid(),'ro-passagem-anexos',v_path_complementar,v_denise,
    jsonb_build_object('size',100,'mimetype','application/pdf')
  );
  perform public.ro_registrar_passagem_complementar(
    v_id,
    jsonb_build_array(jsonb_build_object(
      'nome_arquivo','complementar-sintetica.pdf','storage_path',v_path_complementar,
      'mime_type','application/pdf','tamanho_bytes',100,'centro_custo_id',v_obra
    )),
    false,'Complemento sintético controlado pelo dry run.','[]'::jsonb
  );
  select count(*) into v_qtd from public.ro_email_outbox where solicitacao_id=v_id and tipo_evento='passagem_comprada';
  insert into dry_email_compra_checks values('complementar_canonica_nao_duplica',v_qtd=1,'quantidade='||v_qtd);

  -- Fixture independente de exclusão: nasce solicitada e dispensada de
  -- aprovação pelo fluxo RH, e é excluída pela RPC usada pelo produto.
  perform set_config('request.jwt.claim.sub',v_rh::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_rh,'role','authenticated')::text,true);
  v_id_exclusao:=public.ro_criar_solicitacao_com_aprovador(
    jsonb_build_object(
      'viajante_nome_informado','Viajante Exclusão Dry Run','obra_id',v_obra,
      'origem','Origem Sintética - SP','destino','Destino Sintético - RO',
      'motivo','viagem_administrativa',
      'data_ida',((now() at time zone 'America/Sao_Paulo')::date+31)::text,
      'pix_viajante',v_pix_fixture
    ),'[]'::jsonb
  );
  perform set_config('request.jwt.claim.sub',v_ro::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ro,'role','authenticated')::text,true);
  perform public.ro_excluir_solicitacao(v_id_exclusao,'Exclusão sintética controlada pelo dry run.');
  insert into dry_email_compra_checks
  select 'exclusao_canonica_nao_gera_compra',
    s.excluida_em is not null and s.excluida_por=v_ro
      and not exists(select 1 from public.ro_email_outbox e where e.solicitacao_id=s.id and e.tipo_evento='passagem_comprada'),
    'status='||s.status||', excluida='||(s.excluida_em is not null)
  from public.ro_passagem_solicitacoes s where s.id=v_id_exclusao;

  -- Fixture independente de recusa operacional, ainda em estado elegível.
  perform set_config('request.jwt.claim.sub',v_rh::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_rh,'role','authenticated')::text,true);
  v_id_recusa:=public.ro_criar_solicitacao_com_aprovador(
    jsonb_build_object(
      'viajante_nome_informado','Viajante Recusa Dry Run','obra_id',v_obra,
      'origem','Origem Sintética - SP','destino','Destino Sintético - RO',
      'motivo','viagem_administrativa',
      'data_ida',((now() at time zone 'America/Sao_Paulo')::date+32)::text,
      'pix_viajante',v_pix_fixture
    ),'[]'::jsonb
  );
  perform set_config('request.jwt.claim.sub',v_ro::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ro,'role','authenticated')::text,true);
  perform public.ro_recusar_solicitacao(v_id_recusa,'Recusa operacional sintética controlada pelo dry run.');
  insert into dry_email_compra_checks
  select 'recusa_ro_independente_nao_gera_compra',count(*)=0,'quantidade='||count(*)
  from public.ro_email_outbox where solicitacao_id=v_id_recusa and tipo_evento='passagem_comprada';

  -- Fixture independente de reprovação: solicitante sujeito à aprovação e
  -- decisão pela RPC do aprovador responsável.
  perform set_config('request.jwt.claim.sub',v_solicitante::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_solicitante,'role','authenticated')::text,true);
  v_id_reprovacao:=public.ro_criar_solicitacao_com_aprovador(
    jsonb_build_object(
      'funcionario_id',v_funcionario,'obra_id',v_obra,
      'origem','Origem Sintética - SP','destino','Destino Sintético - RO',
      'motivo','transferencia_obra',
      'data_ida',((now() at time zone 'America/Sao_Paulo')::date+60)::text,
      'pix_viajante',v_pix_fixture,'aprovador_id',v_aprovador
    ),'[]'::jsonb
  );
  perform set_config('request.jwt.claim.sub',v_aprovador::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_aprovador,'role','authenticated')::text,true);
  perform public.ro_reprovar_solicitacao(v_id_reprovacao,'Dados sintéticos insuficientes para aprovar esta solicitação.');
  insert into dry_email_compra_checks
  select 'reprovacao_independente_nao_gera_compra',count(*)=0,'quantidade='||count(*)
  from public.ro_email_outbox where solicitacao_id=v_id_reprovacao and tipo_evento='passagem_comprada';

  insert into dry_email_compra_checks values
    ('fixture_comprada_permanece_ativa',
      (select excluida_em is null and status='passagem_comprada' from public.ro_passagem_solicitacoes where id=v_id),
      'a fixture comprada não participa do cenário de exclusão'),
    ('eventos_anteriores_preservados',
      to_regprocedure('public.ro_enfileirar_aprovacao_pendente()') is not null
      and to_regprocedure('public.ro_enfileirar_resultado_aprovacao()') is not null
      and to_regprocedure('public.ro_recusar_solicitacao(uuid,text)') is not null,
      'aprovação e recusa RO permanecem instaladas');
end
$teste$;

select indicador,aprovado,detalhe,bool_and(aprovado) over() todos_aprovados
from dry_email_compra_checks order by indicador;

-- O cron/worker em outra sessão não pode enxergar fixtures não confirmadas.
rollback;
