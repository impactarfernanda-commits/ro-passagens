begin;

-- Fase 1: infraestrutura compatível. As RPCs antigas continuam disponíveis.
create or replace function public.ro_data_compra_segura(p_valor text)
returns date language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if p_valor is null or p_valor !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return left(p_valor,10)::date;
exception when others then return null;
end $$;

create or replace function public.ro_normalizar_local_compra(p_valor text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select btrim(regexp_replace(translate(lower(coalesce(p_valor,'')),
    'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'\s+',' ','g'));
$$;

create or replace function public.ro_locais_equivalentes_compra(p_a text,p_b text)
returns boolean language sql immutable set search_path=public,pg_temp as $$
  with locais as (select public.ro_normalizar_local_compra(p_a) a,public.ro_normalizar_local_compra(p_b) b),
  partes as (select a,b,regexp_replace(a,'\s*/\s*[a-z]{2}$','') cidade_a,
    regexp_replace(b,'\s*/\s*[a-z]{2}$','') cidade_b,a~'\s*/\s*[a-z]{2}$' tem_uf_a,b~'\s*/\s*[a-z]{2}$' tem_uf_b from locais)
  select a<>'' and b<>'' and (a=b or (cidade_a=cidade_b and (not tem_uf_a or not tem_uf_b))) from partes;
$$;

create or replace function public.ro_divergencias_data_validas(p_valor jsonb)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare v_item jsonb;v_solicitada date;v_comprada date;
begin
  if p_valor is null or jsonb_typeof(p_valor)<>'array' then return false;end if;
  for v_item in select value from jsonb_array_elements(p_valor) loop
    if jsonb_typeof(v_item)<>'object' or coalesce(v_item->>'sentido','') not in('ida','retorno') then return false;end if;
    v_solicitada:=public.ro_data_compra_segura(v_item->>'data_solicitada');
    v_comprada:=public.ro_data_compra_segura(v_item->>'data_comprada');
    if v_solicitada is null or v_comprada is null or v_solicitada=v_comprada then return false;end if;
    if char_length(btrim(coalesce(v_item->>'justificativa','')))<10 then return false;end if;
  end loop;
  return true;
end $$;

create table if not exists public.ro_resolucao_operacional (
  solicitacao_id uuid primary key references public.ro_passagem_solicitacoes(id) on delete cascade,
  hospedagem_utilizada boolean,hospedagem_justificativa text,
  hospedagem_confirmado_por uuid references auth.users(id),hospedagem_confirmado_em timestamptz,
  divergencias_data jsonb not null default '[]'::jsonb,
  data_confirmado_por uuid references auth.users(id),data_confirmado_em timestamptz,
  constraint ro_resolucao_hospedagem_ck check (
    (hospedagem_utilizada is null and hospedagem_justificativa is null and hospedagem_confirmado_por is null and hospedagem_confirmado_em is null)
    or (hospedagem_utilizada=true and hospedagem_justificativa is null and hospedagem_confirmado_por is not null and hospedagem_confirmado_em is not null)
    or (hospedagem_utilizada=false and char_length(btrim(hospedagem_justificativa))>=10 and hospedagem_confirmado_por is not null and hospedagem_confirmado_em is not null)),
  constraint ro_resolucao_datas_ck check (public.ro_divergencias_data_validas(divergencias_data)
    and ((jsonb_array_length(divergencias_data)=0 and data_confirmado_por is null and data_confirmado_em is null)
      or (jsonb_array_length(divergencias_data)>0 and data_confirmado_por is not null and data_confirmado_em is not null)))
);

alter table public.ro_resolucao_operacional enable row level security;
revoke all on table public.ro_resolucao_operacional from public,anon;
grant select on table public.ro_resolucao_operacional to authenticated;
drop policy if exists ro_resolucao_select on public.ro_resolucao_operacional;
create policy ro_resolucao_select on public.ro_resolucao_operacional for select to authenticated using(
  exists(select 1 from public.ro_passagem_solicitacoes s where s.id=solicitacao_id));

create or replace function public.ro_resolver_hospedagem(p_solicitacao_id uuid,p_hospedagem_utilizada boolean,p_valor_total numeric default null,p_justificativa text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;v_centro_custo uuid;v_justificativa text:=nullif(btrim(coalesce(p_justificativa,'')),'');
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
  if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_REGISTRAR_HOSPEDAGEM';end if;
  select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
  if not v_sol.necessita_hospedagem then raise exception 'HOSPEDAGEM_NAO_SOLICITADA';end if;
  if v_sol.status in('cancelada','recusada') then raise exception 'SOLICITACAO_NAO_PERMITE_HOSPEDAGEM';end if;
  if p_hospedagem_utilizada is null then raise exception 'DECISAO_HOSPEDAGEM_OBRIGATORIA';end if;
  if p_hospedagem_utilizada and (p_valor_total is null or p_valor_total::text in('NaN','Infinity','-Infinity') or p_valor_total<=0) then raise exception 'VALOR_HOSPEDAGEM_INVALIDO';end if;
  if not p_hospedagem_utilizada and char_length(coalesce(v_justificativa,''))<10 then raise exception 'JUSTIFICATIVA_HOSPEDAGEM_MINIMO_10_CARACTERES';end if;
  if p_hospedagem_utilizada then
    select c.centro_custo_id into v_centro_custo from public.ro_passagem_custos c where c.solicitacao_id=p_solicitacao_id and c.centro_custo_id is not null order by(c.tipo='passagem')desc,c.created_at limit 1;
    v_centro_custo:=coalesce(v_centro_custo,v_sol.obra_id);
    insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by)
    values(p_solicitacao_id,'hospedagem','Hospedagem',p_valor_total,v_centro_custo,auth.uid())
    on conflict(solicitacao_id) where tipo='hospedagem' do update set valor=excluded.valor,centro_custo_id=excluded.centro_custo_id,created_by=auth.uid();
  else delete from public.ro_passagem_custos where solicitacao_id=p_solicitacao_id and tipo='hospedagem';end if;
  insert into public.ro_resolucao_operacional(solicitacao_id,hospedagem_utilizada,hospedagem_justificativa,hospedagem_confirmado_por,hospedagem_confirmado_em)
  values(p_solicitacao_id,p_hospedagem_utilizada,case when p_hospedagem_utilizada then null else v_justificativa end,auth.uid(),now())
  on conflict(solicitacao_id) do update set hospedagem_utilizada=excluded.hospedagem_utilizada,hospedagem_justificativa=excluded.hospedagem_justificativa,hospedagem_confirmado_por=excluded.hospedagem_confirmado_por,hospedagem_confirmado_em=excluded.hospedagem_confirmado_em;
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('hospedagem_resolvida',p_solicitacao_id,jsonb_build_object('hospedagem_solicitada',true,'hospedagem_utilizada',p_hospedagem_utilizada,'justificativa',case when p_hospedagem_utilizada then null else v_justificativa end,'valor',case when p_hospedagem_utilizada then p_valor_total else null end,'confirmado_em',now()),auth.uid());
  insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por) values(p_solicitacao_id,v_sol.status,v_sol.status,case when p_hospedagem_utilizada then 'Hospedagem contratada registrada.' else 'Hospedagem prevista dispensada: '||v_justificativa end,auth.uid());
end $$;

create or replace function public.ro_registrar_compra_v2(
  p_solicitacao_id uuid,p_tipo_transporte text,p_companhia text,p_localizador text,p_origem_comprada text,p_destino_comprado text,
  p_partida_em timestamptz,p_chegada_em timestamptz,p_observacoes_ro text,p_custos jsonb,p_horario_anterior_confirmado boolean,
  p_partida_horario_local time,p_trechos jsonb,p_data_divergente_confirmada boolean,p_data_divergente_justificativa text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;v_resolucao public.ro_resolucao_operacional%rowtype;v_anterior boolean;
  v_hospedagem public.ro_passagem_custos%rowtype;v_tinha_hospedagem boolean:=false;v_item jsonb;v_chaves text[]:=array[]::text[];v_chave text;
  v_total_trechos integer;v_datas_validas integer:=0;v_origem text;v_destino text;v_data date;v_sentido text;v_esperada date;
  v_divergencias jsonb:='[]'::jsonb;v_justificativa text:=nullif(btrim(coalesce(p_data_divergente_justificativa,'')),'');
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
  if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_REGISTRAR_COMPRAS';end if;
  if p_custos is not null and jsonb_typeof(p_custos)<>'array' then raise exception 'CUSTOS_DEVEM_SER_LISTA';end if;
  if p_trechos is null or jsonb_typeof(p_trechos)<>'array' then raise exception 'TRECHOS_DEVEM_SER_LISTA';end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_custos,'[]'::jsonb)) loop
    if v_item->>'tipo'='passagem' then v_chave:=nullif(btrim(v_item->>'compra_chave'),'');
      if v_chave is null then raise exception 'IDENTIDADE_COMPRA_PASSAGEM_OBRIGATORIA';end if;
      if char_length(v_chave)>300 then raise exception 'IDENTIDADE_COMPRA_PASSAGEM_INVALIDA';end if;
      if v_chave=any(v_chaves) then raise exception 'CUSTO_PASSAGEM_DUPLICADO_NA_MESMA_COMPRA';end if;
      v_chaves:=array_append(v_chaves,v_chave);end if;
  end loop;
  select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
  if v_sol.necessita_hospedagem then select * into v_resolucao from public.ro_resolucao_operacional where solicitacao_id=p_solicitacao_id;
    if not found or v_resolucao.hospedagem_utilizada is null then raise exception 'RESOLUCAO_HOSPEDAGEM_OBRIGATORIA';end if;
    if v_resolucao.hospedagem_utilizada and not exists(select 1 from public.ro_passagem_custos where solicitacao_id=p_solicitacao_id and tipo='hospedagem' and valor>0) then raise exception 'CUSTO_HOSPEDAGEM_OBRIGATORIO';end if;
    if not v_resolucao.hospedagem_utilizada and exists(select 1 from public.ro_passagem_custos where solicitacao_id=p_solicitacao_id and tipo='hospedagem') then raise exception 'HOSPEDAGEM_DISPENSADA_NAO_PODE_TER_CUSTO';end if;end if;
  if v_sol.ida_a_partir_horario is not null and p_partida_em is not null and p_partida_horario_local is null then raise exception 'HORARIO_LOCAL_PARTIDA_OBRIGATORIO';end if;
  v_anterior:=v_sol.ida_a_partir_horario is not null and p_partida_horario_local is not null and p_partida_horario_local<v_sol.ida_a_partir_horario;
  if v_anterior and not coalesce(p_horario_anterior_confirmado,false) then raise exception 'CONFIRMACAO_HORARIO_ANTERIOR_OBRIGATORIA';end if;
  v_total_trechos:=jsonb_array_length(p_trechos);
  for v_item in select value from jsonb_array_elements(p_trechos) loop
    v_data:=public.ro_data_compra_segura(v_item->>'partida_em');if v_data is null then continue;end if;
    v_datas_validas:=v_datas_validas+1;v_origem:=v_item->>'origem';v_destino:=v_item->>'destino';v_sentido:=null;v_esperada:=null;
    if public.ro_locais_equivalentes_compra(v_origem,v_sol.origem) and public.ro_locais_equivalentes_compra(v_destino,v_sol.destino) then v_sentido:='ida';v_esperada:=v_sol.data_ida;
    elsif v_sol.data_retorno is not null and public.ro_locais_equivalentes_compra(v_origem,v_sol.destino) and public.ro_locais_equivalentes_compra(v_destino,v_sol.origem) then v_sentido:='retorno';v_esperada:=v_sol.data_retorno;
    elsif v_total_trechos=1 then v_sentido:='ida';v_esperada:=v_sol.data_ida;end if;
    if v_sentido is not null and v_data<>v_esperada then v_divergencias:=v_divergencias||jsonb_build_array(jsonb_build_object('sentido',v_sentido,'data_solicitada',v_esperada,'data_comprada',v_data,'justificativa',v_justificativa));end if;
  end loop;
  if v_datas_validas=0 and p_partida_em is not null then v_data:=(p_partida_em at time zone 'America/Sao_Paulo')::date;v_esperada:=v_sol.data_ida;
    if v_data<>v_esperada then v_divergencias:=jsonb_build_array(jsonb_build_object('sentido','ida','data_solicitada',v_esperada,'data_comprada',v_data,'justificativa',v_justificativa));end if;end if;
  if jsonb_array_length(v_divergencias)>0 and not coalesce(p_data_divergente_confirmada,false) then raise exception 'CONFIRMACAO_DATA_DIVERGENTE_OBRIGATORIA';end if;
  if jsonb_array_length(v_divergencias)>0 and char_length(coalesce(v_justificativa,''))<10 then raise exception 'JUSTIFICATIVA_DATA_DIVERGENTE_MINIMO_10_CARACTERES';end if;
  if not public.ro_divergencias_data_validas(v_divergencias) then raise exception 'DIVERGENCIAS_DATA_INVALIDAS';end if;
  select * into v_hospedagem from public.ro_passagem_custos where solicitacao_id=p_solicitacao_id and tipo='hospedagem';v_tinha_hospedagem:=found;
  perform public.ro_registrar_compra_pre_operacional(p_solicitacao_id,p_tipo_transporte,p_companhia,p_localizador,p_origem_comprada,p_destino_comprado,p_partida_em,p_chegada_em,p_observacoes_ro,p_custos);
  if v_tinha_hospedagem then insert into public.ro_passagem_custos(id,solicitacao_id,tipo,descricao,valor,created_at,created_by,centro_custo_id) values(v_hospedagem.id,v_hospedagem.solicitacao_id,v_hospedagem.tipo,v_hospedagem.descricao,v_hospedagem.valor,v_hospedagem.created_at,v_hospedagem.created_by,v_hospedagem.centro_custo_id);end if;
  if v_anterior then insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por) values(p_solicitacao_id,v_sol.status,'passagem_comprada',format('Compra confirmada com horário anterior ao solicitado. Horário mínimo: %s. Partida registrada: %s. Confirmado em: %s.',to_char(v_sol.ida_a_partir_horario,'HH24:MI'),to_char(p_partida_horario_local,'HH24:MI'),to_char(now(),'YYYY-MM-DD HH24:MI:SSOF')),auth.uid());end if;
  if jsonb_array_length(v_divergencias)>0 then
    insert into public.ro_resolucao_operacional(solicitacao_id,divergencias_data,data_confirmado_por,data_confirmado_em) values(p_solicitacao_id,v_divergencias,auth.uid(),now()) on conflict(solicitacao_id) do update set divergencias_data=excluded.divergencias_data,data_confirmado_por=excluded.data_confirmado_por,data_confirmado_em=excluded.data_confirmado_em;
    insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('data_passagem_divergente_confirmada',p_solicitacao_id,jsonb_build_object('divergencias',v_divergencias,'confirmado_em',now()),auth.uid());
    insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por) values(p_solicitacao_id,v_sol.status,'passagem_comprada','Compra confirmada com data diferente da solicitada. Justificativa: '||v_justificativa,auth.uid());
  else insert into public.ro_resolucao_operacional(solicitacao_id,divergencias_data) values(p_solicitacao_id,'[]'::jsonb) on conflict(solicitacao_id) do update set divergencias_data='[]'::jsonb,data_confirmado_por=null,data_confirmado_em=null;end if;
end $$;

revoke all on function public.ro_data_compra_segura(text),public.ro_normalizar_local_compra(text),public.ro_locais_equivalentes_compra(text,text),public.ro_divergencias_data_validas(jsonb) from public,anon,authenticated;
revoke all on function public.ro_resolver_hospedagem(uuid,boolean,numeric,text),public.ro_registrar_compra_v2(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.ro_resolver_hospedagem(uuid,boolean,numeric,text),public.ro_registrar_compra_v2(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time,jsonb,boolean,text) to authenticated;

-- As RPCs antigas permanecem intactas e executáveis durante a Fase 1.
commit;
