begin;
-- FASE 1: expansão retrocompatível. Aplicar antes do frontend novo.
alter table public.ro_passagem_solicitacoes
 add column if not exists excluida_em timestamptz,
 add column if not exists excluida_por uuid references auth.users(id) on delete set null,
 add column if not exists motivo_exclusao text;
do $$ begin alter table public.ro_passagem_solicitacoes add constraint ro_motivo_exclusao_tamanho_ck check(motivo_exclusao is null or char_length(motivo_exclusao)<=500);exception when duplicate_object then null;end $$;
create index if not exists ro_solicitacoes_excluidas_idx on public.ro_passagem_solicitacoes(excluida_em desc) where excluida_em is not null;
drop policy if exists ro_sol_select on public.ro_passagem_solicitacoes;
create policy ro_sol_select on public.ro_passagem_solicitacoes for select to authenticated using(
 (excluida_em is null and(solicitante_id=auth.uid() or public.ro_can_view_all() or(public.ro_is_rh_active() and origem_solicitacao='rh')))
 or(excluida_em is not null and public.ro_can_operate()));

create or replace function public.ro_excluir_solicitacao(p_solicitacao_id uuid,p_motivo text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;v_motivo text;begin
 if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
 if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_FUNCIONARIO_RO_PODE_EXCLUIR';end if;
 v_motivo:=nullif(btrim(regexp_replace(coalesce(p_motivo,''),'\s+',' ','g')),'');
 if v_motivo is null then raise exception 'MOTIVO_EXCLUSAO_OBRIGATORIO';end if;
 if char_length(v_motivo)>500 then raise exception 'MOTIVO_EXCLUSAO_MAXIMO_500_CARACTERES';end if;
 select status into v_status from public.ro_passagem_solicitacoes where id=p_solicitacao_id and excluida_em is null for update;
 if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA_OU_JA_EXCLUIDA';end if;
 update public.ro_passagem_solicitacoes set excluida_em=now(),excluida_por=auth.uid(),motivo_exclusao=v_motivo where id=p_solicitacao_id;
 insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
 values(p_solicitacao_id,v_status,v_status,'Solicitação excluída do fluxo pelo RO. Motivo: '||v_motivo,auth.uid());
end $$;
revoke all on function public.ro_excluir_solicitacao(uuid,text) from public,anon;
grant execute on function public.ro_excluir_solicitacao(uuid,text) to authenticated;

create or replace function public.ro_atualizar_custo_operacional(p_solicitacao_id uuid,p_custo_id uuid,p_novo_valor numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;v_custo public.ro_passagem_custos%rowtype;v_total numeric(12,2);v_tipo_label text;v_valor numeric(12,2);begin
 if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
 if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_EDITAR_CUSTOS';end if;
 if p_novo_valor is null or p_novo_valor::text in('NaN','Infinity','-Infinity') then raise exception 'VALOR_CUSTO_INVALIDO';end if;
 v_valor:=round(p_novo_valor,2);if v_valor<0.01 or v_valor>9999999999.99 then raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';end if;
 select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
 if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
 if v_sol.excluida_em is not null or v_sol.status in('cancelada','recusada') then raise exception 'SOLICITACAO_NAO_PERMITE_EDICAO_DE_CUSTO';end if;
 select * into v_custo from public.ro_passagem_custos where id=p_custo_id and solicitacao_id=p_solicitacao_id for update;
 if not found then raise exception 'CUSTO_NAO_PERTENCE_A_SOLICITACAO';end if;
 if v_custo.tipo not in('passagem','hospedagem','uber','refeicao','outros') then raise exception 'TIPO_CUSTO_NAO_EDITAVEL';end if;
 update public.ro_passagem_custos set valor=v_valor where id=v_custo.id;
 v_tipo_label:=case v_custo.tipo when 'passagem' then 'Passagem' when 'hospedagem' then 'Hospedagem' when 'uber' then 'Uber' when 'refeicao' then 'Refeição' else 'Outros' end;
 insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
 values(p_solicitacao_id,v_sol.status,v_sol.status,format('%s atualizado de R$ %s para R$ %s.',v_tipo_label,replace(to_char(v_custo.valor,'FM999999990D00'),'.',','),replace(to_char(v_valor,'FM999999990D00'),'.',',')),auth.uid());
 select coalesce(sum(valor),0) into v_total from public.ro_passagem_custos where solicitacao_id=p_solicitacao_id;
 return jsonb_build_object('custo_id',v_custo.id,'tipo',v_custo.tipo,'valor_anterior',v_custo.valor,'valor_novo',v_valor,'total',v_total);
end $$;
revoke all on function public.ro_atualizar_custo_operacional(uuid,uuid,numeric) from public,anon;
grant execute on function public.ro_atualizar_custo_operacional(uuid,uuid,numeric) to authenticated;

-- Nova assinatura; a antiga permanece em paralelo até a Fase 2.
create or replace function public.ro_registrar_passagem_complementar(p_solicitacao_id uuid,p_anexos jsonb,p_imprevisto boolean,p_motivo_complementar text,p_custos_adicionais jsonb)
returns void language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;v_item jsonb;v_path text;v_centro uuid;v_valor numeric(12,2);v_anexo uuid;begin
 if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
 if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_ADICIONAR_COMPLEMENTO';end if;
 if nullif(btrim(p_motivo_complementar),'') is null then raise exception 'MOTIVO_COMPLEMENTAR_OBRIGATORIO';end if;
 select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id and excluida_em is null for update;
 if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
 if v_sol.status not in('passagem_comprada','finalizada') then raise exception 'COMPLEMENTO_EXIGE_PASSAGEM_COMPRADA_OU_FINALIZADA';end if;
 for v_item in select value from jsonb_array_elements(coalesce(p_anexos,'[]'::jsonb)) loop
  v_path:=v_item->>'storage_path';
  if v_path is null or v_path not like p_solicitacao_id::text||'/%' then raise exception 'STORAGE_PATH_FORA_DA_SOLICITACAO';end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='ro-passagem-anexos' and o.name=v_path and o.owner_id::text=auth.uid()::text)
   then raise exception 'ARQUIVO_INEXISTENTE_OU_NAO_PERTENCE_AO_USUARIO';end if;
  if exists(select 1 from public.ro_passagem_anexos a where a.storage_path=v_path and a.solicitacao_id<>p_solicitacao_id)
   then raise exception 'ARQUIVO_JA_VINCULADO_A_OUTRA_SOLICITACAO';end if;
  v_centro:=nullif(v_item->>'centro_custo_id','')::uuid;
  if v_centro is null or not(v_centro is not distinct from v_sol.obra_id or v_centro is not distinct from v_sol.centro_custo_destino_id or v_centro is not distinct from v_sol.centro_custo_retorno_id)
   or not exists(select 1 from public.obras o where o.id=v_centro and o.visivel_passagens and o.escopo_passagens in('comum','restrito_ro'))
   then raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';end if;
  v_valor:=case when nullif(v_item->>'valor','') is null then null else round((v_item->>'valor')::numeric,2) end;
  if v_valor is not null and(v_valor<0.01 or v_valor>9999999999.99) then raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';end if;
  insert into public.ro_passagem_anexos(solicitacao_id,tipo,nome_arquivo,storage_path,mime_type,tamanho_bytes,uploaded_by,partida_em,valor,observacao,complementar,imprevisto,motivo_complementar,criado_por)
  values(p_solicitacao_id,'passagem_pdf',v_item->>'nome_arquivo',v_path,v_item->>'mime_type',(v_item->>'tamanho_bytes')::bigint,auth.uid(),nullif(v_item->>'partida_em','')::timestamptz,v_valor,nullif(v_item->>'observacao',''),true,coalesce(p_imprevisto,false),btrim(p_motivo_complementar),auth.uid()) returning id into v_anexo;
  if v_valor is not null then insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by)
   values(p_solicitacao_id,'passagem','Passagem complementar: '||(v_item->>'nome_arquivo'),v_valor,v_centro,auth.uid());end if;
 end loop;
 for v_item in select value from jsonb_array_elements(coalesce(p_custos_adicionais,'[]'::jsonb)) loop
  if v_item->>'tipo' not in('uber','refeicao','outros') then raise exception 'TIPO_CUSTO_ADICIONAL_INVALIDO';end if;
  v_centro:=nullif(v_item->>'centro_custo_id','')::uuid;
  if v_centro is null or not(v_centro is not distinct from v_sol.obra_id or v_centro is not distinct from v_sol.centro_custo_destino_id or v_centro is not distinct from v_sol.centro_custo_retorno_id)
   or not exists(select 1 from public.obras o where o.id=v_centro and o.visivel_passagens and o.escopo_passagens in('comum','restrito_ro'))
   then raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';end if;
  v_valor:=round(coalesce(nullif(v_item->>'valor','')::numeric,0),2);
  if v_valor<0.01 or v_valor>9999999999.99 then raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';end if;
  insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by)
  values(p_solicitacao_id,v_item->>'tipo',coalesce(nullif(v_item->>'descricao',''),'Complemento: '||(v_item->>'tipo')),v_valor,v_centro,auth.uid());
 end loop;
 insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
 values(p_solicitacao_id,v_sol.status,v_sol.status,'Passagem/valor complementar adicionado: '||btrim(p_motivo_complementar),auth.uid());
