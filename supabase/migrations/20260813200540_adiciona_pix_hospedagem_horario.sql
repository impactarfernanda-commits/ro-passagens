begin;

alter table public.ro_passagem_solicitacoes
  add column pix_viajante text,
  add column necessita_hospedagem boolean not null default false,
  add column hospedagem_checkin date,
  add column hospedagem_checkout date,
  add column ida_a_partir_horario time without time zone;

alter table public.ro_passagem_solicitacoes
  add constraint ro_pix_viajante_preenchido_ck check (pix_viajante is null or btrim(pix_viajante) <> ''),
  add constraint ro_hospedagem_consistente_ck check (
    (necessita_hospedagem and hospedagem_checkin is not null and hospedagem_checkout is not null and hospedagem_checkout >= hospedagem_checkin)
    or (not necessita_hospedagem and hospedagem_checkin is null and hospedagem_checkout is null)
  );

create index ro_solicitacao_ultimo_pix_colaborador_idx on public.ro_passagem_solicitacoes(colaborador_id,created_at desc,id desc) where pix_viajante is not null and btrim(pix_viajante)<>'';
create index ro_solicitacao_ultimo_pix_funcionario_idx on public.ro_passagem_solicitacoes(funcionario_id,created_at desc,id desc) where pix_viajante is not null and btrim(pix_viajante)<>'';

create or replace function public.ro_ultimo_pix_viajante(p_colaborador_id uuid default null,p_funcionario_id uuid default null)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_pix text;v_funcionario_explicito uuid;
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
  if p_colaborador_id is null and p_funcionario_id is null then raise exception 'IDENTIDADE_EXPLICITA_OBRIGATORIA';end if;
  if p_colaborador_id is not null then
    select e.funcionario_id into v_funcionario_explicito from public.ro_funcionarios_enderecos_privados e where e.id=p_colaborador_id and e.ativo;
    if not found then raise exception 'COLABORADOR_INDISPONIVEL';end if;
    if p_funcionario_id is not null and v_funcionario_explicito is distinct from p_funcionario_id then raise exception 'IDENTIDADE_INCONSISTENTE';end if;
    select btrim(s.pix_viajante) into v_pix from public.ro_passagem_solicitacoes s where s.colaborador_id=p_colaborador_id and s.pix_viajante is not null and btrim(s.pix_viajante)<>'' order by s.created_at desc,s.id desc limit 1;
    if v_pix is not null then return v_pix;end if;
    p_funcionario_id:=v_funcionario_explicito;
  end if;
  if p_funcionario_id is not null then
    if not exists(select 1 from public.funcionarios f where f.id=p_funcionario_id and f.ativo and f.deleted_at is null and f.visivel_passagens) then raise exception 'FUNCIONARIO_INDISPONIVEL';end if;
    select btrim(s.pix_viajante) into v_pix from public.ro_passagem_solicitacoes s where s.funcionario_id=p_funcionario_id and s.pix_viajante is not null and btrim(s.pix_viajante)<>'' order by s.created_at desc,s.id desc limit 1;
  end if;
  return v_pix;
end $$;

