-- Regras operacionais do RO Passagens. Não altera tabelas do Obras Control.
alter table public.ro_passagem_solicitacoes
  add column if not exists centro_custo_retorno_id uuid references public.obras(id),
  add column if not exists retorno_indefinido boolean not null default false,
  add column if not exists centro_custo_destino_id uuid references public.obras(id),
  add column if not exists justificativa_excecao_prazo text,
  add column if not exists chegou_ao_destino boolean,
  add column if not exists data_chegada_confirmada timestamptz,
  add column if not exists houve_imprevisto boolean,
  add column if not exists observacao_finalizacao text,
  add column if not exists finalizado_por uuid references auth.users(id),
  add column if not exists finalizado_em timestamptz;

do $$
declare v record;
begin
  for v in select conname from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%motivo%' loop
    execute format('alter table public.ro_passagem_solicitacoes drop constraint %I',v.conname);
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_motivo_valido') then
    alter table public.ro_passagem_solicitacoes add constraint ro_motivo_valido check (motivo in ('ferias','folga_campo','desligamento','transferencia_obra'));
  end if;
end $$;

-- Compatibilidade: consolida o status legado sem apagar registros relacionados.
update public.ro_passagem_solicitacoes set status='em_andamento' where status='em_analise';
do $$
declare v record;
begin
  for v in select conname from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.ro_passagem_solicitacoes drop constraint %I',v.conname);
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_status_valido') then
    alter table public.ro_passagem_solicitacoes add constraint ro_status_valido check (status in ('solicitada','em_andamento','passagem_comprada','finalizada','cancelada'));
  end if;
end $$;

create or replace function public.ro_validar_solicitacao()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.solicitante_id <> auth.uid() then raise exception 'O solicitante deve ser o usuário autenticado'; end if;
  if new.motivo in ('desligamento','transferencia_obra') then
    new.data_retorno:=null; new.centro_custo_retorno_id:=null; new.retorno_indefinido:=false;
  end if;
  if new.motivo='transferencia_obra' and new.centro_custo_destino_id is null then raise exception 'Centro de custo destino é obrigatório'; end if;
  if new.motivo in ('ferias','folga_campo') and new.data_ida < current_date+10 then
    if not public.ro_is_admin() then raise exception 'Solicitações de férias e folga de campo devem ser feitas com pelo menos 10 dias de antecedência. A primeira data permitida é %.',to_char(current_date+10,'DD/MM/YYYY'); end if;
    if nullif(trim(new.justificativa_excecao_prazo),'') is null then raise exception 'A justificativa da exceção de prazo é obrigatória'; end if;
  end if;
  return new;
end $$;
drop trigger if exists ro_validar_solicitacao on public.ro_passagem_solicitacoes;
create trigger ro_validar_solicitacao before insert on public.ro_passagem_solicitacoes for each row execute function public.ro_validar_solicitacao();

create or replace function public.ro_notificar_retorno_pendente()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_nome text; v_limite date; v_ro record; v_msg text;
begin
  if new.motivo in ('ferias','folga_campo') and new.data_retorno is not null and (new.centro_custo_retorno_id is null or new.retorno_indefinido) then
    select nome into v_nome from public.funcionarios where id=new.funcionario_id;
    v_limite:=new.data_retorno-10;
    v_msg:=format('Solicitação de retorno pendente para %s. A solicitação deve ser definida até %s, considerando retorno previsto em %s.',v_nome,to_char(v_limite,'DD/MM/YYYY'),to_char(new.data_retorno,'DD/MM/YYYY'));
    insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem) values(new.id,'interno','solicitante',new.solicitante_id::text,v_msg);
    for v_ro in select user_id from public.ro_responsaveis where ativo loop
      insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem) values(new.id,'interno','ro',v_ro.user_id::text,v_msg);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists ro_retorno_pendente on public.ro_passagem_solicitacoes;
create trigger ro_retorno_pendente after insert on public.ro_passagem_solicitacoes for each row execute function public.ro_notificar_retorno_pendente();

create or replace function public.ro_alterar_status(p_solicitacao_id uuid,p_status text)
returns void language plpgsql security invoker set search_path=public as $$
declare v_anterior text;
begin
  if not public.ro_is_admin_or_ro() then raise exception 'Apenas equipe RO, gerente ou diretor pode alterar o status'; end if;
  if p_status not in ('em_andamento','cancelada') then raise exception 'Transição de status inválida'; end if;
  select status into v_anterior from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  update public.ro_passagem_solicitacoes set status=p_status where id=p_solicitacao_id;
  insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por) values(p_solicitacao_id,v_anterior,p_status,case when p_status='cancelada' then 'Solicitação cancelada pela equipe RO.' else 'Solicitação colocada em andamento.' end,auth.uid());
end $$;
revoke all on function public.ro_alterar_status(uuid,text) from public;
grant execute on function public.ro_alterar_status(uuid,text) to authenticated;

create or replace function public.ro_finalizar_solicitacao(p_solicitacao_id uuid,p_chegou_ao_destino boolean,p_data_chegada_confirmada date,p_houve_imprevisto boolean,p_observacao_finalizacao text)
returns void language plpgsql security invoker set search_path=public as $$
declare v_anterior text;
begin
  if not public.ro_is_admin_or_ro() then raise exception 'Apenas equipe RO, gerente ou diretor pode finalizar'; end if;
  if (p_houve_imprevisto or not p_chegou_ao_destino) and nullif(trim(p_observacao_finalizacao),'') is null then raise exception 'A observação é obrigatória quando houve imprevisto ou não chegou ao destino'; end if;
  select status into v_anterior from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
  if v_anterior <> 'passagem_comprada' then raise exception 'Somente uma passagem comprada pode ser finalizada'; end if;
  update public.ro_passagem_solicitacoes set status='finalizada',chegou_ao_destino=p_chegou_ao_destino,data_chegada_confirmada=p_data_chegada_confirmada::timestamptz,houve_imprevisto=p_houve_imprevisto,observacao_finalizacao=nullif(trim(p_observacao_finalizacao),''),finalizado_por=auth.uid(),finalizado_em=now() where id=p_solicitacao_id;
  insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por) values(p_solicitacao_id,v_anterior,'finalizada','Chegada ao destino registrada e solicitação finalizada.',auth.uid());
end $$;
revoke all on function public.ro_finalizar_solicitacao(uuid,boolean,date,boolean,text) from public;
grant execute on function public.ro_finalizar_solicitacao(uuid,boolean,date,boolean,text) to authenticated;

-- Compra e anexos passam a aceitar o status consolidado.
drop policy if exists ro_storage_insert on storage.objects;
create policy ro_storage_insert on storage.objects for insert to authenticated with check(bucket_id='ro-passagem-anexos' and public.ro_is_admin_or_ro() and exists(select 1 from public.ro_passagem_solicitacoes s where s.id::text=(storage.foldername(name))[1] and s.status in ('solicitada','em_andamento')));
