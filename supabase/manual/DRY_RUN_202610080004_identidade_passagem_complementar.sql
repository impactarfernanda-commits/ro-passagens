begin;
-- MIGRATION_202610080004_BEGIN

create table public.ro_passagem_complementar_operacoes(
  id uuid primary key,
  solicitacao_id uuid not null references public.ro_passagem_solicitacoes(id) on delete no action,
  payload_fingerprint text not null check(payload_fingerprint~'^[0-9a-f]{64}$'),
  status text not null check(status in('processando','concluida')),
  resultado jsonb,
  criado_por uuid not null references auth.users(id) on delete no action,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz
);
create index ro_passagem_complementar_operacoes_solicitacao_idx
  on public.ro_passagem_complementar_operacoes(solicitacao_id,criado_em desc);

create table public.ro_passagem_complementares(
  id uuid primary key,
  solicitacao_id uuid not null references public.ro_passagem_solicitacoes(id) on delete no action,
  operacao_id uuid not null references public.ro_passagem_complementar_operacoes(id) on delete no action,
  payload_fingerprint text not null check(payload_fingerprint~'^[0-9a-f]{64}$'),
  criado_por uuid not null references auth.users(id) on delete no action,
  criado_em timestamptz not null default now(),
  unique(operacao_id,id)
);
create index ro_passagem_complementares_solicitacao_idx
  on public.ro_passagem_complementares(solicitacao_id,criado_em desc);
alter table public.ro_passagem_complementar_operacoes enable row level security;
alter table public.ro_passagem_complementares enable row level security;

alter table public.ro_passagem_anexos add column complemento_id uuid;
alter table public.ro_passagem_anexos add constraint ro_passagem_anexos_complemento_id_fkey
  foreign key(complemento_id) references public.ro_passagem_complementares(id) on delete no action;
create index ro_passagem_anexos_complemento_idx on public.ro_passagem_anexos(complemento_id);

alter table public.ro_passagem_custos add column complemento_id uuid;
alter table public.ro_passagem_custos add constraint ro_passagem_custos_complemento_id_fkey
  foreign key(complemento_id) references public.ro_passagem_complementares(id) on delete no action;
create index ro_passagem_custos_complemento_idx on public.ro_passagem_custos(complemento_id);

alter table public.ro_passagem_historico add column complemento_id uuid;
alter table public.ro_passagem_historico add constraint ro_passagem_historico_complemento_id_fkey
  foreign key(complemento_id) references public.ro_passagem_complementares(id) on delete no action;
create index ro_passagem_historico_complemento_idx on public.ro_passagem_historico(complemento_id);

create function public.ro_proteger_complemento_id()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and new.complemento_id is distinct from old.complemento_id then
    raise exception 'COMPLEMENTO_ID_IMUTAVEL';
  end if;
  if tg_op='INSERT' and new.complemento_id is not null
     and coalesce(current_setting('ro.complemento_rpc',true),'')<>'1' then
    raise exception 'COMPLEMENTO_ID_SOMENTE_PELA_RPC';
  end if;
  return new;
end $$;
create trigger ro_proteger_anexo_complemento_id before insert or update on public.ro_passagem_anexos
for each row execute function public.ro_proteger_complemento_id();
create trigger ro_proteger_custo_complemento_id before insert or update on public.ro_passagem_custos
for each row execute function public.ro_proteger_complemento_id();
create trigger ro_proteger_historico_complemento_id before insert or update on public.ro_passagem_historico
for each row execute function public.ro_proteger_complemento_id();

