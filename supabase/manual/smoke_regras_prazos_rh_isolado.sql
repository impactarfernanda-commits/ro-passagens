-- NÃO EXECUTAR EM PRODUÇÃO. Smoke test transacional para projeto Supabase isolado.
-- Substitua os UUIDs abaixo por usuários de teste existentes no Auth do ambiente isolado.
-- Para os testes de motivo null, "funcionario" deve apontar para fixture restrito_ro.
-- O ROLLBACK final desfaz todas as alterações do teste.
begin;

create temporary table ro_smoke_context (
  fernanda uuid not null, comum uuid not null, rh_a uuid not null, rh_b uuid not null,
  gerente uuid not null, diretor uuid not null, ro uuid not null,
  funcionario uuid not null, obra uuid not null
) on commit drop;
create temporary table ro_smoke_results(nome text primary key,id uuid) on commit drop;

insert into ro_smoke_context values (
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008',
  '00000000-0000-0000-0000-000000000009'
);

create or replace function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'SMOKE_FAIL: %',msg; end if; end $$;
create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub',uid::text,true); perform set_config('role','authenticated',true); end $$;

-- O e-mail da conta fernanda deve existir como fernanda.souza@tanksbr.com.br no Auth isolado.
select pg_temp.as_user(fernanda) from ro_smoke_context;
select pg_temp.assert_true(public.ro_can_manage_rh(),'Fernanda deve administrar RH/calendário');
select pg_temp.as_user(gerente) from ro_smoke_context;
select pg_temp.assert_true(not public.ro_can_manage_rh(),'outro gerente não administra RH/calendário');

select pg_temp.as_user(fernanda) from ro_smoke_context;
insert into public.ro_rh_responsaveis(user_id,ativo,created_by) select rh_a,true,fernanda from ro_smoke_context;
insert into public.ro_rh_responsaveis(user_id,ativo,created_by) select rh_b,true,fernanda from ro_smoke_context;
select pg_temp.as_user(rh_a) from ro_smoke_context;
select pg_temp.assert_true(public.ro_is_rh_active(),'helper RH ativo');

-- Calendário incompleto deve falhar antes de qualquer exceção gerencial.
select pg_temp.as_user(fernanda) from ro_smoke_context;
insert into public.ro_calendario_anos(ano,completo) values(extract(year from now())::integer,false)
on conflict(ano) do update set completo=false;
do $$ begin
  perform public.ro_data_minima_util(now(),5);
  raise exception 'SMOKE_FAIL: calendário incompleto deveria bloquear';
exception when others then
  if sqlerrm not like 'CALENDARIO_INCOMPLETO:%' then raise; end if;
end $$;

-- Usuário sem role/comum não pode criar motivo null por insert direto nem pela RPC.
select pg_temp.as_user(comum) from ro_smoke_context;
do $$ declare c ro_smoke_context%rowtype; begin select * into c from ro_smoke_context;
  begin
    insert into public.ro_passagem_solicitacoes(id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,primeiro_embarque_em,status)
    values(gen_random_uuid(),c.funcionario,c.obra,c.comum,'A','B',null,current_date+1,now()+interval '1 day','solicitada');
    raise exception 'SMOKE_FAIL: insert direto com motivo null deveria falhar';
  exception when others then if sqlerrm='SMOKE_FAIL: insert direto com motivo null deveria falhar' or sqlerrm not like 'MOTIVO_ADMINISTRATIVO_NAO_PERMITIDO%' then raise; end if; end;
  begin
    perform public.ro_criar_solicitacao_validada(jsonb_build_object('funcionario_id',c.funcionario,'obra_id',c.obra,'origem','A','destino','B','motivo',null,'data_ida',(current_date+1)::text,'primeiro_embarque_em',(now()+interval '1 day')::text),'[]'::jsonb);
    raise exception 'SMOKE_FAIL: RPC com motivo null deveria falhar';
  exception when others then if sqlerrm='SMOKE_FAIL: RPC com motivo null deveria falhar' or sqlerrm not like 'MOTIVO_ADMINISTRATIVO_NAO_PERMITIDO%' then raise; end if; end;
end $$;

