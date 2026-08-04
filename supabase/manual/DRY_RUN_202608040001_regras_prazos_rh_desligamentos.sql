-- RO Passagens: prazos, RH, calendÃ¡rio e documentos internos.
-- AplicaÃ§Ã£o exclusivamente manual no SQL Editor. NÃ£o contÃ©m dados de RH ou feriados.
begin;
create table if not exists public.ro_rh_responsaveis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ativo boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table if not exists public.ro_calendario_nao_util (
  id uuid primary key default gen_random_uuid(), data date not null, descricao text not null,
  tipo text not null check (tipo in ('feriado','ponto_facultativo')),
  abrangencia text not null check (abrangencia in ('nacional','estadual','municipal')),
  estado text, municipio text, ativo boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
  constraint ro_calendario_abrangencia_ck check (
    (abrangencia='nacional' and estado is null and municipio is null) or
    (abrangencia='estadual' and estado='SP' and municipio is null) or
    (abrangencia='municipal' and estado='SP' and municipio='Rio Claro')
  ), unique(data,tipo,abrangencia,estado,municipio)
);
create table if not exists public.ro_calendario_anos (
  ano integer primary key check (ano between 2000 and 2200), completo boolean not null default false,
  validado_em timestamptz, validado_por uuid references auth.users(id), observacoes text
);

alter table public.ro_passagem_solicitacoes
  add column if not exists desligamento_subtipo text,
  add column if not exists primeiro_embarque_em timestamptz,
  add column if not exists origem_solicitacao text not null default 'comum',
  add column if not exists prazo_regra_codigo text,
  add column if not exists prazo_tipo text,
  add column if not exists prazo_quantidade integer,
  add column if not exists data_minima_permitida date,
  add column if not exists prazo_calculado_em timestamptz,
  add column if not exists prazo_excecao boolean not null default false,
  add column if not exists prazo_excecao_justificativa text,
  add column if not exists prazo_excecao_por uuid references auth.users(id),
  add column if not exists prazo_excecao_em timestamptz;

do $$ begin
  alter table public.ro_passagem_solicitacoes drop constraint if exists ro_motivo_valido;
  alter table public.ro_passagem_solicitacoes add constraint ro_motivo_valido check (motivo is null or motivo in ('ferias','folga_campo','desligamento','transferencia_obra','viagem_diretoria','admissao','inicio_obra','retorno_obra','recesso'));
end $$;
alter table public.ro_passagem_solicitacoes drop constraint if exists ro_origem_solicitacao_ck;
alter table public.ro_passagem_solicitacoes add constraint ro_origem_solicitacao_ck check (origem_solicitacao in ('comum','rh','gerencial','administrativo'));
alter table public.ro_passagem_solicitacoes drop constraint if exists ro_desligamento_subtipo_ck;
alter table public.ro_passagem_solicitacoes add constraint ro_desligamento_subtipo_ck check (
  prazo_regra_codigo is null or
  (motivo='desligamento' and desligamento_subtipo is not null and desligamento_subtipo in ('programado_outros','justa_causa','pedido_demissao','ma_conduta')) or
  (motivo is distinct from 'desligamento' and desligamento_subtipo is null)
) not valid;

create table if not exists public.ro_passagem_documentos_internos (
  id uuid primary key default gen_random_uuid(), solicitacao_id uuid not null references public.ro_passagem_solicitacoes(id) on delete restrict deferrable initially deferred,
  categoria text not null check (categoria in ('termo_justa_causa','carta_pedido_demissao')),
  storage_path text not null unique, arquivo_nome text not null, mime_type text not null check (mime_type='application/pdf'),
  tamanho_bytes bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 10485760),
  created_at timestamptz not null default now(), created_by uuid not null references auth.users(id)
);
create table if not exists public.ro_auditoria_interna (
  id uuid primary key default gen_random_uuid(), evento text not null, solicitacao_id uuid references public.ro_passagem_solicitacoes(id) on delete set null,
  detalhes jsonb not null default '{}'::jsonb, criado_em timestamptz not null default now(), criado_por uuid references auth.users(id)
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ro-documentos-internos','ro-documentos-internos',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf'];