alter function public.ro_criar_solicitacao_validada(jsonb,jsonb) rename to ro_criar_solicitacao_validada_pre_operacional;
create function public.ro_criar_solicitacao_validada(p_solicitacao jsonb,p_documentos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_id uuid;v_pix text:=btrim(coalesce(p_solicitacao->>'pix_viajante',''));v_hospedagem boolean:=coalesce((p_solicitacao->>'necessita_hospedagem')::boolean,false);v_checkin date:=nullif(p_solicitacao->>'hospedagem_checkin','')::date;v_checkout date:=nullif(p_solicitacao->>'hospedagem_checkout','')::date;
begin
 if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
 if v_pix='' then raise exception 'PIX_VIAJANTE_OBRIGATORIO';end if;
 if v_hospedagem and (v_checkin is null or v_checkout is null) then raise exception 'DATAS_HOSPEDAGEM_OBRIGATORIAS';end if;
 if v_hospedagem and v_checkout<v_checkin then raise exception 'CHECKOUT_ANTERIOR_AO_CHECKIN';end if;
 v_id:=public.ro_criar_solicitacao_validada_pre_operacional(p_solicitacao,p_documentos);
 update public.ro_passagem_solicitacoes set pix_viajante=v_pix,necessita_hospedagem=v_hospedagem,hospedagem_checkin=case when v_hospedagem then v_checkin end,hospedagem_checkout=case when v_hospedagem then v_checkout end,ida_a_partir_horario=nullif(p_solicitacao->>'ida_a_partir_horario','')::time where id=v_id;
 return v_id;
end $$;

alter function public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb) rename to ro_criar_solicitacao_colaborador_validada_pre_operacional;
create function public.ro_criar_solicitacao_colaborador_validada(p_solicitacao jsonb,p_documentos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_id uuid;v_pix text:=btrim(coalesce(p_solicitacao->>'pix_viajante',''));v_hospedagem boolean:=coalesce((p_solicitacao->>'necessita_hospedagem')::boolean,false);v_checkin date:=nullif(p_solicitacao->>'hospedagem_checkin','')::date;v_checkout date:=nullif(p_solicitacao->>'hospedagem_checkout','')::date;
begin
 if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
 if v_pix='' then raise exception 'PIX_VIAJANTE_OBRIGATORIO';end if;
 if v_hospedagem and (v_checkin is null or v_checkout is null) then raise exception 'DATAS_HOSPEDAGEM_OBRIGATORIAS';end if;
 if v_hospedagem and v_checkout<v_checkin then raise exception 'CHECKOUT_ANTERIOR_AO_CHECKIN';end if;
 v_id:=public.ro_criar_solicitacao_colaborador_validada_pre_operacional(p_solicitacao,p_documentos);
 update public.ro_passagem_solicitacoes set pix_viajante=v_pix,necessita_hospedagem=v_hospedagem,hospedagem_checkin=case when v_hospedagem then v_checkin end,hospedagem_checkout=case when v_hospedagem then v_checkout end,ida_a_partir_horario=nullif(p_solicitacao->>'ida_a_partir_horario','')::time where id=v_id;
 return v_id;
end $$;

alter function public.ro_registrar_compra(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb) rename to ro_registrar_compra_pre_operacional;
create function public.ro_registrar_compra(p_solicitacao_id uuid,p_tipo_transporte text,p_companhia text,p_localizador text,p_origem_comprada text,p_destino_comprado text,p_partida_em timestamptz,p_chegada_em timestamptz,p_observacoes_ro text,p_custos jsonb,p_horario_anterior_confirmado boolean default false,p_partida_horario_local time default null)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;v_anterior boolean;
begin
 select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
 if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
 if v_sol.ida_a_partir_horario is not null and p_partida_em is not null and p_partida_horario_local is null then raise exception 'HORARIO_LOCAL_PARTIDA_OBRIGATORIO';end if;
 v_anterior:=v_sol.ida_a_partir_horario is not null and p_partida_horario_local is not null and p_partida_horario_local<v_sol.ida_a_partir_horario;
 if v_anterior and not coalesce(p_horario_anterior_confirmado,false) then raise exception 'CONFIRMACAO_HORARIO_ANTERIOR_OBRIGATORIA';end if;
 perform public.ro_registrar_compra_pre_operacional(p_solicitacao_id,p_tipo_transporte,p_companhia,p_localizador,p_origem_comprada,p_destino_comprado,p_partida_em,p_chegada_em,p_observacoes_ro,p_custos);
 if v_anterior then insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por) values(p_solicitacao_id,v_sol.status,'passagem_comprada',format('Compra confirmada com horário anterior ao solicitado. Horário mínimo: %s. Partida registrada: %s. Confirmado em: %s.',to_char(v_sol.ida_a_partir_horario,'HH24:MI'),to_char(p_partida_horario_local,'HH24:MI'),to_char(now(),'YYYY-MM-DD HH24:MI:SSOF')),auth.uid());end if;
end $$;

revoke all on function public.ro_ultimo_pix_viajante(uuid,uuid),public.ro_criar_solicitacao_validada(jsonb,jsonb),public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb),public.ro_registrar_compra(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time) from public,anon;
revoke all on function public.ro_criar_solicitacao_validada_pre_operacional(jsonb,jsonb),public.ro_criar_solicitacao_colaborador_validada_pre_operacional(jsonb,jsonb),public.ro_registrar_compra_pre_operacional(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.ro_ultimo_pix_viajante(uuid,uuid),public.ro_criar_solicitacao_validada(jsonb,jsonb),public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb),public.ro_registrar_compra(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time) to authenticated;

commit;