-- RO ativo usa o fluxo administrativo preexistente, desde que o funcionário seja restrito_ro.
reset role;
insert into public.ro_responsaveis(user_id,ativo) select ro,true from ro_smoke_context on conflict(user_id) do update set ativo=true;
select pg_temp.as_user(ro) from ro_smoke_context;
insert into ro_smoke_results(nome,id)
select 'administrativo_ro',public.ro_criar_solicitacao_validada(jsonb_build_object('funcionario_id',funcionario,'obra_id',obra,'origem','A','destino','B','motivo',null,'data_ida',(current_date+1)::text,'primeiro_embarque_em',(now()+interval '1 day')::text),'[]'::jsonb) from ro_smoke_context;
select pg_temp.assert_true((select origem_solicitacao='administrativo' from public.ro_passagem_solicitacoes where id=(select id from ro_smoke_results where nome='administrativo_ro')),'RO autorizado deve preservar motivo null administrativo');

-- Complete o calendário somente no ambiente isolado para os testes seguintes.
update public.ro_calendario_anos set completo=true,validado_em=now(),validado_por=(select fernanda from ro_smoke_context)
where ano=extract(year from now())::integer;
select pg_temp.assert_true(public.ro_data_minima_util(timestamp '2026-08-03 16:30' at time zone 'America/Sao_Paulo',5)=date '2026-08-07','corte segunda 16:30');

-- Os blocos abaixo exigem funcionário/obra de teste válidos informados no contexto.
select pg_temp.as_user(comum) from ro_smoke_context;
do $$ declare c ro_smoke_context%rowtype; begin select * into c from ro_smoke_context;
  begin
    insert into public.ro_passagem_solicitacoes(id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,primeiro_embarque_em,status)
    values(gen_random_uuid(),c.funcionario,c.obra,c.comum,'A','B','admissao',current_date+30,now()+interval '30 days','solicitada');
    raise exception 'SMOKE_FAIL: insert direto de admissão comum deveria falhar';
  exception when others then if sqlerrm='SMOKE_FAIL: insert direto de admissão comum deveria falhar' or sqlerrm not like 'MOTIVO_NAO_PERMITIDO%' then raise; end if; end;
end $$;

-- Subtipo e documento obrigatório são validados pelo trigger mesmo fora da RPC.
do $$ declare c ro_smoke_context%rowtype; begin select * into c from ro_smoke_context;
  begin
    insert into public.ro_passagem_solicitacoes(id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,primeiro_embarque_em,status)
    values(gen_random_uuid(),c.funcionario,c.obra,c.comum,'A','B','desligamento',current_date+30,now()+interval '30 days','solicitada');
    raise exception 'SMOKE_FAIL: desligamento sem subtipo deveria falhar';
  exception when others then if sqlerrm='SMOKE_FAIL: desligamento sem subtipo deveria falhar' or sqlerrm not like 'SUBTIPO_DESLIGAMENTO_OBRIGATORIO%' then raise; end if; end;
end $$;

-- Criação via RPC por RH, origem histórica e visibilidade cruzada entre RHs.
select pg_temp.as_user(rh_a) from ro_smoke_context;
insert into ro_smoke_results(nome,id)
select 'rh_admissao',public.ro_criar_solicitacao_validada(jsonb_build_object(
  'funcionario_id',funcionario,'obra_id',obra,'origem','A','destino','B','motivo','admissao',
  'data_ida',(current_date+30)::text,'primeiro_embarque_em',(now()+interval '30 days')::text
),'[]'::jsonb) from ro_smoke_context;
select pg_temp.assert_true((select origem_solicitacao='rh' from public.ro_passagem_solicitacoes where id=(select id from ro_smoke_results where nome='rh_admissao')),'RPC deve gravar origem RH');
select pg_temp.as_user(rh_b) from ro_smoke_context;
select pg_temp.assert_true(exists(select 1 from public.ro_passagem_solicitacoes where id=(select id from ro_smoke_results where nome='rh_admissao')),'RH B deve ver solicitação de RH A');
select pg_temp.as_user(comum) from ro_smoke_context;
select pg_temp.assert_true(not exists(select 1 from public.ro_passagem_solicitacoes where id=(select id from ro_smoke_results where nome='rh_admissao')),'comum não deve ver solicitação de outro RH');

