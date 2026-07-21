-- Responsável pela solicitação e passagens complementares.
alter table public.ro_passagem_solicitacoes
  add column if not exists responsavel_ro_id uuid references auth.users(id),
  add column if not exists assumida_em timestamptz;

alter table public.ro_passagem_anexos
  add column if not exists complementar boolean not null default false,
  add column if not exists imprevisto boolean not null default false,
  add column if not exists motivo_complementar text,
  add column if not exists criado_por uuid references auth.users(id),
  add column if not exists criado_em timestamptz not null default now();

-- Upload inicial somente em andamento; complementar também após a compra.
drop policy if exists ro_storage_insert on storage.objects;
create policy ro_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ro-passagem-anexos'
  and public.ro_can_operate()
  and exists (
    select 1 from public.ro_passagem_solicitacoes s
    where s.id::text = (storage.foldername(name))[1]
      and s.status in ('em_andamento', 'passagem_comprada')
  )
);

create or replace function public.ro_alterar_status(p_solicitacao_id uuid, p_status text)
returns void language plpgsql security invoker set search_path=public as $$
declare v_anterior text;
begin
  if not public.ro_can_operate() then raise exception 'Apenas responsáveis RO ativos podem executar esta ação.'; end if;
  if p_status not in ('em_andamento','cancelada') then raise exception 'Transição de status inválida'; end if;
  select status into v_anterior from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if p_status='em_andamento' and v_anterior<>'solicitada' then raise exception 'Somente solicitações solicitadas podem ser assumidas'; end if;
  if p_status='cancelada' and v_anterior not in ('em_andamento','passagem_comprada') then raise exception 'Marque a solicitação como Em andamento antes de executar ações operacionais.'; end if;
  update public.ro_passagem_solicitacoes set
    status=p_status,
    responsavel_ro_id=case when p_status='em_andamento' then auth.uid() else responsavel_ro_id end,
    assumida_em=case when p_status='em_andamento' then now() else assumida_em end
  where id=p_solicitacao_id;
  insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
  values(p_solicitacao_id,v_anterior,p_status,case when p_status='cancelada' then 'Solicitação cancelada pela equipe RO.' else 'Solicitação assumida e colocada em andamento.' end,auth.uid());
end $$;

-- Bloqueio transversal: nenhuma função pode comprar diretamente a partir de solicitada.
create or replace function public.ro_validar_transicao_operacional()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status='solicitada' and new.status='passagem_comprada' then
    raise exception 'Marque a solicitação como Em andamento antes de executar ações operacionais.';
  end if;
  return new;
end $$;
drop trigger if exists ro_validar_transicao_operacional on public.ro_passagem_solicitacoes;
create trigger ro_validar_transicao_operacional before update on public.ro_passagem_solicitacoes
for each row execute function public.ro_validar_transicao_operacional();

create or replace function public.ro_registrar_passagem_complementar(
  p_solicitacao_id uuid,
  p_anexos jsonb,
  p_imprevisto boolean,
  p_motivo_complementar text
)
returns void language plpgsql security invoker set search_path=public as $$
declare v_status text; v_item jsonb; v_anexo uuid;
begin
  if not public.ro_can_operate() then raise exception 'Apenas responsáveis RO ativos podem executar esta ação.'; end if;
  select status into v_status from public.ro_passagem_solicitacoes where id=p_solicitacao_id for update;
  if v_status<>'passagem_comprada' then raise exception 'Passagens complementares só podem ser adicionadas após a compra inicial'; end if;
  if jsonb_array_length(coalesce(p_anexos,'[]'::jsonb))=0 then raise exception 'Adicione pelo menos um PDF'; end if;
  for v_item in select * from jsonb_array_elements(p_anexos) loop
    insert into public.ro_passagem_anexos(solicitacao_id,tipo,nome_arquivo,storage_path,mime_type,tamanho_bytes,uploaded_by,partida_em,valor,observacao,complementar,imprevisto,motivo_complementar,criado_por)
    values(p_solicitacao_id,'passagem_pdf',v_item->>'nome_arquivo',v_item->>'storage_path',v_item->>'mime_type',(v_item->>'tamanho_bytes')::bigint,auth.uid(),nullif(v_item->>'partida_em','')::timestamptz,nullif(v_item->>'valor','')::numeric,nullif(v_item->>'observacao',''),true,p_imprevisto,nullif(trim(p_motivo_complementar),''),auth.uid()) returning id into v_anexo;
    if nullif(v_item->>'valor','') is not null then
      insert into public.ro_passagem_custos(solicitacao_id,tipo,descricao,valor,created_by)
      values(p_solicitacao_id,'passagem','Passagem complementar: '||(v_item->>'nome_arquivo'),(v_item->>'valor')::numeric,auth.uid());
    end if;
  end loop;
  insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
  values(p_solicitacao_id,'passagem_comprada','passagem_comprada',case when p_imprevisto then 'Passagem complementar por imprevisto adicionada: ' else 'Passagem complementar adicionada: ' end||coalesce(nullif(trim(p_motivo_complementar),''),'sem observação'),auth.uid());
end $$;
revoke all on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text) from public;
grant execute on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text) to authenticated;

-- O frontend pode obter nome/e-mail sem expor auth.users diretamente.
create or replace function public.ro_user_labels(p_user_ids uuid[])
returns table(id uuid, label text)
language sql stable security definer set search_path=public,auth as $$
  select u.id,coalesce(nullif(trim(up.full_name),''),u.email,'Usuário sem identificação')
  from auth.users u left join public.users_profiles up on up.id=u.id
  where u.id=any(p_user_ids)
    and (u.id=auth.uid() or public.ro_can_view_all() or exists(select 1 from public.ro_passagem_solicitacoes s where s.solicitante_id=auth.uid() and (s.solicitante_id=u.id or s.responsavel_ro_id=u.id)));
$$;
revoke all on function public.ro_user_labels(uuid[]) from public;
grant execute on function public.ro_user_labels(uuid[]) to authenticated;