end $$;
revoke all on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb) from public,anon;
grant execute on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb) to authenticated;

create or replace function public.ro_registrar_passagem_complementar(p_solicitacao_id uuid,p_anexos jsonb,p_imprevisto boolean,p_motivo_complementar text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_anexos jsonb;v_centro uuid;begin
 select s.obra_id into v_centro from public.ro_passagem_solicitacoes s where s.id=p_solicitacao_id;
 select coalesce(jsonb_agg(value||jsonb_build_object('centro_custo_id',coalesce(nullif(value->>'centro_custo_id','')::uuid,v_centro))), '[]'::jsonb)
 into v_anexos from jsonb_array_elements(coalesce(p_anexos,'[]'::jsonb));
 perform public.ro_registrar_passagem_complementar(p_solicitacao_id,v_anexos,p_imprevisto,p_motivo_complementar,'[]'::jsonb);
end;
$$;
revoke all on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text) from public,anon;
grant execute on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text) to authenticated;

drop policy if exists ro_storage_insert on storage.objects;
create policy ro_storage_insert on storage.objects for insert to authenticated with check(bucket_id='ro-passagem-anexos' and owner_id::text=auth.uid()::text and public.ro_can_operate() and exists(
 select 1 from public.ro_passagem_solicitacoes s where s.id::text=(storage.foldername(name))[1] and s.excluida_em is null
 and s.status in('em_andamento','passagem_comprada','finalizada') and s.folga_antecipacao_status is distinct from 'pendente'));

