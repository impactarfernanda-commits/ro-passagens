begin;

-- DDL_PARITY_BEGIN
-- UPDATE direto fica fechado: inserções/remoções dos fluxos existentes continuam
-- protegidas por ro_can_operate(), e edições passam exclusivamente pela RPC auditada.
drop policy if exists ro_child_cost_write on public.ro_passagem_custos;
drop policy if exists ro_child_cost_insert on public.ro_passagem_custos;
create policy ro_child_cost_insert on public.ro_passagem_custos
for insert to authenticated with check(public.ro_can_operate());
drop policy if exists ro_child_cost_delete on public.ro_passagem_custos;
create policy ro_child_cost_delete on public.ro_passagem_custos
for delete to authenticated using(public.ro_can_operate());

create or replace function public.ro_atualizar_custo_operacional(
  p_solicitacao_id uuid,
  p_custo_id uuid,
  p_novo_valor numeric
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_sol public.ro_passagem_solicitacoes%rowtype;
  v_custo public.ro_passagem_custos%rowtype;
  v_total numeric(12,2);
  v_tipo_label text;
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA'; end if;
  if not coalesce(public.ro_can_operate(),false) then
    raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_EDITAR_CUSTOS';
  end if;
  if p_novo_valor is null or p_novo_valor::text in ('NaN','Infinity','-Infinity') or p_novo_valor<=0 then
    raise exception 'VALOR_CUSTO_DEVE_SER_MAIOR_QUE_ZERO';
  end if;

  select * into v_sol from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id for update;
  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA'; end if;
  if v_sol.status in ('cancelada','recusada') then
    raise exception 'SOLICITACAO_NAO_PERMITE_EDICAO_DE_CUSTO';
  end if;

  select * into v_custo from public.ro_passagem_custos
  where id=p_custo_id and solicitacao_id=p_solicitacao_id for update;
  if not found then raise exception 'CUSTO_NAO_PERTENCE_A_SOLICITACAO'; end if;
  if v_custo.tipo not in ('hospedagem','uber','refeicao','outros') then
    raise exception 'TIPO_CUSTO_NAO_EDITAVEL';
  end if;

  update public.ro_passagem_custos
  set valor=p_novo_valor
  where id=v_custo.id;

  v_tipo_label:=case v_custo.tipo when 'hospedagem' then 'Hospedagem' when 'uber' then 'Uber'
    when 'refeicao' then 'Refeição' else 'Outros' end;
  insert into public.ro_passagem_historico(
    solicitacao_id,status_anterior,status_novo,descricao,criado_por
  ) values(
    p_solicitacao_id,v_sol.status,v_sol.status,
    format('%s atualizado de R$ %s para R$ %s.',v_tipo_label,
      replace(to_char(v_custo.valor,'FM999999990D00'),'.',','),
      replace(to_char(p_novo_valor,'FM999999990D00'),'.',',')),auth.uid()
  );

  select coalesce(sum(valor),0) into v_total from public.ro_passagem_custos
  where solicitacao_id=p_solicitacao_id;
  return jsonb_build_object('custo_id',v_custo.id,'tipo',v_custo.tipo,
    'valor_anterior',v_custo.valor,'valor_novo',p_novo_valor,'total',v_total);
end $$;

revoke all on function public.ro_atualizar_custo_operacional(uuid,uuid,numeric) from public,anon;
grant execute on function public.ro_atualizar_custo_operacional(uuid,uuid,numeric) to authenticated;
-- DDL_PARITY_END

create temporary table ro_dry_edicao_custos_ids(
  chave text primary key,
  id uuid not null
) on commit drop;

-- Falha cedo se o contrato condicional usado pela fixture divergir do schema atual.
do $$
declare v_folga_ck text;
begin
  select pg_get_constraintdef(c.oid) into v_folga_ck
  from pg_constraint c
  where c.conrelid='public.ro_passagem_solicitacoes'::regclass
    and c.conname='ro_folga_campos_coerentes_ck';
  if v_folga_ck is null
    or v_folga_ck not like '%motivo = ''folga_campo''%'
    or v_folga_ck not like '%motivo IS DISTINCT FROM ''folga_campo''%'
    or v_folga_ck not like '%folga_data_prevista_ciclo IS NULL%'
    or v_folga_ck not like '%folga_ciclo_anterior_id IS NULL%'
    or v_folga_ck not like '%NOT folga_antecipada%'
    or v_folga_ck not like '%folga_antecipacao_justificativa IS NULL%'
    or v_folga_ck not like '%folga_antecipacao_status IS NULL%'
    or v_folga_ck not like '%folga_antecipacao_analisada_por IS NULL%'
    or v_folga_ck not like '%folga_antecipacao_analisada_em IS NULL%' then
    raise exception 'SCHEMA_FOLGA_DIVERGIU_DA_FIXTURE: %',v_folga_ck;
  end if;
end $$;

-- Fixtures sintéticas baseadas somente nas FKs de uma solicitação real. Os triggers
-- são suspensos apenas durante a montagem e reativados antes de testar a RPC.
do $$
declare
  v_actor uuid;
  v_funcionario uuid;
  v_colaborador uuid;
  v_obra uuid;
  v_a uuid:=gen_random_uuid();
  v_b uuid:=gen_random_uuid();
  v_cancelada uuid:=gen_random_uuid();
  v_recusada uuid:=gen_random_uuid();
begin
  select r.user_id into v_actor from public.ro_responsaveis r where r.ativo order by r.created_at limit 1;
  if v_actor is null then raise exception 'DRY_RUN_REQUER_RESPONSAVEL_RO_ATIVO'; end if;
  -- Dados reais são usados somente como chaves estrangeiras válidas. Toda a
  -- semântica das solicitações abaixo é construída explicitamente.
  select s.funcionario_id,s.colaborador_id
  into v_funcionario,v_colaborador
  from public.ro_passagem_solicitacoes s
  where s.funcionario_id is not null or s.colaborador_id is not null
  order by s.created_at limit 1;
  if not found then raise exception 'DRY_RUN_REQUER_PESSOA_VALIDA'; end if;
  select o.id into v_obra from public.obras o
  where o.visivel_passagens and o.escopo_passagens in ('comum','restrito_ro')
  order by o.id limit 1;
  if not found then raise exception 'DRY_RUN_REQUER_CENTRO_CUSTO_FINANCEIRO_VALIDO'; end if;

  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor::text,'role','authenticated')::text,true);
  execute 'alter table public.ro_passagem_solicitacoes disable trigger user';
  execute 'alter table public.ro_passagem_custos disable trigger user';
  begin
    insert into public.ro_passagem_solicitacoes(
      id,funcionario_id,colaborador_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,data_retorno,
      status,responsavel_ro_id,origem_solicitacao,retorno_indefinido,destino_retorno,centro_custo_retorno_id,
      desligamento_subtipo,prazo_regra_codigo,folga_data_prevista_ciclo,folga_ciclo_anterior_id,
      folga_antecipada,folga_antecipacao_justificativa,folga_antecipacao_status,
      folga_antecipacao_analisada_por,folga_antecipacao_analisada_em,recusada_em,recusada_por,motivo_recusa,
      solicitacao_origem_id,necessita_hospedagem,hospedagem_checkin,hospedagem_checkout,pix_viajante,
      destino_residencial_origem,destino_residencial_justificativa,created_at,updated_at
    ) values
      (v_a,v_funcionario,v_colaborador,v_obra,v_actor,'Origem dry-run','Destino dry-run','viagem_administrativa',current_date+30,null,
       'em_andamento',v_actor,'administrativo',false,null,null,null,null,null,null,false,null,null,null,null,null,null,null,null,
       false,null,null,null,null,null,now(),now()),
      (v_b,v_funcionario,v_colaborador,v_obra,v_actor,'Origem dry-run','Destino dry-run','viagem_administrativa',current_date+30,null,
       'em_andamento',v_actor,'administrativo',false,null,null,null,null,null,null,false,null,null,null,null,null,null,null,null,
       false,null,null,null,null,null,now(),now()),
      (v_cancelada,v_funcionario,v_colaborador,v_obra,v_actor,'Origem dry-run','Destino dry-run','viagem_administrativa',current_date+30,null,
       'cancelada',v_actor,'administrativo',false,null,null,null,null,null,null,false,null,null,null,null,null,null,null,null,
       false,null,null,null,null,null,now(),now()),
      (v_recusada,v_funcionario,v_colaborador,v_obra,v_actor,'Origem dry-run','Destino dry-run','viagem_administrativa',current_date+30,null,
       'recusada',v_actor,'administrativo',false,null,null,null,null,null,null,false,null,null,null,null,now(),v_actor,
       'Recusa sintética do dry-run',null,false,null,null,null,null,null,now(),now());

    insert into public.ro_passagem_custos(id,solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by) values
      (gen_random_uuid(),v_a,'uber','Uber dry-run',80,v_obra,v_actor),
      (gen_random_uuid(),v_a,'hospedagem','Hospedagem dry-run',200,v_obra,v_actor),
      (gen_random_uuid(),v_a,'refeicao','Refeição dry-run',50,v_obra,v_actor),
      (gen_random_uuid(),v_a,'outros','Outros dry-run',25,v_obra,v_actor),
      (gen_random_uuid(),v_a,'passagem','Passagem dry-run',300,v_obra,v_actor),
      (gen_random_uuid(),v_b,'uber','Uber solicitação B',70,v_obra,v_actor),
      (gen_random_uuid(),v_cancelada,'uber','Uber cancelada',80,v_obra,v_actor),
      (gen_random_uuid(),v_recusada,'uber','Uber recusada',80,v_obra,v_actor);
  exception when others then
    execute 'alter table public.ro_passagem_custos enable trigger user';
    execute 'alter table public.ro_passagem_solicitacoes enable trigger user';
    raise;
  end;
  execute 'alter table public.ro_passagem_custos enable trigger user';
  execute 'alter table public.ro_passagem_solicitacoes enable trigger user';

  insert into ro_dry_edicao_custos_ids values
    ('actor',v_actor),('a',v_a),('b',v_b),('cancelada',v_cancelada),('recusada',v_recusada);
