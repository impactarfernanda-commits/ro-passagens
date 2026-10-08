begin;

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
commit;
