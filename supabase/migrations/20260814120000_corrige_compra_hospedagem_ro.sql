begin;

-- A RPC pública valida o operador e executa a implementação legada como owner.
-- A implementação _pre_operacional permanece sem EXECUTE para clientes.
create or replace function public.ro_registrar_compra(p_solicitacao_id uuid,p_tipo_transporte text,p_companhia text,p_localizador text,p_origem_comprada text,p_destino_comprado text,p_partida_em timestamptz,p_chegada_em timestamptz,p_observacoes_ro text,p_custos jsonb,p_horario_anterior_confirmado boolean default false,p_partida_horario_local time default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;v_anterior boolean;v_hospedagem public.ro_passagem_custos%rowtype;v_tinha_hospedagem boolean:=false;
begin
 if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
 if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_REGISTRAR_COMPRAS';end if;
 select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
 if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
 if v_sol.ida_a_partir_horario is not null and p_partida_em is not null and p_partida_horario_local is null then raise exception 'HORARIO_LOCAL_PARTIDA_OBRIGATORIO';end if;
 v_anterior:=v_sol.ida_a_partir_horario is not null and p_partida_horario_local is not null and p_partida_horario_local<v_sol.ida_a_partir_horario;
 if v_anterior and not coalesce(p_horario_anterior_confirmado,false) then raise exception 'CONFIRMACAO_HORARIO_ANTERIOR_OBRIGATORIA';end if;
 select * into v_hospedagem from public.ro_passagem_custos where solicitacao_id=p_solicitacao_id and tipo='hospedagem';v_tinha_hospedagem:=found;
 perform public.ro_registrar_compra_pre_operacional(p_solicitacao_id,p_tipo_transporte,p_companhia,p_localizador,p_origem_comprada,p_destino_comprado,p_partida_em,p_chegada_em,p_observacoes_ro,p_custos);
 if v_tinha_hospedagem then insert into public.ro_passagem_custos(id,solicitacao_id,tipo,descricao,valor,created_at,created_by,centro_custo_id) values(v_hospedagem.id,v_hospedagem.solicitacao_id,v_hospedagem.tipo,v_hospedagem.descricao,v_hospedagem.valor,v_hospedagem.created_at,v_hospedagem.created_by,v_hospedagem.centro_custo_id);end if;
 if v_anterior then insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por) values(p_solicitacao_id,v_sol.status,'passagem_comprada',format('Compra confirmada com horário anterior ao solicitado. Horário mínimo: %s. Partida registrada: %s. Confirmado em: %s.',to_char(v_sol.ida_a_partir_horario,'HH24:MI'),to_char(p_partida_horario_local,'HH24:MI'),to_char(now(),'YYYY-MM-DD HH24:MI:SSOF')),auth.uid());end if;
end $$;

alter table public.ro_passagem_custos drop constraint if exists ro_passagem_custos_tipo_check;
alter table public.ro_passagem_custos add constraint ro_passagem_custos_tipo_check check(tipo in ('passagem','hospedagem','uber','refeicao','outros'));
create unique index ro_passagem_custos_hospedagem_unico on public.ro_passagem_custos(solicitacao_id) where tipo='hospedagem';

alter table public.ro_passagem_anexos drop constraint if exists ro_passagem_anexos_tipo_check;
alter table public.ro_passagem_anexos add constraint ro_passagem_anexos_tipo_check check(tipo in ('passagem_pdf','hospedagem_pdf'));

create or replace function public.ro_registrar_hospedagem(p_solicitacao_id uuid,p_valor_total numeric)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sol public.ro_passagem_solicitacoes%rowtype;v_centro_custo uuid;v_anterior numeric;v_evento text;
begin
 if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
 if not coalesce(public.ro_can_operate(),false) then raise exception 'APENAS_RESPONSAVEIS_RO_ATIVOS_PODEM_REGISTRAR_HOSPEDAGEM';end if;
 if p_valor_total is null or p_valor_total<=0 then raise exception 'VALOR_HOSPEDAGEM_DEVE_SER_MAIOR_QUE_ZERO';end if;
 select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
 if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
 if not v_sol.necessita_hospedagem then raise exception 'HOSPEDAGEM_NAO_SOLICITADA';end if;
 if v_sol.status in ('cancelada','recusada') then raise exception 'SOLICITACAO_NAO_PERMITE_HOSPEDAGEM';end if;
 select c.valor into v_anterior from public.ro_passagem_custos c where c.solicitacao_id=p_solicitacao_id and c.tipo='hospedagem';
 select c.centro_custo_id into v_centro_custo from public.ro_passagem_custos c where c.solicitacao_id=p_solicitacao_id and c.centro_custo_id is not null order by (c.tipo='passagem') desc,c.created_at limit 1;
 v_centro_custo:=coalesce(v_centro_custo,v_sol.obra_id);
 insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,centro_custo_id,created_by)
 values(p_solicitacao_id,'hospedagem','Hospedagem',p_valor_total,v_centro_custo,auth.uid())
 on conflict(solicitacao_id) where tipo='hospedagem' do update set valor=excluded.valor,centro_custo_id=excluded.centro_custo_id,created_by=auth.uid();
 v_evento:=case when v_anterior is null then 'Hospedagem registrada.' else 'Hospedagem atualizada.' end;
 insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por) values(p_solicitacao_id,v_sol.status,v_sol.status,v_evento,auth.uid());
end $$;

drop policy if exists ro_storage_insert on storage.objects;
create policy ro_storage_insert on storage.objects for insert to authenticated with check(
 bucket_id='ro-passagem-anexos' and public.ro_can_operate() and exists(
  select 1 from public.ro_passagem_solicitacoes s where s.id::text=(storage.foldername(name))[1]
   and s.status in ('solicitada','em_andamento','passagem_comprada') and s.folga_antecipacao_status is distinct from 'pendente'
 )
);

revoke all on function public.ro_registrar_compra(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time) from public,anon;
revoke all on function public.ro_registrar_compra_pre_operacional(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
revoke all on function public.ro_registrar_hospedagem(uuid,numeric) from public,anon;
grant execute on function public.ro_registrar_compra(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time),public.ro_registrar_hospedagem(uuid,numeric) to authenticated;

commit;