end $$;

do $$
declare
  v_actor uuid:=(select id from ro_dry_edicao_custos_ids where chave='actor');
  v_a uuid:=(select id from ro_dry_edicao_custos_ids where chave='a');
  v_b uuid:=(select id from ro_dry_edicao_custos_ids where chave='b');
  v_cancelada uuid:=(select id from ro_dry_edicao_custos_ids where chave='cancelada');
  v_recusada uuid:=(select id from ro_dry_edicao_custos_ids where chave='recusada');
  v_custo uuid;
  v_result jsonb;
  v_hist integer;
  v_def text;
  v_public boolean;
  v_anon boolean;
  v_authenticated boolean;
  v_failed boolean;
begin
  -- Todos os lançamentos positivos usam a mesma obra financeira válida da solicitação.
  if exists(select 1 from public.ro_passagem_custos c
    join public.ro_passagem_solicitacoes s on s.id=c.solicitacao_id
    where c.solicitacao_id in (v_a,v_b,v_cancelada,v_recusada)
      and c.valor>0 and (c.centro_custo_id is null or c.centro_custo_id is distinct from s.obra_id)) then
    raise exception 'FIXTURE_FINANCEIRA_SEM_CENTRO_CUSTO_VALIDO';
  end if;
  -- O trigger legado deve continuar rejeitando qualquer custo positivo sem centro financeiro.
  v_failed:=false;
  begin
    insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by)
    values(v_a,'outros','Custo inválido para validar trigger',1,null,v_actor);
  exception when others then
    v_failed:=sqlerrm like '%Centro de custo financeiro é obrigatório para custos com valor%';
  end;
  if not v_failed then raise exception 'TRIGGER_CENTRO_CUSTO_NAO_BLOQUEOU_CUSTO_POSITIVO'; end if;

  -- 80 -> 110 substitui, não soma, mantém uma linha e audita ator/solicitação/valores.
  select id into v_custo from public.ro_passagem_custos where solicitacao_id=v_a and tipo='uber';
  v_result:=public.ro_atualizar_custo_operacional(v_a,v_custo,110);
  if (select valor from public.ro_passagem_custos where id=v_custo)<>110
    or (select count(*) from public.ro_passagem_custos where solicitacao_id=v_a and tipo='uber')<>1
    or (v_result->>'valor_anterior')::numeric<>80 or (v_result->>'valor_novo')::numeric<>110 then
    raise exception 'UBER_80_110_NAO_SUBSTITUIU_CORRETAMENTE';
  end if;
  if not exists(select 1 from public.ro_passagem_historico where solicitacao_id=v_a
    and criado_por=v_actor and descricao='Uber atualizado de R$ 80,00 para R$ 110,00.') then
    raise exception 'HISTORICO_UBER_80_110_INVALIDO';
  end if;

  -- O comportamento vigente registra também a tentativa idempotente 110 -> 110.
  select count(*) into v_hist from public.ro_passagem_historico where solicitacao_id=v_a;
  perform public.ro_atualizar_custo_operacional(v_a,v_custo,110);
  if (select valor from public.ro_passagem_custos where id=v_custo)<>110
    or (select count(*) from public.ro_passagem_custos where solicitacao_id=v_a and tipo='uber')<>1
    or (select count(*) from public.ro_passagem_historico where solicitacao_id=v_a)<>v_hist+1
    or not exists(select 1 from public.ro_passagem_historico where solicitacao_id=v_a
      and criado_por=v_actor and descricao='Uber atualizado de R$ 110,00 para R$ 110,00.') then
    raise exception 'IDEMPOTENCIA_110_110_INVALIDA';
  end if;

  -- Todos os custos operacionais canônicos são substituíveis.
  perform public.ro_atualizar_custo_operacional(v_a,(select id from public.ro_passagem_custos where solicitacao_id=v_a and tipo='hospedagem'),210);
  perform public.ro_atualizar_custo_operacional(v_a,(select id from public.ro_passagem_custos where solicitacao_id=v_a and tipo='refeicao'),55);
  perform public.ro_atualizar_custo_operacional(v_a,(select id from public.ro_passagem_custos where solicitacao_id=v_a and tipo='outros'),30);
  if exists(select 1 from public.ro_passagem_custos where solicitacao_id=v_a and
    ((tipo='hospedagem' and valor<>210) or (tipo='refeicao' and valor<>55) or (tipo='outros' and valor<>30))) then
    raise exception 'TIPOS_OPERACIONAIS_NAO_EDITADOS';
  end if;

  -- Passagem permanece no fluxo de bilhete/PDF.
  v_failed:=false;
  begin perform public.ro_atualizar_custo_operacional(v_a,(select id from public.ro_passagem_custos where solicitacao_id=v_a and tipo='passagem'),999);
  exception when others then v_failed:=sqlerrm like '%TIPO_CUSTO_NAO_EDITAVEL%'; end;
  if not v_failed or (select valor from public.ro_passagem_custos where solicitacao_id=v_a and tipo='passagem')<>300 then
    raise exception 'PASSAGEM_NAO_PERMANECEU_FORA_DA_EDICAO_GENERICA';
  end if;

  -- Rejeições de valores inválidos cobertos no banco.
  foreach v_result in array array['0'::jsonb,'-1'::jsonb,'null'::jsonb,'"NaN"'::jsonb] loop
    v_failed:=false;
    begin perform public.ro_atualizar_custo_operacional(v_a,v_custo,
      case when jsonb_typeof(v_result)='null' then null else trim(both '"' from v_result::text)::numeric end);
    exception when others then v_failed:=sqlerrm like '%VALOR_CUSTO_DEVE_SER_MAIOR_QUE_ZERO%'; end;
    if not v_failed then raise exception 'VALOR_INVALIDO_NAO_REJEITADO: %',v_result; end if;
  end loop;

  -- Custo da solicitação A não pode ser alterado informando solicitação B.
  v_failed:=false;
  begin perform public.ro_atualizar_custo_operacional(v_b,v_custo,125);
  exception when others then v_failed:=sqlerrm like '%CUSTO_NAO_PERTENCE_A_SOLICITACAO%'; end;
  if not v_failed or (select valor from public.ro_passagem_custos where id=v_custo)<>110 then
    raise exception 'PERTENCIMENTO_NAO_PROTEGIDO';
  end if;

  foreach v_b in array array[v_cancelada,v_recusada] loop
    v_failed:=false;
    begin perform public.ro_atualizar_custo_operacional(v_b,
      (select id from public.ro_passagem_custos where solicitacao_id=v_b and tipo='uber'),110);
    exception when others then v_failed:=sqlerrm like '%SOLICITACAO_NAO_PERMITE_EDICAO_DE_CUSTO%'; end;
    if not v_failed then raise exception 'STATUS_BLOQUEADO_ACEITOU_EDICAO: %',v_b; end if;
  end loop;

  -- Definição, lock e ACL: PUBLIC é grantee 0, nunca um nome de role.
  select pg_get_functiondef(p.oid),
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE'),
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=(select oid from pg_roles where rolname='anon') and x.privilege_type='EXECUTE'),
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=(select oid from pg_roles where rolname='authenticated') and x.privilege_type='EXECUTE')
  into v_def,v_public,v_anon,v_authenticated
  from pg_proc p where p.oid='public.ro_atualizar_custo_operacional(uuid,uuid,numeric)'::regprocedure;
  if v_public or v_anon or not v_authenticated then raise exception 'ACL_RPC_INVALIDA'; end if;
  if v_def not like '%SECURITY DEFINER%' or v_def not like '%SET search_path TO ''public'', ''pg_temp''%'
    or v_def not like '%ro_can_operate()%' or v_def !~* 'solicitacao_id\s*=\s*p_solicitacao_id\s+FOR UPDATE'
    or v_def !~* 'id\s*=\s*p_custo_id\s+AND\s+solicitacao_id\s*=\s*p_solicitacao_id\s+FOR UPDATE' then
    raise exception 'CONTRATO_OU_LOCK_DA_RPC_INVALIDO';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='ro_passagem_custos'
    and cmd in ('UPDATE','ALL')) then raise exception 'UPDATE_DIRETO_AINDA_POSSUI_POLICY'; end if;