create function public.ro_registrar_passagem_complementar_v2(
  p_solicitacao_id uuid,p_operacao_id uuid,p_complementares jsonb,
  p_imprevisto boolean,p_motivo_complementar text,p_custos_adicionais jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.ro_passagem_solicitacoes%rowtype;i jsonb;g jsonb;v_anexos jsonb;v_complementares jsonb:='[]'::jsonb;v_custos jsonb:='[]'::jsonb;
  v_path text;v_cc uuid;v_valor numeric(12,2);v_anexo uuid;v_custo uuid;v_complemento uuid;
  v_motivo text;v_hash text;v_storage_hash text;v_fingerprint text;v_grupo_fingerprint text;v_resultado jsonb;
  v_operacao public.ro_passagem_complementar_operacoes%rowtype;v_ids uuid[]:=array[]::uuid[];
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
  if not public.ro_is_denise(auth.uid()) then raise exception 'PASSAGEM_COMPLEMENTAR_EXCLUSIVA_DENISE';end if;
  if p_operacao_id is null then raise exception 'OPERACAO_ID_OBRIGATORIA';end if;
  if p_complementares is null or jsonb_typeof(p_complementares)<>'array' or jsonb_array_length(p_complementares)=0
    then raise exception 'COMPLEMENTARES_DEVEM_SER_LISTA_NAO_VAZIA';end if;
  if p_custos_adicionais is null or jsonb_typeof(p_custos_adicionais)<>'array'
    then raise exception 'CUSTOS_ADICIONAIS_DEVEM_SER_LISTA';end if;
  v_motivo:=btrim(regexp_replace(coalesce(p_motivo_complementar,''),'\s+',' ','g'));
  if char_length(v_motivo)<10 then raise exception 'JUSTIFICATIVA_COMPLEMENTO_MINIMO_10_CARACTERES';end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'complemento_id',value->>'complemento_id',
    'anexos',(select coalesce(jsonb_agg(jsonb_build_object(
      'client_ref',a.value->>'client_ref','storage_path',a.value->>'storage_path',
      'nome_arquivo',a.value->>'nome_arquivo','mime_type',a.value->>'mime_type',
      'tamanho_bytes',a.value->>'tamanho_bytes','conteudo_sha256',lower(a.value->>'conteudo_sha256'),
      'partida_em',nullif(a.value->>'partida_em',''),'valor',nullif(a.value->>'valor',''),
      'observacao',nullif(btrim(a.value->>'observacao'),'') ,'centro_custo_id',a.value->>'centro_custo_id'
    ) order by a.value->>'client_ref',lower(a.value->>'conteudo_sha256')),'[]'::jsonb) from jsonb_array_elements(value->'anexos') a)
  ) order by value->>'complemento_id'),'[]'::jsonb)
  into v_complementares from jsonb_array_elements(p_complementares);
  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo',value->>'tipo','descricao',nullif(btrim(value->>'descricao'),''),
    'valor',nullif(value->>'valor',''),'centro_custo_id',value->>'centro_custo_id'
  ) order by value->>'tipo',value->>'centro_custo_id',coalesce(value->>'descricao',''),coalesce(value->>'valor','')),'[]'::jsonb)
  into v_custos from jsonb_array_elements(p_custos_adicionais);
  v_fingerprint:=encode(extensions.digest(jsonb_build_object(
    'solicitacao_id',p_solicitacao_id,'complementares',v_complementares,
    'imprevisto',coalesce(p_imprevisto,false),'motivo_complementar',v_motivo,
    'custos_adicionais',v_custos
  )::text,'sha256'::text),'hex');

  select * into s from public.ro_passagem_solicitacoes
    where id=p_solicitacao_id and excluida_em is null for update;
  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
  if s.status not in('passagem_comprada','finalizada') then raise exception 'COMPLEMENTO_EXIGE_PASSAGEM_COMPRADA_OU_FINALIZADA';end if;
  perform set_config('ro.complemento_rpc','1',true);

  insert into public.ro_passagem_complementar_operacoes(id,solicitacao_id,payload_fingerprint,status,criado_por)
  values(p_operacao_id,p_solicitacao_id,v_fingerprint,'processando',auth.uid()) on conflict(id) do nothing;
  if not found then
    select * into v_operacao from public.ro_passagem_complementar_operacoes where id=p_operacao_id for update;
    if v_operacao.solicitacao_id<>p_solicitacao_id or v_operacao.payload_fingerprint<>v_fingerprint
      then raise exception 'OPERACAO_COMPLEMENTAR_ID_REUTILIZADA_COM_PAYLOAD_DIFERENTE';end if;
    if v_operacao.status='concluida' then
      return v_operacao.resultado||jsonb_build_object('idempotent_replay',true);
    end if;
    raise exception 'OPERACAO_COMPLEMENTAR_EM_PROCESSAMENTO';
  end if;

  for g in select value from jsonb_array_elements(v_complementares) loop
    begin v_complemento:=(g->>'complemento_id')::uuid;
    exception when invalid_text_representation then raise exception 'COMPLEMENTO_ID_INVALIDO';end;
    if v_complemento is null or v_complemento=any(v_ids) then raise exception 'COMPLEMENTO_ID_AUSENTE_OU_REPETIDO';end if;
    v_ids:=array_append(v_ids,v_complemento);v_anexos:=g->'anexos';
    if jsonb_typeof(v_anexos)<>'array' or jsonb_array_length(v_anexos)=0 then raise exception 'COMPLEMENTAR_SEM_ANEXOS';end if;
    v_grupo_fingerprint:=encode(extensions.digest(g::text,'sha256'::text),'hex');
    begin
      insert into public.ro_passagem_complementares(id,solicitacao_id,operacao_id,payload_fingerprint,criado_por)
      values(v_complemento,p_solicitacao_id,p_operacao_id,v_grupo_fingerprint,auth.uid());
    exception when unique_violation then
      raise exception 'COMPLEMENTO_ID_JA_UTILIZADO';
    end;

    for i in select value from jsonb_array_elements(v_anexos) loop
      v_path:=i->>'storage_path';
      v_hash:=lower(i->>'conteudo_sha256');
      if nullif(btrim(i->>'client_ref'),'') is null then raise exception 'CLIENT_REF_COMPLEMENTAR_OBRIGATORIO';end if;
      if v_hash is null or v_hash!~'^[0-9a-f]{64}$' then raise exception 'CONTEUDO_SHA256_INVALIDO';end if;
      if v_path is null or v_path not like p_solicitacao_id::text||'/complementares/%' then raise exception 'STORAGE_PATH_COMPLEMENTAR_INVALIDO';end if;
      select lower(o.user_metadata->>'conteudo_sha256') into v_storage_hash
      from storage.objects o where o.bucket_id='ro-passagem-anexos' and o.name=v_path and o.owner_id::text=auth.uid()::text;
      if not found then raise exception 'ARQUIVO_INEXISTENTE_OU_NAO_PERTENCE_A_DENISE';end if;
      if v_storage_hash is null or v_storage_hash!~'^[0-9a-f]{64}$' or v_storage_hash<>v_hash
        then raise exception 'HASH_STORAGE_DIVERGENTE_DO_PAYLOAD';end if;
      if exists(select 1 from public.ro_passagem_anexos a where a.storage_path=v_path) then raise exception 'ARQUIVO_JA_VINCULADO';end if;
      v_cc:=nullif(i->>'centro_custo_id','')::uuid;
      if v_cc is null or not(v_cc is not distinct from s.obra_id or v_cc is not distinct from s.centro_custo_destino_id or v_cc is not distinct from s.centro_custo_retorno_id)
        or not exists(select 1 from public.obras o where o.id=v_cc and o.visivel_passagens and o.escopo_passagens in('comum','restrito_ro'))
        then raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';end if;
      v_valor:=case when nullif(i->>'valor','') is null then null else round((i->>'valor')::numeric,2) end;
      if v_valor is not null and(v_valor<0.01 or v_valor>9999999999.99) then raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';end if;
      insert into public.ro_passagem_anexos(solicitacao_id,tipo,nome_arquivo,storage_path,mime_type,tamanho_bytes,uploaded_by,partida_em,valor,observacao,complementar,imprevisto,motivo_complementar,criado_por,complemento_id,conteudo_sha256)
      values(p_solicitacao_id,'passagem_pdf',i->>'nome_arquivo',v_path,i->>'mime_type',(i->>'tamanho_bytes')::bigint,auth.uid(),nullif(i->>'partida_em','')::timestamptz,v_valor,nullif(i->>'observacao',''),true,coalesce(p_imprevisto,false),v_motivo,auth.uid(),v_complemento,v_hash) returning id into v_anexo;
      v_custo:=null;
      if v_valor is not null then
        insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by,passagem_complementar,complemento_id)
        values(p_solicitacao_id,'passagem','Passagem complementar: '||(i->>'nome_arquivo'),v_valor,v_cc,auth.uid(),true,v_complemento) returning id into v_custo;
        update public.ro_passagem_anexos set custo_id=v_custo where id=v_anexo and solicitacao_id=p_solicitacao_id and custo_id is null;
      end if;
      insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por,complemento_id)
      values(p_solicitacao_id,s.status,s.status,format('Passagem complementar registrada. Complemento: %s. Anexo: %s. Custo: %s. Justificativa: %s',v_complemento,v_anexo,coalesce(v_custo::text,'sem valor'),v_motivo),auth.uid(),v_complemento);
    end loop;
  end loop;

  for i in select value from jsonb_array_elements(v_custos) loop
    if i->>'tipo' not in('uber','refeicao','outros') then raise exception 'TIPO_CUSTO_ADICIONAL_INVALIDO';end if;
    v_cc:=nullif(i->>'centro_custo_id','')::uuid;
    if v_cc is null or not(v_cc is not distinct from s.obra_id or v_cc is not distinct from s.centro_custo_destino_id or v_cc is not distinct from s.centro_custo_retorno_id)
      or not exists(select 1 from public.obras o where o.id=v_cc and o.visivel_passagens and o.escopo_passagens in('comum','restrito_ro'))
      then raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';end if;
    v_valor:=round(coalesce(nullif(i->>'valor','')::numeric,0),2);
    if v_valor<0.01 or v_valor>9999999999.99 then raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';end if;
    insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by)
    values(p_solicitacao_id,i->>'tipo',coalesce(nullif(i->>'descricao',''),'Complemento: '||(i->>'tipo')),v_valor,v_cc,auth.uid());
  end loop;

  v_resultado:=jsonb_build_object('operacao_id',p_operacao_id,'complemento_ids',to_jsonb(v_ids),'idempotent_replay',false);
  update public.ro_passagem_complementar_operacoes
    set status='concluida',resultado=v_resultado,concluido_em=now() where id=p_operacao_id;
  return v_resultado;