-- Custos continuam restritos; a inserção abaixo simula dado operacional no ambiente isolado.
reset role;
insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,created_by)
select id,'passagem','smoke',10,(select ro from ro_smoke_context) from ro_smoke_results where nome='rh_admissao';
select pg_temp.as_user(rh_b) from ro_smoke_context;
select pg_temp.assert_true(not exists(select 1 from public.ro_passagem_custos where solicitacao_id=(select id from ro_smoke_results where nome='rh_admissao')),'RH não deve ver custos');

-- RO permanece operacional, sem transformar RH em RO.
reset role;
insert into public.ro_responsaveis(user_id,ativo) select ro,true from ro_smoke_context on conflict(user_id) do update set ativo=true;
select pg_temp.as_user(ro) from ro_smoke_context;
select pg_temp.assert_true(public.ro_can_operate(),'RO ativo deve continuar operacional');
select pg_temp.as_user(rh_b) from ro_smoke_context;
select pg_temp.assert_true(not public.ro_can_operate(),'RH sem vínculo RO não deve operar');

-- Justa causa sem objeto/metadado correto deve falhar mesmo para gerente.
select pg_temp.as_user(gerente) from ro_smoke_context;
do $$ declare c ro_smoke_context%rowtype; begin select * into c from ro_smoke_context;
  begin perform public.ro_criar_solicitacao_validada(jsonb_build_object('funcionario_id',c.funcionario,'obra_id',c.obra,'origem','A','destino','B','motivo','desligamento','desligamento_subtipo','justa_causa','data_ida',current_date::text,'primeiro_embarque_em',(now()+interval '1 hour')::text),'[]'::jsonb);
    raise exception 'SMOKE_FAIL: gerente sem Termo deveria falhar';
  exception when others then if sqlerrm='SMOKE_FAIL: gerente sem Termo deveria falhar' or sqlerrm not like 'DOCUMENTO_INTERNO_OBRIGATORIO:%' then raise; end if; end;
end $$;

-- Objeto privado sintético para validar ownership, categoria e RLS documental.
reset role;
insert into ro_smoke_results values('doc_sol',gen_random_uuid());
insert into storage.objects(id,bucket_id,name,owner_id,metadata)
select gen_random_uuid(),'ro-documentos-internos',r.id::text||'/termo_justa_causa/smoke.pdf',c.rh_a,jsonb_build_object('size',100,'mimetype','application/pdf')
from ro_smoke_results r cross join ro_smoke_context c where r.nome='doc_sol';
select pg_temp.as_user(rh_a) from ro_smoke_context;
select public.ro_criar_solicitacao_validada(
  jsonb_build_object('id',r.id,'funcionario_id',c.funcionario,'obra_id',c.obra,'origem','A','destino','B','motivo','desligamento','desligamento_subtipo','justa_causa','data_ida',current_date::text,'primeiro_embarque_em',(now()+interval '1 hour')::text),
  jsonb_build_array(jsonb_build_object('categoria','termo_justa_causa','storage_path',r.id::text||'/termo_justa_causa/smoke.pdf','arquivo_nome','smoke.pdf','tamanho_bytes',100))
) from ro_smoke_results r cross join ro_smoke_context c where r.nome='doc_sol';
select pg_temp.as_user(rh_b) from ro_smoke_context;
select pg_temp.assert_true(exists(select 1 from public.ro_passagem_documentos_internos where solicitacao_id=(select id from ro_smoke_results where nome='doc_sol')),'RH deve ver documento interno');
select pg_temp.as_user(comum) from ro_smoke_context;
select pg_temp.assert_true(not exists(select 1 from public.ro_passagem_documentos_internos where solicitacao_id=(select id from ro_smoke_results where nome='doc_sol')),'comum não deve saber que documento existe');
select pg_temp.as_user(ro) from ro_smoke_context;
select pg_temp.assert_true(exists(select 1 from public.ro_passagem_documentos_internos where solicitacao_id=(select id from ro_smoke_results where nome='doc_sol')),'RO deve ver documento interno');
-- Asserções estruturais complementares das policies.
select pg_temp.assert_true(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='ro_internal_storage_select' and (roles::text like '%anon%' or qual not like '%ro_can_view_internal_document%')),'storage SELECT deve exigir helper interno');
select pg_temp.assert_true(exists(select 1 from pg_policies where schemaname='public' and tablename='ro_passagem_documentos_internos' and policyname='ro_doc_select' and qual like '%ro_can_view_internal_document%'),'metadados devem exigir helper interno');

rollback;