create or replace function public.ro_relatorio_centros_custo(
 p_inicio date default null,p_fim date default null,p_centro_custo_id uuid default null,
 p_sem_centro boolean default false,p_status text default null,p_motivo text default null,p_responsavel_ro_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_resultado jsonb;begin
 if not public.ro_can_view_all() then raise exception 'Acesso restrito a diretores, gerentes e equipe RO ativa';end if;
 if p_inicio is not null and p_fim is not null and p_inicio>p_fim then raise exception 'Período inicial não pode ser posterior ao período final';end if;
 with base as(
  select s.* from public.ro_passagem_solicitacoes s
  where s.excluida_em is null
   and(p_inicio is null or s.created_at>=p_inicio::timestamptz)
   and(p_fim is null or s.created_at<(p_fim+1)::timestamptz)
   and(p_status is null or s.status=p_status) and(p_motivo is null or s.motivo=p_motivo)
   and(p_responsavel_ro_id is null or s.responsavel_ro_id=p_responsavel_ro_id)
   and((p_centro_custo_id is null and not p_sem_centro)
    or(not p_sem_centro and(s.obra_id=p_centro_custo_id or exists(select 1 from public.ro_passagem_custos cf where cf.solicitacao_id=s.id and coalesce(cf.centro_custo_id,s.obra_id)=p_centro_custo_id)))
    or(p_sem_centro and(s.obra_id is null or exists(select 1 from public.ro_passagem_custos cf where cf.solicitacao_id=s.id and coalesce(cf.centro_custo_id,s.obra_id) is null))))
 ),operacional as(
  select s.obra_id centro_custo_id,count(*)::integer solicitacoes,
   count(*) filter(where s.comprado_em is not null)::integer compradas,
   count(*) filter(where s.status not in('passagem_comprada','finalizada','cancelada'))::integer abertas,
   count(*) filter(where s.status in('em_analise','em_andamento'))::integer aguardando_compra,
   count(*) filter(where s.status not in('passagem_comprada','finalizada','cancelada') and s.data_ida<=current_date+case when s.motivo in('ferias','folga_campo') then 2 else 0 end)::integer atrasadas,
   count(*) filter(where s.houve_imprevisto or exists(select 1 from public.ro_passagem_anexos a where a.solicitacao_id=s.id and(a.complementar or a.imprevisto)))::integer imprevistos
  from base s where(p_centro_custo_id is null and not p_sem_centro) or(not p_sem_centro and s.obra_id=p_centro_custo_id) or(p_sem_centro and s.obra_id is null) group by s.obra_id
 ),financeiro as(
  select coalesce(c.centro_custo_id,s.obra_id) centro_custo_id,coalesce(sum(c.valor),0)::numeric valor_total,
   coalesce(sum(c.valor) filter(where c.descricao ilike 'Passagem complementar:%'),0)::numeric valor_complementar
  from base s join public.ro_passagem_custos c on c.solicitacao_id=s.id
  where(p_centro_custo_id is null and not p_sem_centro) or(not p_sem_centro and coalesce(c.centro_custo_id,s.obra_id)=p_centro_custo_id) or(p_sem_centro and coalesce(c.centro_custo_id,s.obra_id) is null)
  group by coalesce(c.centro_custo_id,s.obra_id)
 ),centros_relatorio as(select centro_custo_id from operacional union select centro_custo_id from financeiro),grupos as(
  select cr.centro_custo_id,coalesce(op.solicitacoes,0) solicitacoes,coalesce(op.compradas,0) compradas,
   coalesce(op.abertas,0) abertas,coalesce(op.aguardando_compra,0) aguardando_compra,coalesce(op.atrasadas,0) atrasadas,
   coalesce(op.imprevistos,0) imprevistos,coalesce(fi.valor_total,0) valor_total,coalesce(fi.valor_complementar,0) valor_complementar
  from centros_relatorio cr left join operacional op on op.centro_custo_id is not distinct from cr.centro_custo_id
  left join financeiro fi on fi.centro_custo_id is not distinct from cr.centro_custo_id)
 select jsonb_build_object(
  'linhas',coalesce((select jsonb_agg(jsonb_build_object('centro_custo_id',g.centro_custo_id,'codigo',o.codigo,'nome',o.nome,'descricao',o.descricao,'solicitacoes',g.solicitacoes,'compradas',g.compradas,'abertas',g.abertas,'aguardando_compra',g.aguardando_compra,'atrasadas',g.atrasadas,'imprevistos',g.imprevistos,'valor_total',g.valor_total,'valor_complementar',g.valor_complementar)) from grupos g left join public.obras o on o.id=g.centro_custo_id),'[]'::jsonb),
  'centros',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'codigo',o.codigo,'nome',o.nome,'descricao',o.descricao) order by lower(coalesce(o.codigo,'')),lower(coalesce(o.nome,o.descricao,''))) from public.obras o),'[]'::jsonb),
  'responsaveis',coalesce((select jsonb_agg(jsonb_build_object('id',ids.id,'nome',coalesce(up.full_name,'Responsável sem identificação')) order by lower(coalesce(up.full_name,''))) from(select distinct responsavel_ro_id id from public.ro_passagem_solicitacoes where responsavel_ro_id is not null and excluida_em is null union select user_id from public.ro_responsaveis where ativo)ids left join public.users_profiles up on up.id=ids.id),'[]'::jsonb),
  'resumo',jsonb_build_object('solicitacoes',(select count(*) from base),'compradas',(select count(*) from base where comprado_em is not null),'abertas',(select count(*) from base where status not in('passagem_comprada','finalizada','cancelada')),
   'imprevistos',(select count(*) from base s where s.houve_imprevisto or exists(select 1 from public.ro_passagem_anexos a where a.solicitacao_id=s.id and(a.complementar or a.imprevisto))),
   'valor_total',(select coalesce(sum(c.valor),0) from base s join public.ro_passagem_custos c on c.solicitacao_id=s.id where(p_centro_custo_id is null and not p_sem_centro) or(not p_sem_centro and coalesce(c.centro_custo_id,s.obra_id)=p_centro_custo_id) or(p_sem_centro and coalesce(c.centro_custo_id,s.obra_id) is null)),
   'valor_complementar',(select coalesce(sum(c.valor),0) from base s join public.ro_passagem_custos c on c.solicitacao_id=s.id where c.descricao ilike 'Passagem complementar:%' and((p_centro_custo_id is null and not p_sem_centro) or(not p_sem_centro and coalesce(c.centro_custo_id,s.obra_id)=p_centro_custo_id) or(p_sem_centro and coalesce(c.centro_custo_id,s.obra_id) is null))))) into v_resultado;
 return v_resultado;
