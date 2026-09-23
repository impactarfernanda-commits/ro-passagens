begin;

-- Fase 2: aplicar somente após o frontend v2 estar publicado e validado.
revoke all on function public.ro_registrar_hospedagem(uuid,numeric) from public,anon,authenticated;
revoke all on function public.ro_registrar_compra(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time) from public,anon,authenticated;

-- Os consumidores atuais gravam custos por RPC SECURITY DEFINER.
drop policy if exists ro_child_cost_insert on public.ro_passagem_custos;
drop policy if exists ro_child_cost_delete on public.ro_passagem_custos;
drop policy if exists ro_child_cost_write on public.ro_passagem_custos;
revoke insert,update,delete on table public.ro_passagem_custos from anon,authenticated;

create or replace function public.ro_validar_coerencia_hospedagem_resolvida()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;v_utilizada boolean;v_quantidade integer;v_positivos integer;
begin
  if tg_op='DELETE' then v_id:=old.solicitacao_id;else v_id:=new.solicitacao_id;end if;
  select hospedagem_utilizada into v_utilizada from public.ro_resolucao_operacional where solicitacao_id=v_id;
  if not found or v_utilizada is null then if tg_op='DELETE' then return old;else return new;end if;end if;
  select count(*) filter(where tipo='hospedagem'),count(*) filter(where tipo='hospedagem' and valor>0)
    into v_quantidade,v_positivos from public.ro_passagem_custos where solicitacao_id=v_id;
  if (v_utilizada=false and v_quantidade<>0) or (v_utilizada=true and(v_quantidade<>1 or v_positivos<>1)) then
    raise exception 'COERENCIA_HOSPEDAGEM_CUSTO_INVALIDA';
  end if;
  if tg_op='DELETE' then return old;else return new;end if;
end $$;

drop trigger if exists ro_validar_custo_hospedagem_resolvida on public.ro_passagem_custos;
create constraint trigger ro_validar_custo_hospedagem_resolvida
after insert or update or delete on public.ro_passagem_custos deferrable initially deferred
for each row execute function public.ro_validar_coerencia_hospedagem_resolvida();
drop trigger if exists ro_validar_resolucao_hospedagem_custo on public.ro_resolucao_operacional;
create constraint trigger ro_validar_resolucao_hospedagem_custo
after insert or update on public.ro_resolucao_operacional deferrable initially deferred
for each row execute function public.ro_validar_coerencia_hospedagem_resolvida();

revoke all on function public.ro_validar_coerencia_hospedagem_resolvida() from public,anon,authenticated;
commit;
