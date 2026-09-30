begin;

alter table public.ro_passagem_custos add column if not exists compra_chave text;
alter table public.ro_passagem_anexos
  add column if not exists conteudo_sha256 text,
  add column if not exists custo_id uuid;

-- O hash é declarado pelo cliente e serve como proteção operacional best-effort.
-- A identidade financeira principal é compra_chave; o banco não lê os bytes do Storage.
alter table public.ro_passagem_anexos drop constraint if exists ro_passagem_anexos_sha256_valido;
alter table public.ro_passagem_anexos add constraint ro_passagem_anexos_sha256_valido
  check(conteudo_sha256 is null or conteudo_sha256~'^[0-9a-f]{64}$');

alter table public.ro_passagem_anexos drop constraint if exists ro_passagem_anexos_custo_id_fkey;
alter table public.ro_passagem_anexos add constraint ro_passagem_anexos_custo_id_fkey
  foreign key(custo_id) references public.ro_passagem_custos(id) on delete no action;

create or replace function public.ro_normalizar_compra_chave(p_chave text)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare v text;v_prefixo text;v_corpo text;v_partes text[];v_resultado text:='';v_item text;v_i integer;
begin
  v:=upper(translate(btrim(coalesce(p_chave,'')),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC'));
  if v='' or char_length(v)>300 then return null;end if;
  if v~'^\s*(LOC|BIL)\s*:' then
    v_prefixo:=(regexp_match(v,'^\s*(LOC|BIL)\s*:'))[1];
    v_corpo:=btrim(regexp_replace(v,'^\s*(LOC|BIL)\s*:\s*','','i'));
    v_corpo:=btrim(regexp_replace(v_corpo,'[^A-Z0-9]+',' ','g'));
    if v_corpo='' then return null;end if;
    return v_prefixo||':'||v_corpo;
  end if;
  v_partes:=string_to_array(v,'|');
  if cardinality(v_partes)<>6 then return null;end if;
  for v_i in 1..6 loop
    v_item:=btrim(regexp_replace(v_partes[v_i],'[^A-Z0-9]+',' ','g'));
    if v_i=5 and v_item<>'' and v_item!~'^[0-9]{8,14}$' then return null;end if;
    v_resultado:=v_resultado||case when v_i>1 then '|' else '' end||v_item;
  end loop;
  v_partes:=string_to_array(v_resultado,'|');
  -- Assinatura estrutural: pessoa/documento + (rota completa ou data), ou rota completa + data.
  -- Poltrona isolada e assinatura inteiramente vazia nunca identificam uma compra.
  if not (((v_partes[1]<>'' or v_partes[2]<>'') and ((v_partes[3]<>'' and v_partes[4]<>'') or v_partes[5]<>''))
      or (v_partes[3]<>'' and v_partes[4]<>'' and v_partes[5]<>'')) then return null;end if;
  return v_resultado;
end $$;

alter table public.ro_passagem_custos drop constraint if exists ro_passagem_custos_compra_chave_canonica;
alter table public.ro_passagem_custos add constraint ro_passagem_custos_compra_chave_canonica
  check(compra_chave is null or(compra_chave=public.ro_normalizar_compra_chave(compra_chave) and char_length(compra_chave)<=300));

create unique index if not exists ro_passagem_custos_compra_chave_unica
  on public.ro_passagem_custos(solicitacao_id,compra_chave)
  where tipo='passagem' and compra_chave is not null;
create unique index if not exists ro_passagem_anexos_hash_unico
  on public.ro_passagem_anexos(solicitacao_id,conteudo_sha256)
  where conteudo_sha256 is not null;
create index if not exists ro_passagem_anexos_custo_idx on public.ro_passagem_anexos(custo_id);

create table if not exists public.ro_passagem_operacoes_idempotentes(
  solicitacao_id uuid not null references public.ro_passagem_solicitacoes(id) on delete cascade,
  operacao_id uuid not null,
  payload_fingerprint text not null check(payload_fingerprint~'^[0-9a-f]{64}$'),
  status text not null check(status in('processando','concluida')),
  resultado jsonb,
  criado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now(),
  concluido_em timestamptz,
  primary key(solicitacao_id,operacao_id)
);
alter table public.ro_passagem_operacoes_idempotentes enable row level security;
revoke all on table public.ro_passagem_operacoes_idempotentes from public,anon,authenticated;

create or replace function public.ro_validar_anexo_custo_mesma_solicitacao()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.custo_id is not null and not exists(select 1 from public.ro_passagem_custos c
    where c.id=new.custo_id and c.solicitacao_id=new.solicitacao_id and c.tipo='passagem')
  then raise exception 'CUSTO_ANEXO_NAO_PERTENCE_A_SOLICITACAO';end if;
  return new;
end $$;
drop trigger if exists ro_validar_anexo_custo_mesma_solicitacao on public.ro_passagem_anexos;
create trigger ro_validar_anexo_custo_mesma_solicitacao before insert or update of solicitacao_id,custo_id
  on public.ro_passagem_anexos for each row execute function public.ro_validar_anexo_custo_mesma_solicitacao();

create or replace function public.ro_registrar_documentos_pos_compra(
  p_solicitacao_id uuid,p_operacao_id uuid,p_anexos jsonb,p_grupos jsonb
) returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare
  v_sol public.ro_passagem_solicitacoes%rowtype;v_item jsonb;v_grupo jsonb;v_grupos jsonb:='[]'::jsonb;v_anexos jsonb:='[]'::jsonb;
  v_ref text;v_path text;v_hash text;v_chave text;v_justificativa text;v_fingerprint text;v_nome text;v_observacao text;v_id text;
  v_anexo public.ro_passagem_anexos%rowtype;v_custo public.ro_passagem_custos%rowtype;
  v_refs text[]:=array[]::text[];v_usadas text[]:=array[]::text[];v_chaves text[]:=array[]::text[];
  v_ids text[]:=array[]::text[];v_hashes text[]:=array[]::text[];v_paths text[]:=array[]::text[];
  v_anexo_ids uuid[]:=array[]::uuid[];v_grupo_anexos uuid[];v_nomes text[];v_apoio_ids uuid[]:=array[]::uuid[];
  v_valor numeric(12,2);v_extraido numeric(12,2);v_anexo_valor numeric(12,2);v_cc uuid;v_manual boolean;v_associacao_manual boolean;
  v_reutilizado boolean;v_resultado jsonb;v_idem public.ro_passagem_operacoes_idempotentes%rowtype;
  v_anexos_fingerprint jsonb;v_grupos_fingerprint jsonb;v_refs_ordenadas jsonb;
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
  if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_REGISTRAR_POS_COMPRA';end if;
  if p_operacao_id is null then raise exception 'OPERACAO_ID_OBRIGATORIA';end if;
  if p_anexos is null or jsonb_typeof(p_anexos)<>'array' then raise exception 'ANEXOS_DEVEM_SER_LISTA';end if;
  if p_grupos is null or jsonb_typeof(p_grupos)<>'array' then raise exception 'GRUPOS_DEVEM_SER_LISTA';end if;
  -- Limites operacionais generosos: a UI limita cada PDF a 10 MiB; estes limites evitam abuso da RPC.
  if jsonb_array_length(p_anexos)>100 then raise exception 'LIMITE_ANEXOS_EXCEDIDO';end if;
  if jsonb_array_length(p_grupos)>100 then raise exception 'LIMITE_GRUPOS_EXCEDIDO';end if;
  if octet_length(p_anexos::text)+octet_length(p_grupos::text)>1048576 then raise exception 'LIMITE_JSON_OPERACAO_EXCEDIDO';end if;

  select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
  if not found or v_sol.excluida_em is not null then raise exception 'SOLICITACAO_NAO_ENCONTRADA_OU_EXCLUIDA';end if;
  if v_sol.status not in('passagem_comprada','finalizada') then raise exception 'POS_COMPRA_EXIGE_PASSAGEM_COMPRADA_OU_FINALIZADA';end if;
  if v_sol.aprovacao_status in('pendente','reprovada') then raise exception 'APROVACAO_NAO_PERMITE_POS_COMPRA';end if;
  if v_sol.folga_antecipacao_status='pendente' then raise exception 'ANTECIPACAO_FOLGA_PENDENTE';end if;

  -- Canonicaliza anexos antes do fingerprint/DML. A ordem é client_ref; no frontend,
  -- storage_path é determinístico por operacao_id + hash para permanecer estável em retries.
  for v_item in select value from jsonb_array_elements(p_anexos) loop
    v_ref:=nullif(btrim(v_item->>'client_ref'),'');v_id:=nullif(btrim(v_item->>'id'),'');
    v_hash:=lower(nullif(btrim(v_item->>'conteudo_sha256'),''));v_path:=nullif(btrim(v_item->>'storage_path'),'');
    v_nome:=nullif(btrim(v_item->>'nome_arquivo'),'');v_observacao:=nullif(btrim(regexp_replace(coalesce(v_item->>'observacao',''),'\s+',' ','g')),'');
    if v_ref is null or v_ref=any(v_refs) then raise exception 'CLIENT_REF_REPETIDO_OU_INVALIDO';end if;
    if char_length(v_ref)>200 then raise exception 'CLIENT_REF_ACIMA_DO_LIMITE';end if;
    if v_id is not null then
      begin perform v_id::uuid;exception when invalid_text_representation then raise exception 'ID_ANEXO_INVALIDO';end;
      if v_id=any(v_ids) then raise exception 'ID_ANEXO_HISTORICO_REPETIDO';end if;
      v_ids:=array_append(v_ids,v_id);
    end if;
    if v_hash is null or v_hash!~'^[0-9a-f]{64}$' then raise exception 'HASH_ANEXO_INVALIDO';end if;
    if v_hash=any(v_hashes) then raise exception 'HASH_ANEXO_REPETIDO_NO_PAYLOAD';end if;
    v_refs:=array_append(v_refs,v_ref);v_hashes:=array_append(v_hashes,v_hash);
    if v_id is not null then
      if v_path is not null then raise exception 'ANEXO_REPRESENTADO_POR_ID_E_STORAGE_PATH';end if;
      select * into v_anexo from public.ro_passagem_anexos a
        where a.id=v_id::uuid and a.solicitacao_id=p_solicitacao_id for update;
      if not found then raise exception 'ANEXO_EXISTENTE_NAO_ENCONTRADO';end if;
      -- Para histórico, toda metadata vem da linha persistida; o cliente declara apenas ID/ref/hash.
      v_anexos:=v_anexos||jsonb_build_array(jsonb_build_object(
        'client_ref',v_ref,'id',v_id,'nome_arquivo',v_anexo.nome_arquivo,'storage_path',v_anexo.storage_path,
        'mime_type',v_anexo.mime_type,'tamanho_bytes',v_anexo.tamanho_bytes,
        'partida_em',v_anexo.partida_em,'valor',v_anexo.valor,
        'observacao',v_anexo.observacao,'conteudo_sha256',v_hash));
    else
      if v_path is not null and v_path=any(v_paths) then raise exception 'STORAGE_PATH_REPETIDO_NO_PAYLOAD';end if;
      if v_nome is null or char_length(v_nome)>255 then raise exception 'NOME_ARQUIVO_INVALIDO_OU_ACIMA_DO_LIMITE';end if;
      if char_length(coalesce(v_observacao,''))>4000 then raise exception 'OBSERVACAO_ACIMA_DO_LIMITE';end if;
      begin v_anexo_valor:=round(nullif(v_item->>'valor','')::numeric,2);
      exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'VALOR_ANEXO_INVALIDO';end;
      if v_anexo_valor is not null and (v_anexo_valor::text in('NaN','Infinity','-Infinity') or v_anexo_valor<0 or v_anexo_valor>9999999999.99)
        then raise exception 'VALOR_ANEXO_INVALIDO';end if;
      if v_path is not null then v_paths:=array_append(v_paths,v_path);end if;
      v_anexos:=v_anexos||jsonb_build_array(jsonb_build_object(
        'client_ref',v_ref,'id',null,'nome_arquivo',v_nome,'storage_path',v_path,
        'mime_type',coalesce(nullif(btrim(v_item->>'mime_type'),''),'application/pdf'),
        'tamanho_bytes',nullif(v_item->>'tamanho_bytes','')::bigint,
        'partida_em',nullif(v_item->>'partida_em',''),'valor',v_anexo_valor,
        'observacao',v_observacao,'conteudo_sha256',v_hash));
    end if;
  end loop;
  select coalesce(jsonb_agg(value order by value->>'client_ref'),'[]'::jsonb) into v_anexos from jsonb_array_elements(v_anexos);

  -- Canonicaliza grupos integralmente. Referências são ordenadas por texto e grupos por compra_chave.
  for v_grupo in select value from jsonb_array_elements(p_grupos) loop
    v_chave:=public.ro_normalizar_compra_chave(v_grupo->>'compra_chave');
    if v_chave is null then raise exception 'IDENTIDADE_COMPRA_PASSAGEM_INVALIDA';end if;
    if v_chave=any(v_chaves) then raise exception 'COMPRA_CHAVE_REPETIDA_NO_PAYLOAD';end if;
    v_chaves:=array_append(v_chaves,v_chave);
    if jsonb_typeof(coalesce(v_grupo->'anexo_refs','null'::jsonb))<>'array'
       or jsonb_array_length(v_grupo->'anexo_refs')=0 then raise exception 'GRUPO_FINANCEIRO_SEM_ANEXOS';end if;
    if jsonb_array_length(v_grupo->'anexo_refs')>20 then raise exception 'LIMITE_REFERENCIAS_GRUPO_EXCEDIDO';end if;
    if (select count(*)<>count(distinct value) from jsonb_array_elements_text(v_grupo->'anexo_refs'))
      then raise exception 'REFERENCIA_REPETIDA_NO_GRUPO';end if;
    select jsonb_agg(value order by value) into v_refs_ordenadas from jsonb_array_elements_text(v_grupo->'anexo_refs');
    for v_ref in select jsonb_array_elements_text(v_refs_ordenadas) loop
      if array_position(v_refs,v_ref) is null then raise exception 'REFERENCIA_ANEXO_DO_GRUPO_INVALIDA';end if;
      if v_ref=any(v_usadas) then raise exception 'ANEXO_USADO_EM_DOIS_GRUPOS_FINANCEIROS';end if;
      v_usadas:=array_append(v_usadas,v_ref);
    end loop;
    begin
      v_valor:=round(nullif(v_grupo->>'valor_confirmado','')::numeric,2);
      v_extraido:=round(nullif(v_grupo->>'valor_extraido','')::numeric,2);
      v_manual:=coalesce((v_grupo->>'valor_manual')::boolean,false);
      v_associacao_manual:=coalesce((v_grupo->>'associacao_historica_manual')::boolean,false);
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'VALOR_OU_BOOLEAN_INVALIDO';end;
    if v_valor is null or v_valor::text in('NaN','Infinity','-Infinity') or v_valor<0.01 or v_valor>9999999999.99 then raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';end if;
    if v_extraido is not null and (v_extraido::text in('NaN','Infinity','-Infinity') or v_extraido<=0 or v_extraido>9999999999.99) then raise exception 'VALOR_EXTRAIDO_INVALIDO';end if;
    v_justificativa:=nullif(btrim(regexp_replace(coalesce(v_grupo->>'justificativa',''),'\s+',' ','g')),'');
    if char_length(coalesce(v_justificativa,''))>2000 then raise exception 'JUSTIFICATIVA_ACIMA_DO_LIMITE';end if;
    if (v_manual or v_associacao_manual) and char_length(coalesce(v_justificativa,''))<10 then raise exception 'JUSTIFICATIVA_MINIMO_10_CARACTERES';end if;
    v_cc:=null;
    if not v_associacao_manual then
      begin v_cc:=nullif(btrim(v_grupo->>'centro_custo_id'),'')::uuid;
      exception when invalid_text_representation then raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';end;
      if v_cc is null
        or not(v_cc is not distinct from v_sol.obra_id or v_cc is not distinct from v_sol.centro_custo_destino_id or v_cc is not distinct from v_sol.centro_custo_retorno_id)
        or not exists(select 1 from public.obras o where o.id=v_cc and o.visivel_passagens and o.escopo_passagens in('comum','restrito_ro'))
        then raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';end if;
    end if;
    v_grupo:=jsonb_build_object('compra_chave',v_chave,'anexo_refs',v_refs_ordenadas,
      'custo_existente_id',nullif(btrim(v_grupo->>'custo_existente_id'),''),
      'valor_confirmado',v_valor,'valor_extraido',v_extraido,'valor_manual',v_manual,
      'associacao_historica_manual',v_associacao_manual,'centro_custo_id',v_cc,'justificativa',v_justificativa);
    v_grupos:=v_grupos||jsonb_build_array(v_grupo);
  end loop;
  select coalesce(jsonb_agg(value order by value->>'compra_chave'),'[]'::jsonb) into v_grupos from jsonb_array_elements(v_grupos);
  v_refs:=array[]::text[];v_usadas:=array[]::text[];

  -- Estas são as mesmas estruturas canônicas consumidas na execução abaixo.
  v_anexos_fingerprint:=v_anexos;
  v_grupos_fingerprint:=v_grupos;
  v_fingerprint:=encode(extensions.digest(p_solicitacao_id::text||'|'||v_anexos_fingerprint::text||'|'||v_grupos_fingerprint::text,'sha256'::text),'hex');

  insert into public.ro_passagem_operacoes_idempotentes(solicitacao_id,operacao_id,payload_fingerprint,status,criado_por)
  values(p_solicitacao_id,p_operacao_id,v_fingerprint,'processando',auth.uid()) on conflict do nothing;
  if not found then
    select * into v_idem from public.ro_passagem_operacoes_idempotentes
      where solicitacao_id=p_solicitacao_id and operacao_id=p_operacao_id for update;
    if v_idem.payload_fingerprint<>v_fingerprint then raise exception 'OPERACAO_ID_REUTILIZADA_COM_PAYLOAD_DIFERENTE';end if;
    if v_idem.status='concluida' then return v_idem.resultado||jsonb_build_object('idempotent_replay',true);end if;
    raise exception 'OPERACAO_ID_EM_PROCESSAMENTO';
  end if;

  for v_item in select value from jsonb_array_elements(v_anexos) loop
    v_ref:=nullif(btrim(v_item->>'client_ref'),'');v_hash:=lower(nullif(btrim(v_item->>'conteudo_sha256'),''));
    if v_ref is null or v_ref=any(v_refs) then raise exception 'REFERENCIA_ANEXO_INVALIDA_OU_DUPLICADA';end if;
    if v_hash is null or v_hash!~'^[0-9a-f]{64}$' then raise exception 'HASH_ANEXO_INVALIDO';end if;
    if exists(select 1 from public.ro_passagem_anexos a where a.solicitacao_id=p_solicitacao_id and a.conteudo_sha256=v_hash and a.id is distinct from nullif(v_item->>'id','')::uuid)
      then raise exception 'ARQUIVO_JA_ANEXADO';end if;
    if nullif(v_item->>'id','') is not null then
      select * into v_anexo from public.ro_passagem_anexos a where a.id=(v_item->>'id')::uuid and a.solicitacao_id=p_solicitacao_id for update;
      if not found then raise exception 'ANEXO_EXISTENTE_NAO_ENCONTRADO';end if;
      if v_anexo.custo_id is not null then raise exception 'ANEXO_EXISTENTE_JA_VINCULADO';end if;
      update public.ro_passagem_anexos set conteudo_sha256=v_hash where id=v_anexo.id returning * into v_anexo;
    else
      v_path:=nullif(v_item->>'storage_path','');
      if v_path is null or v_path not like p_solicitacao_id::text||'/pos-compra/%' then raise exception 'STORAGE_PATH_POS_COMPRA_INVALIDO';end if;
      if not exists(select 1 from storage.objects o where o.bucket_id='ro-passagem-anexos' and o.name=v_path and o.owner_id::text=auth.uid()::text)
        then raise exception 'ARQUIVO_POS_COMPRA_INEXISTENTE_OU_SEM_AUTORIA';end if;
      if coalesce((v_item->>'tamanho_bytes')::bigint,0)<=0 or (v_item->>'tamanho_bytes')::bigint>10485760 then raise exception 'TAMANHO_ANEXO_INVALIDO';end if;
      insert into public.ro_passagem_anexos(solicitacao_id,tipo,nome_arquivo,storage_path,mime_type,tamanho_bytes,uploaded_by,partida_em,valor,observacao,criado_por,conteudo_sha256)
      values(p_solicitacao_id,'passagem_pdf',v_item->>'nome_arquivo',v_path,'application/pdf',(v_item->>'tamanho_bytes')::bigint,auth.uid(),nullif(v_item->>'partida_em','')::timestamptz,nullif(v_item->>'valor','')::numeric,nullif(v_item->>'observacao',''),auth.uid(),v_hash) returning * into v_anexo;
    end if;
    v_refs:=array_append(v_refs,v_ref);v_anexo_ids:=array_append(v_anexo_ids,v_anexo.id);
  end loop;

  for v_grupo in select value from jsonb_array_elements(v_grupos) loop
    v_chave:=v_grupo->>'compra_chave';v_grupo_anexos:=array[]::uuid[];v_nomes:=array[]::text[];
    for v_ref in select jsonb_array_elements_text(v_grupo->'anexo_refs') loop
      if array_position(v_refs,v_ref) is null then raise exception 'REFERENCIA_ANEXO_DO_GRUPO_INVALIDA';end if;
      if v_ref=any(v_usadas) then raise exception 'ANEXO_USADO_EM_DOIS_GRUPOS_FINANCEIROS';end if;
      v_usadas:=array_append(v_usadas,v_ref);v_grupo_anexos:=array_append(v_grupo_anexos,v_anexo_ids[array_position(v_refs,v_ref)]);
    end loop;
    -- Apenas desserializa a estrutura já canonicalizada e fingerprintada; não renormaliza.
    v_valor:=(v_grupo->>'valor_confirmado')::numeric(12,2);
    v_extraido:=(v_grupo->>'valor_extraido')::numeric(12,2);
    v_manual:=(v_grupo->>'valor_manual')::boolean;
    v_associacao_manual:=(v_grupo->>'associacao_historica_manual')::boolean;
    v_cc:=nullif(v_grupo->>'centro_custo_id','')::uuid;
    v_justificativa:=v_grupo->>'justificativa';
    if (nullif(v_grupo->>'custo_existente_id','') is null and v_associacao_manual)
       or (nullif(v_grupo->>'custo_existente_id','') is not null and not v_associacao_manual)
      then raise exception 'ASSOCIACAO_HISTORICA_MANUAL_INCONSISTENTE';end if;

    select * into v_custo from public.ro_passagem_custos c where c.solicitacao_id=p_solicitacao_id and c.tipo='passagem' and c.compra_chave=v_chave for update;
    v_reutilizado:=found;
    if v_associacao_manual then
      if v_reutilizado and v_custo.id<>(v_grupo->>'custo_existente_id')::uuid then raise exception 'CUSTO_EXISTENTE_DIVERGE_DA_COMPRA_CHAVE';end if;
      select * into v_custo from public.ro_passagem_custos c where c.id=(v_grupo->>'custo_existente_id')::uuid and c.solicitacao_id=p_solicitacao_id and c.tipo='passagem' for update;
      if not found then raise exception 'CUSTO_HISTORICO_NAO_ENCONTRADO';end if;
      if v_custo.compra_chave is not null and v_custo.compra_chave<>v_chave then raise exception 'CUSTO_HISTORICO_COM_IDENTIDADE_DIVERGENTE';end if;
      if abs(v_custo.valor-v_valor)>=0.005 then raise exception 'VALOR_NAO_CONFERE_COM_CUSTO_EXISTENTE';end if;
      if v_custo.compra_chave is null then update public.ro_passagem_custos set compra_chave=v_chave where id=v_custo.id returning * into v_custo;end if;
      v_reutilizado:=true;
    elsif not v_reutilizado then
      insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by,compra_chave)
      values(p_solicitacao_id,'passagem','Passagem adicionada após a compra',v_valor,v_cc,auth.uid(),v_chave) returning * into v_custo;
    elsif abs(v_custo.valor-v_valor)>=0.005 then
      raise exception 'VALOR_NAO_CONFERE_COM_CUSTO_EXISTENTE';
    elsif v_custo.centro_custo_id is distinct from v_cc then
      raise exception 'COMPRA_CHAVE_CENTRO_CUSTO_DIVERGENTE';
    end if;

    update public.ro_passagem_anexos set custo_id=v_custo.id where id=any(v_grupo_anexos) and custo_id is null;
    if exists(select 1 from public.ro_passagem_anexos where id=any(v_grupo_anexos) and custo_id<>v_custo.id) then raise exception 'ANEXO_VINCULADO_A_OUTRO_CUSTO';end if;
    select array_agg(nome_arquivo order by nome_arquivo) into v_nomes from public.ro_passagem_anexos where id=any(v_grupo_anexos);
    insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
      values(p_solicitacao_id,v_sol.status,v_sol.status,case when v_associacao_manual then 'Documento pós-compra vinculado manualmente a custo histórico. Custo: '||v_custo.id||'. Justificativa: '||v_justificativa when v_reutilizado then 'Documento pós-compra vinculado a passagem já registrada. Custo: '||v_custo.id else 'Novo custo de passagem adicionado após a compra. Custo: '||v_custo.id||'. Valor: R$ '||v_custo.valor end,auth.uid());
    insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
      values(case when v_associacao_manual then 'documento_historico_vinculado_manualmente' when v_reutilizado then 'documento_pos_compra_vinculado' else 'custo_passagem_pos_compra_adicionado' end,p_solicitacao_id,
      jsonb_build_object('operacao_id',p_operacao_id,'payload_fingerprint',v_fingerprint,'custo_id',v_custo.id,'centro_custo_id',v_custo.centro_custo_id,'anexo_ids',to_jsonb(v_grupo_anexos),'arquivos',to_jsonb(v_nomes),'hashes_declarados_pelo_cliente',(select jsonb_agg(conteudo_sha256) from public.ro_passagem_anexos where id=any(v_grupo_anexos)),'compra_chave',v_chave,'valor_extraido',v_extraido,'valor_confirmado',v_valor,'valor_manual',v_manual,'associacao_historica_manual',v_associacao_manual,'justificativa',v_justificativa,'reutilizado',v_reutilizado,'registrado_em',now()),auth.uid());
  end loop;

  if exists(select 1 from unnest(v_refs) r where not(r=any(v_usadas))) then
    select array_agg(v_anexo_ids[array_position(v_refs,r)] order by r) into v_apoio_ids
      from unnest(v_refs) r where not(r=any(v_usadas));
    insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
      values(p_solicitacao_id,v_sol.status,v_sol.status,'Documento pós-compra adicionado como apoio, sem custo financeiro.',auth.uid());
    insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
      values('documento_pos_compra_sem_custo',p_solicitacao_id,jsonb_build_object('operacao_id',p_operacao_id,'payload_fingerprint',v_fingerprint,'anexo_ids',to_jsonb(v_apoio_ids),'hashes_declarados_pelo_cliente',(select jsonb_agg(conteudo_sha256 order by id) from public.ro_passagem_anexos where id=any(v_apoio_ids)),'registrado_em',now()),auth.uid());
  end if;

  v_resultado:=jsonb_build_object('operacao_id',p_operacao_id,'payload_fingerprint',v_fingerprint,'anexo_ids',to_jsonb(v_anexo_ids),'grupos',jsonb_array_length(v_grupos),'idempotent_replay',false);
  update public.ro_passagem_operacoes_idempotentes set status='concluida',resultado=v_resultado,concluido_em=now()
    where solicitacao_id=p_solicitacao_id and operacao_id=p_operacao_id;
  return v_resultado;
exception when unique_violation then raise exception 'DOCUMENTO_OU_PASSAGEM_JA_REGISTRADO';
end $$;

revoke all on function public.ro_normalizar_compra_chave(text),public.ro_validar_anexo_custo_mesma_solicitacao() from public,anon,authenticated;
revoke all on function public.ro_registrar_documentos_pos_compra(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.ro_registrar_documentos_pos_compra(uuid,uuid,jsonb,jsonb) to authenticated;

commit;