create or replace function public.ro_can_manage_rh() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from auth.users u where u.id=auth.uid() and lower(u.email)=lower('fernanda.souza@tanksbr.com.br'));
$$;
create or replace function public.ro_is_rh_active(p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.ro_rh_responsaveis r where r.user_id=p_user_id and r.ativo);
$$;
create or replace function public.ro_role(p_user uuid default auth.uid()) returns text
language sql stable security definer set search_path=public,pg_temp as $$
  select ur.role::text from public.user_roles ur where ur.user_id=p_user order by case ur.role::text when 'diretor' then 1 when 'gerente' then 2 else 3 end limit 1;
$$;
create or replace function public.ro_can_view_internal_document(p_solicitacao uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(public.ro_is_rh_active(),false) or coalesce(public.ro_can_operate(),false) or coalesce(public.ro_role(),'') in ('gerente','diretor')
    or exists(select 1 from public.ro_passagem_documentos_internos d where d.solicitacao_id=p_solicitacao and d.created_by=auth.uid());
$$;
create or replace function public.ro_admin_user_search(p_search text default '') returns table(id uuid,full_name text,email text)
language sql stable security definer set search_path=public,auth,pg_temp as $$
  select u.id,coalesce(p.full_name,u.raw_user_meta_data->>'full_name'),u.email::text from auth.users u left join public.users_profiles p on p.id=u.id
  where public.ro_can_manage_rh() and (coalesce(p_search,'')='' or coalesce(p.full_name,'') ilike '%'||p_search||'%' or coalesce(u.email,'') ilike '%'||p_search||'%') order by coalesce(p.full_name,u.email) limit 50;
$$;

create or replace function public.ro_prazo_regra(p_motivo text,p_subtipo text)
returns table(regra_codigo text,prazo_tipo text,prazo_quantidade integer,categoria_documento text)
language sql immutable set search_path=public,pg_temp as $$
 select case when p_motivo='desligamento' then 'desligamento_'||coalesce(p_subtipo,'invalido') else coalesce(p_motivo,'administrativo') end,
 case when p_motivo='desligamento' and p_subtipo in ('justa_causa','pedido_demissao') then 'sem_prazo_minimo'
      when p_motivo='desligamento' and p_subtipo='ma_conduta' or p_motivo='inicio_obra' then 'dias_uteis' else 'dias_corridos' end,
 case when p_motivo='desligamento' and p_subtipo in ('justa_causa','pedido_demissao') then 0
      when p_motivo='desligamento' and p_subtipo='ma_conduta' or p_motivo='inicio_obra' then 5
      when p_motivo='ferias' then 25 when p_motivo in ('folga_campo','transferencia_obra','admissao','retorno_obra') then 15
      when p_motivo='recesso' then 30 when p_motivo='desligamento' then 25 else 0 end,
 case when p_subtipo='justa_causa' then 'termo_justa_causa' when p_subtipo='pedido_demissao' then 'carta_pedido_demissao' end;
$$;
create or replace function public.ro_data_minima_util(p_agora timestamptz,p_quantidade integer)
returns date language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_local timestamp:=p_agora at time zone 'America/Sao_Paulo'; v_data date:=v_local::date; v_restante integer:=p_quantidade; v_util boolean; v_ano integer; v_primeiro boolean:=true;
begin
  while v_restante>0 loop
    v_ano:=extract(year from v_data);
    if not exists(select 1 from public.ro_calendario_anos a where a.ano=v_ano and a.completo) then raise exception 'CALENDARIO_INCOMPLETO:%',v_ano; end if;
    v_util:=extract(isodow from v_data)<6 and not exists(select 1 from public.ro_calendario_nao_util c where c.data=v_data and c.ativo and (c.abrangencia='nacional' or c.estado='SP') and (c.abrangencia<>'municipal' or c.municipio='Rio Claro'));
    if v_util and not (v_primeiro and ((extract(isodow from v_data)=5 and v_local::time>time '15:30') or (extract(isodow from v_data)<5 and v_local::time>time '16:30'))) then v_restante:=v_restante-1; if v_restante=0 then return v_data; end if; end if;
    v_primeiro:=false;
    v_data:=v_data+1;
  end loop; return v_data;
end $$;

create or replace function public.ro_validar_nova_solicitacao()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text:=public.ro_role(auth.uid()); v_is_gerencial boolean:=coalesce(v_role,'') in ('gerente','diretor'); v_rh boolean:=coalesce(public.ro_is_rh_active(),false); v_can_administrativo boolean:=coalesce(public.ro_can_view_all(),false); v_reg record; v_min date; v_primeiro timestamptz; v_categoria text;
begin
  if auth.uid() is null or new.solicitante_id is distinct from auth.uid() then raise exception 'SOLICITANTE_INVALIDO'; end if;
  if new.motivo='viagem_diretoria' then raise exception 'MOTIVO_NAO_DISPONIVEL'; end if;
  if new.motivo is null and not v_can_administrativo then raise exception 'MOTIVO_ADMINISTRATIVO_NAO_PERMITIDO'; end if;
  if not v_is_gerencial and v_rh and coalesce(new.motivo,'') not in ('admissao','desligamento','inicio_obra') then raise exception 'MOTIVO_NAO_PERMITIDO'; end if;
  if not v_is_gerencial and not v_rh and new.motivo='admissao' then raise exception 'MOTIVO_NAO_PERMITIDO'; end if;
  if new.motivo='desligamento' and (new.desligamento_subtipo is null or coalesce(new.desligamento_subtipo,'') not in ('programado_outros','justa_causa','pedido_demissao','ma_conduta')) then raise exception 'SUBTIPO_DESLIGAMENTO_OBRIGATORIO'; end if;
  if new.motivo is distinct from 'desligamento' and new.desligamento_subtipo is not null then raise exception 'SUBTIPO_DESLIGAMENTO_INVALIDO'; end if;
  v_primeiro:=coalesce(new.primeiro_embarque_em,new.data_ida::date + time '12:00');
  if v_primeiro is null then raise exception 'PRIMEIRO_EMBARQUE_OBRIGATORIO'; end if;
  if v_primeiro <= now() then raise exception 'EMBARQUE_NO_PASSADO'; end if;
  new.data_ida:=(v_primeiro at time zone 'America/Sao_Paulo')::date;
  select * into v_reg from public.ro_prazo_regra(new.motivo,new.desligamento_subtipo);
  if v_reg.prazo_tipo='dias_uteis' then v_min:=public.ro_data_minima_util(now(),v_reg.prazo_quantidade); elsif v_reg.prazo_tipo='dias_corridos' then v_min:=(now() at time zone 'America/Sao_Paulo')::date+v_reg.prazo_quantidade; else v_min:=(now() at time zone 'America/Sao_Paulo')::date; end if;
  if tg_op='INSERT' then new.origem_solicitacao:=case when new.motivo is null then 'administrativo' when v_is_gerencial then 'gerencial' when v_rh then 'rh' else 'comum' end;
  else new.origem_solicitacao:=old.origem_solicitacao; end if;
  new.prazo_regra_codigo:=v_reg.regra_codigo; new.prazo_tipo:=v_reg.prazo_tipo; new.prazo_quantidade:=v_reg.prazo_quantidade; new.data_minima_permitida:=v_min; new.prazo_calculado_em:=now();
  if new.data_ida<v_min then
    if not v_is_gerencial then raise exception 'FORA_DO_PRAZO:%',v_min; end if;
    if length(trim(coalesce(new.prazo_excecao_justificativa,new.justificativa_excecao_prazo,'')))<10 then raise exception 'JUSTIFICATIVA_EXCECAO_OBRIGATORIA'; end if;
    new.prazo_excecao:=true; new.prazo_excecao_por:=auth.uid(); new.prazo_excecao_em:=now();
  else new.prazo_excecao:=false; new.prazo_excecao_justificativa:=null; new.prazo_excecao_por:=null; new.prazo_excecao_em:=null; end if;
  v_categoria:=v_reg.categoria_documento;
  if v_categoria is not null and not exists(select 1 from public.ro_passagem_documentos_internos d where d.solicitacao_id=new.id and d.categoria=v_categoria) then raise exception 'DOCUMENTO_INTERNO_OBRIGATORIO:%',v_categoria; end if;
  if tg_op='UPDATE' then insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('solicitacao_revalidada',new.id,jsonb_build_object('motivo_anterior',old.motivo,'motivo_novo',new.motivo,'subtipo_anterior',old.desligamento_subtipo,'subtipo_novo',new.desligamento_subtipo,'embarque_anterior',old.primeiro_embarque_em,'embarque_novo',new.primeiro_embarque_em,'data_minima',new.data_minima_permitida,'excecao',new.prazo_excecao),auth.uid()); end if;
  return new;
end $$;
drop trigger if exists ro_validar_solicitacao on public.ro_passagem_solicitacoes;
drop trigger if exists ro_validar_nova_solicitacao on public.ro_passagem_solicitacoes;
create trigger ro_validar_nova_solicitacao before insert on public.ro_passagem_solicitacoes for each row execute function public.ro_validar_nova_solicitacao();
drop trigger if exists ro_revalidar_solicitacao_editada on public.ro_passagem_solicitacoes;
create trigger ro_revalidar_solicitacao_editada before update of motivo,desligamento_subtipo,data_ida,primeiro_embarque_em,origem,destino on public.ro_passagem_solicitacoes for each row execute function public.ro_validar_nova_solicitacao();

-- A RPC reserva o ID, registra metadados verificados e insere a solicitaÃ§Ã£o na mesma transaÃ§Ã£o.
create or replace function public.ro_criar_solicitacao_validada(p_solicitacao jsonb,p_documentos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_id uuid:=coalesce(nullif(p_solicitacao->>'id','')::uuid,gen_random_uuid()); v_doc jsonb; v_obj storage.objects%rowtype;
begin
  for v_doc in select value from jsonb_array_elements(coalesce(p_documentos,'[]'::jsonb)) loop
    select * into v_obj from storage.objects o where o.bucket_id='ro-documentos-internos' and o.name=v_doc->>'storage_path' and o.owner_id::text=auth.uid()::text;
    if not found then raise exception 'DOCUMENTO_NAO_ENCONTRADO_OU_SEM_PERMISSAO'; end if;
    if (v_doc->>'storage_path') not like v_id::text||'/'||(v_doc->>'categoria')||'/%' then raise exception 'CAMINHO_DOCUMENTO_INVALIDO'; end if;
    if coalesce(v_obj.metadata->>'mimetype','')<>'application/pdf' or lower(storage.extension(v_obj.name))<>'pdf' then raise exception 'DOCUMENTO_NAO_PDF'; end if;
    if coalesce((v_obj.metadata->>'size')::bigint,0)<=0 or (v_obj.metadata->>'size')::bigint>10485760 then raise exception 'DOCUMENTO_TAMANHO_INVALIDO'; end if;
    insert into public.ro_passagem_documentos_internos(id,solicitacao_id,categoria,storage_path,arquivo_nome,mime_type,tamanho_bytes,created_by)
    values(gen_random_uuid(),v_id,v_doc->>'categoria',v_doc->>'storage_path',v_doc->>'arquivo_nome','application/pdf',(v_obj.metadata->>'size')::bigint,auth.uid());
  end loop;
  insert into public.ro_passagem_solicitacoes(id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,primeiro_embarque_em,data_retorno,centro_custo_retorno_id,retorno_indefinido,centro_custo_destino_id,desligamento_subtipo,prazo_excecao_justificativa,justificativa_excecao_prazo,observacoes_solicitante)
  values(v_id,(p_solicitacao->>'funcionario_id')::uuid,nullif(p_solicitacao->>'obra_id','')::uuid,auth.uid(),p_solicitacao->>'origem',p_solicitacao->>'destino',nullif(p_solicitacao->>'motivo',''),(p_solicitacao->>'data_ida')::date,(p_solicitacao->>'primeiro_embarque_em')::timestamptz,nullif(p_solicitacao->>'data_retorno','')::date,nullif(p_solicitacao->>'centro_custo_retorno_id','')::uuid,coalesce((p_solicitacao->>'retorno_indefinido')::boolean,false),nullif(p_solicitacao->>'centro_custo_destino_id','')::uuid,nullif(p_solicitacao->>'desligamento_subtipo',''),nullif(trim(p_solicitacao->>'justificativa_excecao_prazo'),''),nullif(trim(p_solicitacao->>'justificativa_excecao_prazo'),''),nullif(p_solicitacao->>'observacoes_solicitante',''));
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  select 'solicitacao_validada',v_id,jsonb_build_object('regra',s.prazo_regra_codigo,'tipo',s.prazo_tipo,'quantidade',s.prazo_quantidade,'data_minima',s.data_minima_permitida,'primeiro_embarque',s.primeiro_embarque_em,'excecao',s.prazo_excecao,'justificativa',s.prazo_excecao_justificativa),auth.uid() from public.ro_passagem_solicitacoes s where s.id=v_id;
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
  select 'documento_interno_anexado',v_id,jsonb_build_object('categoria',d.categoria),auth.uid() from public.ro_passagem_documentos_internos d where d.solicitacao_id=v_id;
  return v_id;
end $$;

create or replace function public.ro_invalidate_calendar_year() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ano integer; v_ano_antigo integer; v_ano_novo integer; v_anos integer[];
begin
  v_ano_antigo:=case when tg_op in ('UPDATE','DELETE') then extract(year from old.data)::integer end;
  v_ano_novo:=case when tg_op in ('INSERT','UPDATE') then extract(year from new.data)::integer end;
  if tg_op='INSERT' then v_anos:=array[v_ano_novo];
  elsif tg_op='DELETE' then v_anos:=array[v_ano_antigo];
  elsif v_ano_antigo=v_ano_novo then v_anos:=array[v_ano_novo];
  else v_anos:=array[v_ano_antigo,v_ano_novo]; end if;
  foreach v_ano in array v_anos loop
    insert into public.ro_calendario_anos(ano,completo) values(v_ano,false)
    on conflict(ano) do update set completo=false,validado_em=null,validado_por=null;
  end loop;
  insert into public.ro_auditoria_interna(evento,detalhes,criado_por)
  values('calendario_alterado',jsonb_build_object('anos_invalidados',to_jsonb(v_anos),'operacao',tg_op),auth.uid());
  if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists ro_calendar_invalidate on public.ro_calendario_nao_util;
create trigger ro_calendar_invalidate after insert or update or delete on public.ro_calendario_nao_util for each row execute function public.ro_invalidate_calendar_year();
create or replace function public.ro_stamp_admin_row() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if tg_op='INSERT' then new.created_at:=now(); new.created_by:=auth.uid(); end if; new.updated_at:=now(); new.updated_by:=auth.uid(); return new; end $$;
drop trigger if exists ro_rh_stamp on public.ro_rh_responsaveis;
create trigger ro_rh_stamp before insert or update on public.ro_rh_responsaveis for each row execute function public.ro_stamp_admin_row();
drop trigger if exists ro_calendar_stamp on public.ro_calendario_nao_util;
create trigger ro_calendar_stamp before insert or update on public.ro_calendario_nao_util for each row execute function public.ro_stamp_admin_row();
create or replace function public.ro_stamp_calendar_year() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if new.completo then new.validado_em:=now(); new.validado_por:=auth.uid(); else new.validado_em:=null; new.validado_por:=null; end if; return new; end $$;
drop trigger if exists ro_calendar_year_stamp on public.ro_calendario_anos;
create trigger ro_calendar_year_stamp before insert or update on public.ro_calendario_anos for each row execute function public.ro_stamp_calendar_year();
create or replace function public.ro_audit_rh_change() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into public.ro_auditoria_interna(evento,detalhes,criado_por) values('equipe_rh_alterada',jsonb_build_object('user_id',coalesce(new.user_id,old.user_id),'ativo',case when tg_op='DELETE' then false else new.ativo end,'operacao',tg_op),auth.uid()); if tg_op='DELETE' then return old; end if; return new; end $$;
drop trigger if exists ro_rh_audit on public.ro_rh_responsaveis;
create trigger ro_rh_audit after insert or update or delete on public.ro_rh_responsaveis for each row execute function public.ro_audit_rh_change();
create or replace function public.ro_audit_calendar_year() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into public.ro_auditoria_interna(evento,detalhes,criado_por) values('calendario_ano_validacao',jsonb_build_object('ano',new.ano,'completo',new.completo),auth.uid()); return new; end $$;
drop trigger if exists ro_calendar_year_audit on public.ro_calendario_anos;
create trigger ro_calendar_year_audit after insert or update on public.ro_calendario_anos for each row execute function public.ro_audit_calendar_year();

alter table public.ro_rh_responsaveis enable row level security; alter table public.ro_calendario_nao_util enable row level security; alter table public.ro_calendario_anos enable row level security; alter table public.ro_passagem_documentos_internos enable row level security; alter table public.ro_auditoria_interna enable row level security;
grant select,insert,update,delete on public.ro_rh_responsaveis,public.ro_calendario_nao_util,public.ro_calendario_anos to authenticated;
grant select on public.ro_passagem_documentos_internos,public.ro_auditoria_interna to authenticated;
drop policy if exists ro_rh_select on public.ro_rh_responsaveis; create policy ro_rh_select on public.ro_rh_responsaveis for select to authenticated using(user_id=auth.uid() or public.ro_can_manage_rh());
drop policy if exists ro_rh_manage on public.ro_rh_responsaveis; create policy ro_rh_manage on public.ro_rh_responsaveis for all to authenticated using(public.ro_can_manage_rh()) with check(public.ro_can_manage_rh());
drop policy if exists ro_cal_select on public.ro_calendario_nao_util; create policy ro_cal_select on public.ro_calendario_nao_util for select to authenticated using(ativo or public.ro_can_manage_rh());
drop policy if exists ro_cal_manage on public.ro_calendario_nao_util; create policy ro_cal_manage on public.ro_calendario_nao_util for all to authenticated using(public.ro_can_manage_rh()) with check(public.ro_can_manage_rh());
drop policy if exists ro_cal_anos_select on public.ro_calendario_anos; create policy ro_cal_anos_select on public.ro_calendario_anos for select to authenticated using(true);
drop policy if exists ro_cal_anos_manage on public.ro_calendario_anos; create policy ro_cal_anos_manage on public.ro_calendario_anos for all to authenticated using(public.ro_can_manage_rh()) with check(public.ro_can_manage_rh());
drop policy if exists ro_doc_select on public.ro_passagem_documentos_internos; create policy ro_doc_select on public.ro_passagem_documentos_internos for select to authenticated using(public.ro_can_view_internal_document(solicitacao_id));
drop policy if exists ro_auditoria_select on public.ro_auditoria_interna; create policy ro_auditoria_select on public.ro_auditoria_interna for select to authenticated using(public.ro_can_manage_rh() or (solicitacao_id is not null and public.ro_can_view_internal_document(solicitacao_id)));
drop policy if exists ro_sol_select on public.ro_passagem_solicitacoes; create policy ro_sol_select on public.ro_passagem_solicitacoes for select to authenticated using(solicitante_id=auth.uid() or public.ro_can_view_all() or (public.ro_is_rh_active() and origem_solicitacao='rh'));
drop policy if exists ro_child_cost_select on public.ro_passagem_custos; create policy ro_child_cost_select on public.ro_passagem_custos for select to authenticated using(public.ro_can_view_all());
drop policy if exists ro_internal_storage_insert on storage.objects; create policy ro_internal_storage_insert on storage.objects for insert to authenticated with check(bucket_id='ro-documentos-internos' and owner_id::text=auth.uid()::text and lower(storage.extension(name))='pdf');
drop policy if exists ro_internal_storage_select on storage.objects; create policy ro_internal_storage_select on storage.objects for select to authenticated using(bucket_id='ro-documentos-internos' and exists(select 1 from public.ro_passagem_documentos_internos d where d.storage_path=name and public.ro_can_view_internal_document(d.solicitacao_id)));
drop policy if exists ro_internal_storage_delete_orphan on storage.objects; create policy ro_internal_storage_delete_orphan on storage.objects for delete to authenticated using(bucket_id='ro-documentos-internos' and owner_id::text=auth.uid()::text and not exists(select 1 from public.ro_passagem_documentos_internos d where d.storage_path=name));

revoke all on function public.ro_can_manage_rh(),public.ro_is_rh_active(uuid),public.ro_role(uuid),public.ro_can_view_internal_document(uuid),public.ro_admin_user_search(text),public.ro_prazo_regra(text,text),public.ro_data_minima_util(timestamptz,integer),public.ro_validar_nova_solicitacao(),public.ro_criar_solicitacao_validada(jsonb,jsonb),public.ro_invalidate_calendar_year(),public.ro_stamp_admin_row(),public.ro_stamp_calendar_year(),public.ro_audit_rh_change(),public.ro_audit_calendar_year() from public,anon;
grant execute on function public.ro_can_manage_rh(),public.ro_is_rh_active(uuid),public.ro_can_view_internal_document(uuid),public.ro_admin_user_search(text),public.ro_criar_solicitacao_validada(jsonb,jsonb) to authenticated;
create index if not exists ro_calendario_data_ativo_idx on public.ro_calendario_nao_util(data) where ativo;
create unique index if not exists ro_calendario_identidade_uidx on public.ro_calendario_nao_util(data,tipo,abrangencia,coalesce(estado,''),coalesce(municipio,''));
create index if not exists ro_rh_ativo_idx on public.ro_rh_responsaveis(user_id) where ativo;
create index if not exists ro_documentos_sol_categoria_idx on public.ro_passagem_documentos_internos(solicitacao_id,categoria);
create index if not exists ro_solicitacoes_origem_status_idx on public.ro_passagem_solicitacoes(origem_solicitacao,status,created_at desc);
ROLLBACK;

