begin;

alter table public.ro_passagem_custos
  add column if not exists passagem_complementar boolean not null default false;

alter table public.ro_passagem_custos
  drop constraint if exists ro_passagem_custos_complementar_tipo_check;
alter table public.ro_passagem_custos
  add constraint ro_passagem_custos_complementar_tipo_check
  check(not passagem_complementar or tipo='passagem');

-- O prefixo abaixo sempre foi escrito pelo backend do fluxo complementar.
-- O anexo complementar na mesma solicitação evita classificar descrições isoladas.
update public.ro_passagem_custos c
set passagem_complementar=true
where c.tipo='passagem'
  and c.descricao like 'Passagem complementar: %'
  and exists(
    select 1 from public.ro_passagem_anexos a
    where a.solicitacao_id=c.solicitacao_id and a.complementar=true
  );

-- Desde 202608210001 o histórico oficial persiste ambos os UUIDs. O vínculo só
-- é preenchido quando cada ID forma um par único, válido e da mesma solicitação.
with historico_ids as(
  select distinct h.solicitacao_id,
    ((regexp_match(h.descricao,'^Passagem complementar registrada\. Anexo: ([0-9a-fA-F-]{36})\. Caminho: .*\. Custo: ([0-9a-fA-F-]{36})\. Justificativa:'))[1])::uuid anexo_id,
    ((regexp_match(h.descricao,'^Passagem complementar registrada\. Anexo: ([0-9a-fA-F-]{36})\. Caminho: .*\. Custo: ([0-9a-fA-F-]{36})\. Justificativa:'))[2])::uuid custo_id
  from public.ro_passagem_historico h
  where h.descricao~'^Passagem complementar registrada\. Anexo: [0-9a-fA-F-]{36}\. Caminho: .*\. Custo: [0-9a-fA-F-]{36}\. Justificativa:'
),validos as(
  select h.solicitacao_id,h.anexo_id,h.custo_id
  from historico_ids h
  join public.ro_passagem_anexos a on a.id=h.anexo_id and a.solicitacao_id=h.solicitacao_id
    and a.complementar=true and a.custo_id is null
  join public.ro_passagem_custos c on c.id=h.custo_id and c.solicitacao_id=h.solicitacao_id
    and c.tipo='passagem' and c.passagem_complementar=true
),inequivocos as(
  select v.*
  from validos v
  where (select count(*) from validos x where x.anexo_id=v.anexo_id)=1
    and (select count(*) from validos x where x.custo_id=v.custo_id)=1
)
update public.ro_passagem_anexos a
set custo_id=i.custo_id
from inequivocos i
where a.id=i.anexo_id and a.solicitacao_id=i.solicitacao_id and a.custo_id is null;

create or replace function public.ro_registrar_passagem_complementar(
  p_solicitacao_id uuid,p_anexos jsonb,p_imprevisto boolean,
  p_motivo_complementar text,p_custos_adicionais jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare
  s public.ro_passagem_solicitacoes%rowtype;i jsonb;v_path text;v_cc uuid;
  v_valor numeric(12,2);v_anexo uuid;v_custo uuid;v_motivo text;
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
  if not public.ro_is_denise(auth.uid()) then raise exception 'PASSAGEM_COMPLEMENTAR_EXCLUSIVA_DENISE';end if;
  v_motivo:=btrim(regexp_replace(coalesce(p_motivo_complementar,''),'\s+',' ','g'));
  if char_length(v_motivo)<10 then raise exception 'JUSTIFICATIVA_COMPLEMENTO_MINIMO_10_CARACTERES';end if;
  if jsonb_array_length(coalesce(p_anexos,'[]'::jsonb))=0 then raise exception 'ANEXO_COMPLEMENTAR_OBRIGATORIO';end if;
  select * into s from public.ro_passagem_solicitacoes
   where id=p_solicitacao_id and excluida_em is null for update;
  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
  if s.status not in('passagem_comprada','finalizada') then raise exception 'COMPLEMENTO_EXIGE_PASSAGEM_COMPRADA_OU_FINALIZADA';end if;

  for i in select value from jsonb_array_elements(p_anexos) loop
    v_path:=i->>'storage_path';
    if v_path is null or v_path not like p_solicitacao_id::text||'/complementares/%' then raise exception 'STORAGE_PATH_COMPLEMENTAR_INVALIDO';end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='ro-passagem-anexos' and o.name=v_path and o.owner_id::text=auth.uid()::text)
      then raise exception 'ARQUIVO_INEXISTENTE_OU_NAO_PERTENCE_A_DENISE';end if;
    if exists(select 1 from public.ro_passagem_anexos a where a.storage_path=v_path) then raise exception 'ARQUIVO_JA_VINCULADO';end if;
    v_cc:=nullif(i->>'centro_custo_id','')::uuid;
    if v_cc is null or not(v_cc is not distinct from s.obra_id or v_cc is not distinct from s.centro_custo_destino_id or v_cc is not distinct from s.centro_custo_retorno_id)
      or not exists(select 1 from public.obras o where o.id=v_cc and o.visivel_passagens and o.escopo_passagens in('comum','restrito_ro'))
      then raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';end if;
    v_valor:=case when nullif(i->>'valor','') is null then null else round((i->>'valor')::numeric,2) end;
    if v_valor is not null and(v_valor<0.01 or v_valor>9999999999.99) then raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';end if;

    insert into public.ro_passagem_anexos(solicitacao_id,tipo,nome_arquivo,storage_path,mime_type,tamanho_bytes,uploaded_by,partida_em,valor,observacao,complementar,imprevisto,motivo_complementar,criado_por)
    values(p_solicitacao_id,'passagem_pdf',i->>'nome_arquivo',v_path,i->>'mime_type',(i->>'tamanho_bytes')::bigint,auth.uid(),nullif(i->>'partida_em','')::timestamptz,v_valor,nullif(i->>'observacao',''),true,coalesce(p_imprevisto,false),v_motivo,auth.uid()) returning id into v_anexo;
    v_custo:=null;
    if v_valor is not null then
      insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by,passagem_complementar)
      values(p_solicitacao_id,'passagem','Passagem complementar: '||(i->>'nome_arquivo'),v_valor,v_cc,auth.uid(),true)
      returning id into v_custo;
      update public.ro_passagem_anexos set custo_id=v_custo where id=v_anexo and solicitacao_id=p_solicitacao_id and custo_id is null;
    end if;
    insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
    values(p_solicitacao_id,s.status,s.status,format('Passagem complementar registrada. Anexo: %s. Caminho: %s. Custo: %s. Justificativa: %s',v_anexo,v_path,coalesce(v_custo::text,'sem valor'),v_motivo),auth.uid());
  end loop;

  for i in select value from jsonb_array_elements(coalesce(p_custos_adicionais,'[]'::jsonb)) loop
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
end $$;

revoke all on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb) from public,anon;
grant execute on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb) to authenticated;

commit;