end $$;

revoke all on function public.ro_registrar_passagem_complementar_v2(uuid,uuid,jsonb,boolean,text,jsonb) from public,anon;
grant execute on function public.ro_registrar_passagem_complementar_v2(uuid,uuid,jsonb,boolean,text,jsonb) to authenticated;
revoke all on function public.ro_proteger_complemento_id() from public,anon,authenticated;
revoke all on table public.ro_passagem_complementar_operacoes,public.ro_passagem_complementares from public,anon,authenticated;

-- Rollout: a RPC legada permanece executável até a publicação e validação do frontend v2.
-- MIGRATION_202610080004_END

create temporary table dry_identidade_complementar_checks(indicador text primary key,aprovado boolean not null,detalhe text not null);
do $t$
declare
 u uuid:=gen_random_uuid(); obra uuid; sol uuid;
 op1 uuid:=gen_random_uuid();op2 uuid:=gen_random_uuid();op3 uuid:=gen_random_uuid();op4 uuid:=gen_random_uuid();oppos uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d uuid:=gen_random_uuid();
 ha text:=encode(extensions.digest(convert_to('dry004-a','UTF8'),'sha256'),'hex');
 hb text:=encode(extensions.digest(convert_to('dry004-b','UTF8'),'sha256'),'hex');
 hc text:=encode(extensions.digest(convert_to('dry004-c','UTF8'),'sha256'),'hex');
 hd text:=encode(extensions.digest(convert_to('dry004-d','UTF8'),'sha256'),'hex');
 he text:=encode(extensions.digest(convert_to('dry004-e','UTF8'),'sha256'),'hex');
 pa text;pb text;palt text;pc text;pp text;pd text;payload jsonb;r jsonb;err text;
 co bigint;cc bigint;ca bigint;cu bigint;ch bigint;eventos bigint;comprado timestamptz;comprador uuid;