end $$;
revoke all on function public.ro_relatorio_centros_custo(date,date,uuid,boolean,text,text,uuid) from public,anon;
grant execute on function public.ro_relatorio_centros_custo(date,date,uuid,boolean,text,text,uuid) to authenticated;

-- Finalização manual: somente RO ativo, e nunca em registro excluído.
create or replace function public.ro_finalizar_solicitacao(p_solicitacao_id uuid,p_chegou_ao_destino boolean,p_data_chegada_confirmada date,p_houve_imprevisto boolean,p_observacao_finalizacao text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_anterior text;begin
 if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
 if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_RESPONSAVEL_RO_ATIVO_PODE_FINALIZAR';end if;
 if p_chegou_ao_destino is not true then raise exception 'FUNCIONARIO_AINDA_NAO_CHEGOU_AO_DESTINO';end if;
 if p_houve_imprevisto and nullif(btrim(p_observacao_finalizacao),'') is null then raise exception 'OBSERVACAO_FINALIZACAO_OBRIGATORIA';end if;
 select status into v_anterior from public.ro_passagem_solicitacoes where id=p_solicitacao_id and excluida_em is null for update;
 if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
 if v_anterior<>'passagem_comprada' then raise exception 'SOMENTE_PASSAGEM_COMPRADA_PODE_SER_FINALIZADA';end if;
 update public.ro_passagem_solicitacoes set status='finalizada',chegou_ao_destino=p_chegou_ao_destino,
  data_chegada_confirmada=p_data_chegada_confirmada::timestamptz,houve_imprevisto=p_houve_imprevisto,
  observacao_finalizacao=nullif(btrim(p_observacao_finalizacao),''),finalizado_por=auth.uid(),finalizado_em=now() where id=p_solicitacao_id;
 insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
 values(p_solicitacao_id,v_anterior,'finalizada','Chegada ao destino registrada e solicitação finalizada.',auth.uid());
end $$;
revoke all on function public.ro_finalizar_solicitacao(uuid,boolean,date,boolean,text) from public,anon;
grant execute on function public.ro_finalizar_solicitacao(uuid,boolean,date,boolean,text) to authenticated;

create or replace function public.ro_auto_finalizar_solicitacoes()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item record;v_total integer:=0;v_mensagem constant text:='Solicitação finalizada automaticamente um dia após a última passagem comprada, sem registro de imprevisto, complementar pendente ou nova compra.';begin
 if auth.uid() is null or not public.ro_can_view_all(auth.uid()) then raise exception 'Apenas diretor, gerente ou responsável RO ativo pode executar esta rotina.';end if;
 for v_item in with viagens as(
  select s.id,coalesce(max(a.partida_em) filter(where a.partida_em is not null),case when exists(select 1 from public.ro_passagem_custos c where c.solicitacao_id=s.id and c.tipo='passagem' and c.valor>0) then s.partida_em end) ultima_partida
  from public.ro_passagem_solicitacoes s left join public.ro_passagem_anexos a on a.solicitacao_id=s.id
  where s.excluida_em is null and s.status='passagem_comprada' and coalesce(s.houve_imprevisto,false)=false
   and not exists(select 1 from public.ro_passagem_anexos pendente where pendente.solicitacao_id=s.id and(pendente.imprevisto or(pendente.complementar and pendente.partida_em is null)))
  group by s.id,s.partida_em)
  select id,ultima_partida from viagens where ultima_partida is not null and current_date>(ultima_partida at time zone 'America/Sao_Paulo')::date
 loop
  update public.ro_passagem_solicitacoes set status='finalizada',chegou_ao_destino=true,data_chegada_confirmada=v_item.ultima_partida,
   houve_imprevisto=false,observacao_finalizacao=v_mensagem,finalizado_por=auth.uid(),finalizado_em=now()
  where id=v_item.id and excluida_em is null and status='passagem_comprada';
  if found then
   insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
   select v_item.id,'passagem_comprada','finalizada',v_mensagem,auth.uid() where not exists(select 1 from public.ro_passagem_historico h where h.solicitacao_id=v_item.id and h.status_novo='finalizada' and h.descricao=v_mensagem);
   v_total:=v_total+1;
  end if;
 end loop;
 return v_total;
end $$;
revoke all on function public.ro_auto_finalizar_solicitacoes() from public,anon;
grant execute on function public.ro_auto_finalizar_solicitacoes() to authenticated;
commit;