end $$;

-- Prova com role authenticated: sem policy UPDATE/ALL, a tentativa direta não altera linha.
do $$
declare v_a uuid:=(select id from ro_dry_edicao_custos_ids where chave='a');v_custo uuid;v_rows bigint;
begin
  select id into v_custo from public.ro_passagem_custos where solicitacao_id=v_a and tipo='uber';
  execute 'set local role authenticated';
  update public.ro_passagem_custos set valor=190 where id=v_custo;
  get diagnostics v_rows=row_count;
  execute 'reset role';
  if v_rows<>0 or (select valor from public.ro_passagem_custos where id=v_custo)<>110 then
    raise exception 'UPDATE_DIRETO_AUTHENTICATED_NAO_FOI_BLOQUEADO';
  end if;
end $$;

-- Regressão estrutural: hospedagem continua com upsert definer e compra/passagens
-- continuam usando INSERT/DELETE, sem depender da policy UPDATE removida.
do $$
declare v_hosp text;v_compra text;
begin
  select pg_get_functiondef('public.ro_registrar_hospedagem(uuid,numeric)'::regprocedure) into v_hosp;
  select pg_get_functiondef('public.ro_registrar_compra(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time)'::regprocedure) into v_compra;
  if v_hosp not like '%SECURITY DEFINER%' or v_hosp not like '%on conflict(solicitacao_id) where tipo=''hospedagem'' do update%'
    or v_hosp not like '%ro_passagem_historico%' then raise exception 'REGRESSAO_HOSPEDAGEM'; end if;
  if v_compra not like '%SECURITY DEFINER%' or v_compra not like '%ro_registrar_compra_pre_operacional%'
    or v_compra not like '%p_horario_anterior_confirmado%' or v_compra not like '%p_partida_horario_local%'
    then raise exception 'REGRESSAO_COMPRA_PASSAGEM'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='ro_passagem_custos_hospedagem_unico')
    then raise exception 'UNICIDADE_HOSPEDAGEM_AUSENTE'; end if;
end $$;

rollback;