begin
 insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(u,'authenticated','authenticated','dry-run-004-'||u||'@example.invalid','',now(),'{"provider":"email","providers":["email"]}','{"fixture":"dry_run_004"}',now(),now());
 insert into public.ro_responsaveis(user_id,ativo) values(u,true);
 insert into public.ro_rh_responsaveis(user_id,ativo,created_by,updated_by) values(u,true,u,u);
 insert into public.ro_denise_autorizados(user_id,ativo) values(u,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into dry_identidade_complementar_checks values('autorizacao_sintetica',auth.uid()=u and public.ro_can_operate() and public.ro_is_denise(u),'auth, RO e Denise sintéticos');

 insert into public.obras(codigo,nome,descricao,tipo_centro_custo,visivel_obras_control,visivel_passagens,escopo_passagens)
 values('DRY004-'||left(u::text,8),'Centro sintético DRY 004','Fixture transacional','administrativo',false,true,'restrito_ro') returning id into obra;
 sol:=public.ro_criar_solicitacao_com_aprovador(jsonb_build_object('viajante_nome_informado','Viajante Sintético DRY 004','obra_id',obra,'origem','Origem Sintética - SP','destino','Destino Sintético - RO','motivo','viagem_administrativa','data_ida',(current_date+30)::text,'pix_viajante','dry-run-pix-nao-real@example.invalid'),'[]');
 insert into dry_identidade_complementar_checks select 'solicitacao_base',excluida_em is null and status='solicitada' and aprovacao_status='dispensada' and solicitante_id=u and viajante_nome_informado='Viajante Sintético DRY 004','status='||status||', aprovacao='||aprovacao_status from public.ro_passagem_solicitacoes where id=sol;

 perform public.ro_alterar_status(sol,'em_andamento');
 insert into dry_identidade_complementar_checks select 'em_andamento_canonico',status='em_andamento' and responsavel_ro_id=u and assumida_em is not null,'status='||status from public.ro_passagem_solicitacoes where id=sol;
 perform public.ro_registrar_compra_v2(sol,'aereo','Companhia Sintética','DRY004','Origem Sintética - SP','Destino Sintético - RO',(current_date+30)::timestamp+time '12:00',(current_date+30)::timestamp+time '15:00','Compra sintética',jsonb_build_array(jsonb_build_object('tipo','passagem','descricao','Trecho sintético','valor','100.00','centro_custo_id',obra,'compra_chave','dry004-inicial')),false,null,jsonb_build_array(jsonb_build_object('origem','Origem Sintética - SP','destino','Destino Sintético - RO','partida_em',(current_date+30)::text)),false,null);
 select comprado_em,comprado_por into comprado,comprador from public.ro_passagem_solicitacoes where id=sol;
 select count(*) into eventos from public.ro_email_outbox where solicitacao_id=sol and tipo_evento='passagem_comprada';
 insert into dry_identidade_complementar_checks select 'compra_inicial',status='passagem_comprada' and comprado is not null and comprador=u,'eventos='||eventos from public.ro_passagem_solicitacoes where id=sol;

 pa:=sol||'/complementares/dry-run-004/'||op1||'/a.pdf';pb:=sol||'/complementares/dry-run-004/'||op1||'/b.pdf';palt:=sol||'/complementares/dry-run-004/'||op1||'/a-alt.pdf';
 insert into storage.objects(id,bucket_id,name,owner_id,metadata,user_metadata) values
 (gen_random_uuid(),'ro-passagem-anexos',pa,u,jsonb_build_object('size',100,'mimetype','application/pdf'),jsonb_build_object('conteudo_sha256',ha)),
 (gen_random_uuid(),'ro-passagem-anexos',pb,u,jsonb_build_object('size',100,'mimetype','application/pdf'),jsonb_build_object('conteudo_sha256',hb)),
 (gen_random_uuid(),'ro-passagem-anexos',palt,u,jsonb_build_object('size',100,'mimetype','application/pdf'),jsonb_build_object('conteudo_sha256',hd));
 payload:=jsonb_build_array(
 jsonb_build_object('complemento_id',a,'anexos',jsonb_build_array(jsonb_build_object('client_ref','a1','nome_arquivo','mesmo.pdf','storage_path',pa,'mime_type','application/pdf','tamanho_bytes',100,'conteudo_sha256',ha,'centro_custo_id',obra,'valor','110.00'))),
 jsonb_build_object('complemento_id',b,'anexos',jsonb_build_array(jsonb_build_object('client_ref','b1','nome_arquivo','mesmo.pdf','storage_path',pb,'mime_type','application/pdf','tamanho_bytes',100,'conteudo_sha256',hb,'centro_custo_id',obra,'valor','120.00'))));
 r:=public.ro_registrar_passagem_complementar_v2(sol,op1,payload,false,'Complementares sintéticas A e B.',jsonb_build_array(jsonb_build_object('tipo','outros','descricao','Genérico sintético','valor','5.00','centro_custo_id',obra)));
 insert into dry_identidade_complementar_checks values('op1_a_b',(r->>'idempotent_replay')::boolean=false and (select count(*)=2 from public.ro_passagem_complementares where operacao_id=op1) and (select count(*)=1 from public.ro_passagem_anexos where complemento_id=a and conteudo_sha256=ha) and (select count(*)=1 from public.ro_passagem_anexos where complemento_id=b and conteudo_sha256=hb) and (select count(*)=2 from public.ro_passagem_custos where solicitacao_id=sol and complemento_id in(a,b)) and (select count(*)=1 from public.ro_passagem_custos where solicitacao_id=sol and tipo='outros' and complemento_id is null),'A/B, hashes e vínculos');

 select count(*) into co from public.ro_passagem_complementar_operacoes where solicitacao_id=sol;select count(*) into cc from public.ro_passagem_complementares where solicitacao_id=sol;select count(*) into ca from public.ro_passagem_anexos where solicitacao_id=sol;select count(*) into cu from public.ro_passagem_custos where solicitacao_id=sol;select count(*) into ch from public.ro_passagem_historico where solicitacao_id=sol;
 r:=public.ro_registrar_passagem_complementar_v2(sol,op1,payload,false,'Complementares sintéticas A e B.',jsonb_build_array(jsonb_build_object('tipo','outros','descricao','Genérico sintético','valor','5.00','centro_custo_id',obra)));
 insert into dry_identidade_complementar_checks values('replay_zero_crescimento',(r->>'idempotent_replay')::boolean and co=(select count(*) from public.ro_passagem_complementar_operacoes where solicitacao_id=sol) and cc=(select count(*) from public.ro_passagem_complementares where solicitacao_id=sol) and ca=(select count(*) from public.ro_passagem_anexos where solicitacao_id=sol) and cu=(select count(*) from public.ro_passagem_custos where solicitacao_id=sol) and ch=(select count(*) from public.ro_passagem_historico where solicitacao_id=sol),'snapshots específicos preservados');

 begin perform public.ro_registrar_passagem_complementar_v2(sol,op1,jsonb_set(payload,'{0,anexos,0}',(payload#>'{0,anexos,0}')||jsonb_build_object('storage_path',palt,'conteudo_sha256',hd)),false,'Complementares sintéticas A e B.',jsonb_build_array(jsonb_build_object('tipo','outros','descricao','Genérico sintético','valor','5.00','centro_custo_id',obra)));err:='SEM_ERRO';exception when others then err:=sqlerrm;end;
 insert into dry_identidade_complementar_checks values('conflito_somente_bytes',err like '%OPERACAO_COMPLEMENTAR_ID_REUTILIZADA_COM_PAYLOAD_DIFERENTE%','metadata alternativa coerente; '||err);

 pc:=sol||'/complementares/dry-run-004/'||op2||'/c.pdf';insert into storage.objects(id,bucket_id,name,owner_id,metadata,user_metadata) values(gen_random_uuid(),'ro-passagem-anexos',pc,u,jsonb_build_object('size',100,'mimetype','application/pdf'),jsonb_build_object('conteudo_sha256',hc));
 r:=public.ro_registrar_passagem_complementar_v2(sol,op2,jsonb_build_array(jsonb_build_object('complemento_id',c,'anexos',jsonb_build_array(jsonb_build_object('client_ref','c1','nome_arquivo','c.pdf','storage_path',pc,'mime_type','application/pdf','tamanho_bytes',100,'conteudo_sha256',hc,'centro_custo_id',obra,'valor','130.00')))),false,'Complementar sintética C.','[]');
 insert into dry_identidade_complementar_checks values('op2_c',(r->>'idempotent_replay')::boolean=false and (select count(*)=2 from public.ro_passagem_complementar_operacoes where solicitacao_id=sol) and (select count(*)=3 from public.ro_passagem_complementares where solicitacao_id=sol),'OP1/OP2; A/B/C');

 begin perform public.ro_registrar_passagem_complementar_v2(sol,op3,jsonb_build_array(jsonb_build_object('complemento_id',a,'anexos',jsonb_build_array(jsonb_build_object('client_ref','a-reuso','nome_arquivo','a2.pdf','storage_path',palt,'mime_type','application/pdf','tamanho_bytes',100,'conteudo_sha256',hd,'centro_custo_id',obra,'valor','140.00')))),false,'Reutilização incompatível sintética.','[]');err:='SEM_ERRO';exception when others then err:=sqlerrm;end;
 insert into dry_identidade_complementar_checks values('reuso_a_rejeitado',err like '%COMPLEMENTO_ID_JA_UTILIZADO%','A original preservado; '||err);

 pp:=sol||'/pos-compra/'||oppos||'-'||hd||'-apoio.pdf';insert into storage.objects(id,bucket_id,name,owner_id,metadata,user_metadata) values(gen_random_uuid(),'ro-passagem-anexos',pp,u,jsonb_build_object('size',100,'mimetype','application/pdf'),jsonb_build_object('conteudo_sha256',hd));
 perform public.ro_registrar_documentos_pos_compra(sol,oppos,jsonb_build_array(jsonb_build_object('client_ref','apoio','id',null,'nome_arquivo','apoio.pdf','storage_path',pp,'mime_type','application/pdf','tamanho_bytes',100,'conteudo_sha256',hd)),'[]');
 insert into dry_identidade_complementar_checks values('pos_compra_independente',(select count(*)=3 from public.ro_passagem_complementares where solicitacao_id=sol) and exists(select 1 from public.ro_passagem_anexos where storage_path=pp and complemento_id is null),'sem complemento artificial');

 perform public.ro_finalizar_solicitacao(sol,'Finalização sintética DRY 004.');
 pd:=sol||'/complementares/dry-run-004/'||op4||'/d.pdf';insert into storage.objects(id,bucket_id,name,owner_id,metadata,user_metadata) values(gen_random_uuid(),'ro-passagem-anexos',pd,u,jsonb_build_object('size',100,'mimetype','application/pdf'),jsonb_build_object('conteudo_sha256',he));
 perform public.ro_registrar_passagem_complementar_v2(sol,op4,jsonb_build_array(jsonb_build_object('complemento_id',d,'anexos',jsonb_build_array(jsonb_build_object('client_ref','d1','nome_arquivo','d.pdf','storage_path',pd,'mime_type','application/pdf','tamanho_bytes',100,'conteudo_sha256',he,'centro_custo_id',obra,'valor','150.00')))),false,'Complementar sintética finalizada.','[]');
 insert into dry_identidade_complementar_checks select 'finalizada_aceita',status='finalizada' and exists(select 1 from public.ro_passagem_complementares where id=d),'status='||status from public.ro_passagem_solicitacoes where id=sol;
 insert into dry_identidade_complementar_checks values('compra_nao_recriada',eventos=(select count(*) from public.ro_email_outbox where solicitacao_id=sol and tipo_evento='passagem_comprada') and (select comprado_em=comprado and comprado_por=comprador from public.ro_passagem_solicitacoes where id=sol),'evento e autoria da compra preservados');
end $t$;
select indicador,aprovado,detalhe,bool_and(aprovado) over() todos_aprovados from dry_identidade_complementar_checks order by indicador;
-- SQL testa B↔C (user_metadata versus payload); SHA dos bytes A é responsabilidade do frontend.
rollback;
