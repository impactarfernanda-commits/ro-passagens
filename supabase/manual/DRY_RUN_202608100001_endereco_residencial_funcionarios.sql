begin;

create table public.ro_funcionarios_enderecos_privados(
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,
  nome_referencia text not null,
  cep text, logradouro text, numero text, complemento text, bairro text,
  cidade text not null, uf text not null,
  criado_em timestamptz not null default now(), criado_por uuid not null references auth.users(id),
  atualizado_em timestamptz not null default now(), atualizado_por uuid not null references auth.users(id),
  constraint ro_endereco_funcionario_unico unique(funcionario_id),
  constraint ro_endereco_cidade_ck check(length(trim(cidade))>0),
  constraint ro_endereco_uf_ck check(upper(uf) in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  constraint ro_endereco_cep_ck check(cep is null or cep ~ '^\d{8}$')
);
create index ro_endereco_atualizado_idx on public.ro_funcionarios_enderecos_privados(atualizado_em desc);

alter table public.ro_passagem_solicitacoes
  add column destino_residencial_origem text,
  add column destino_residencial_justificativa text,
  add constraint ro_destino_residencial_origem_ck check(destino_residencial_origem is null or destino_residencial_origem in ('rh','excepcional')),
  add constraint ro_destino_residencial_justificativa_ck check(destino_residencial_origem<>'excepcional' or length(trim(destino_residencial_justificativa))>=10);

create table public.ro_enderecos_importacoes_auditoria(
  id uuid primary key default gen_random_uuid(), arquivo_nome text not null,
  linhas_processadas integer not null check(linhas_processadas>=0), importadas integer not null check(importadas>=0),
  atualizadas integer not null check(atualizadas>=0), ignoradas integer not null check(ignoradas>=0),
  correspondencias_manuais integer not null default 0 check(correspondencias_manuais>=0),
  criado_em timestamptz not null default now(), criado_por uuid not null references auth.users(id)
);

create or replace function public.ro_can_manage_private_addresses(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public,auth,pg_temp as $$
  select p_user is not null and (coalesce(public.ro_is_rh_active(p_user),false) or exists(select 1 from auth.users u where u.id=p_user and lower(u.email)=lower('fernanda.souza@tanksbr.com.br')));
$$;
create or replace function public.ro_can_view_private_addresses(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public,auth,pg_temp as $$
  select public.ro_can_manage_private_addresses(p_user) or coalesce(public.ro_is_operador_ativo(p_user),false);
$$;

alter table public.ro_funcionarios_enderecos_privados enable row level security;
alter table public.ro_enderecos_importacoes_auditoria enable row level security;
create policy ro_endereco_select_restrito on public.ro_funcionarios_enderecos_privados for select to authenticated using(public.ro_can_view_private_addresses());
create policy ro_endereco_insert_rh on public.ro_funcionarios_enderecos_privados for insert to authenticated with check(public.ro_can_manage_private_addresses() and criado_por=auth.uid() and atualizado_por=auth.uid());
create policy ro_endereco_update_rh on public.ro_funcionarios_enderecos_privados for update to authenticated using(public.ro_can_manage_private_addresses()) with check(public.ro_can_manage_private_addresses() and atualizado_por=auth.uid());
create policy ro_endereco_delete_rh on public.ro_funcionarios_enderecos_privados for delete to authenticated using(public.ro_can_manage_private_addresses());
create policy ro_endereco_audit_select on public.ro_enderecos_importacoes_auditoria for select to authenticated using(public.ro_can_manage_private_addresses());

create or replace function public.ro_obter_destino_residencial_resumido(p_funcionario_id uuid)
returns table(possui_endereco boolean,cidade text,uf text) language sql stable security definer set search_path=public,pg_temp as $$
  select e.funcionario_id is not null,e.cidade,e.uf from (select 1) x
  left join public.ro_funcionarios_enderecos_privados e on e.funcionario_id=p_funcionario_id
  where auth.uid() is not null and exists(select 1 from public.funcionarios f where f.id=p_funcionario_id and f.ativo and f.deleted_at is null and f.visivel_passagens and (f.escopo_passagens='comum' or public.ro_can_view_all()));
$$;
create or replace function public.ro_obter_endereco_residencial_completo(p_funcionario_id uuid)
returns table(cep text,logradouro text,numero text,complemento text,bairro text,cidade text,uf text,atualizado_em timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select e.cep,e.logradouro,e.numero,e.complemento,e.bairro,e.cidade,e.uf,e.atualizado_em
  from public.ro_funcionarios_enderecos_privados e where e.funcionario_id=p_funcionario_id and public.ro_can_view_private_addresses();
$$;
create or replace function public.ro_catalogo_funcionarios_enderecos()
returns table(id uuid,nome text,possui_endereco boolean,atualizado_em timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$ begin
  if not public.ro_can_manage_private_addresses() then raise exception 'ACESSO_NEGADO'; end if;
  return query select f.id,f.nome,e.id is not null,e.atualizado_em from public.funcionarios f left join public.ro_funcionarios_enderecos_privados e on e.funcionario_id=f.id where f.ativo and f.deleted_at is null and f.visivel_obras_control order by f.nome;
end $$;

create or replace function public.ro_salvar_endereco_funcionario(p_funcionario_id uuid,p_endereco jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$ declare v_id uuid; v_cep text:=regexp_replace(coalesce(p_endereco->>'cep',''),'\D','','g'); begin
  if not public.ro_can_manage_private_addresses() then raise exception 'ACESSO_NEGADO'; end if;
  if not exists(select 1 from public.funcionarios f where f.id=p_funcionario_id and f.ativo and f.deleted_at is null and f.visivel_obras_control) then raise exception 'FUNCIONARIO_NAO_CADASTRADO_NO_OBRAS_CONTROL'; end if;
  insert into public.ro_funcionarios_enderecos_privados(funcionario_id,nome_referencia,cep,logradouro,numero,complemento,bairro,cidade,uf,criado_por,atualizado_por)
  select f.id,f.nome,nullif(v_cep,''),nullif(trim(p_endereco->>'logradouro'),''),nullif(trim(p_endereco->>'numero'),''),nullif(trim(p_endereco->>'complemento'),''),nullif(trim(p_endereco->>'bairro'),''),trim(p_endereco->>'cidade'),upper(trim(p_endereco->>'uf')),auth.uid(),auth.uid() from public.funcionarios f where f.id=p_funcionario_id
  on conflict(funcionario_id) do update set nome_referencia=excluded.nome_referencia,cep=excluded.cep,logradouro=excluded.logradouro,numero=excluded.numero,complemento=excluded.complemento,bairro=excluded.bairro,cidade=excluded.cidade,uf=excluded.uf,atualizado_em=now(),atualizado_por=auth.uid()
  returning id into v_id;
  insert into public.ro_auditoria_interna(evento,detalhes,criado_por) values('endereco_residencial_salvo',jsonb_build_object('funcionario_id',p_funcionario_id),auth.uid()); return v_id;
end $$;

create or replace function public.ro_importar_enderecos_funcionarios(p_arquivo_nome text,p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ declare v jsonb;v_total int:=jsonb_array_length(coalesce(p_linhas,'[]'));v_importados int:=0;v_atualizados int:=0;v_manuais int:=0;v_id uuid; begin
  if not public.ro_can_manage_private_addresses() then raise exception 'ACESSO_NEGADO'; end if;
  if length(trim(coalesce(p_arquivo_nome,'')))=0 then raise exception 'ARQUIVO_OBRIGATORIO'; end if;
  for v in select value from jsonb_array_elements(coalesce(p_linhas,'[]')) loop
    if v->>'status'='seguro' and exists(select 1 from public.funcionarios f where f.id=(v->>'funcionario_id')::uuid and f.ativo and f.deleted_at is null and f.visivel_obras_control) then
      if exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.funcionario_id=(v->>'funcionario_id')::uuid) then v_atualizados:=v_atualizados+1; end if;
      v_id:=public.ro_salvar_endereco_funcionario((v->>'funcionario_id')::uuid,v);v_importados:=v_importados+1;
      if coalesce((v->>'confirmado_manual')::boolean,false) then v_manuais:=v_manuais+1; end if;
    end if;
  end loop;
  insert into public.ro_enderecos_importacoes_auditoria(arquivo_nome,linhas_processadas,importadas,atualizadas,ignoradas,correspondencias_manuais,criado_por) values(p_arquivo_nome,v_total,v_importados,v_atualizados,v_total-v_importados,v_manuais,auth.uid());
  return jsonb_build_object('processadas',v_total,'importados',v_importados,'atualizados',v_atualizados,'ignorados',v_total-v_importados);
end $$;

create or replace function public.ro_aplicar_destino_residencial() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ declare v_end record;v_excepcional boolean:=coalesce(current_setting('ro.destino_excepcional',true),'')='1'; begin
  if new.motivo not in ('ferias','folga_campo','recesso') then new.destino_residencial_origem:=null;new.destino_residencial_justificativa:=null;return new;end if;
  v_excepcional:=coalesce(new.destino_residencial_origem='excepcional',false);
  if v_excepcional then if length(trim(coalesce(new.destino_residencial_justificativa,'')))<10 then raise exception 'JUSTIFICATIVA_DESTINO_EXCEPCIONAL_OBRIGATORIA';end if;new.destino_residencial_origem:='excepcional';return new;end if;
  select cidade,uf into v_end from public.ro_funcionarios_enderecos_privados where funcionario_id=new.funcionario_id;
  if not found then raise exception 'ENDERECO_RESIDENCIAL_NAO_CADASTRADO';end if;
  new.destino:=v_end.cidade||' / '||v_end.uf;new.destino_residencial_origem:='rh';new.destino_residencial_justificativa:=null;return new;
end $$;
drop trigger if exists ro_aplicar_destino_residencial on public.ro_passagem_solicitacoes;
create trigger ro_aplicar_destino_residencial before insert or update of funcionario_id,motivo,destino,destino_residencial_origem,destino_residencial_justificativa on public.ro_passagem_solicitacoes for each row execute function public.ro_aplicar_destino_residencial();

create or replace function public.ro_criar_solicitacao_validada(p_solicitacao jsonb,p_documentos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_id uuid:=coalesce(nullif(p_solicitacao->>'id','')::uuid,gen_random_uuid());v_doc jsonb;v_obj storage.objects%rowtype;v_justificativa text;v_motivo text:=nullif(p_solicitacao->>'motivo','');v_tem_retorno boolean;v_retorno_indefinido boolean;v_destino_tipo text;v_destino_justificativa text;
begin
  v_tem_retorno:=public.ro_motivo_possui_retorno(v_motivo);v_retorno_indefinido:=v_tem_retorno and coalesce((p_solicitacao->>'retorno_indefinido')::boolean,false);
  v_justificativa:=case when coalesce((p_solicitacao->>'solicitar_excecao_prazo')::boolean,false) then nullif(trim(p_solicitacao->>'justificativa_excecao_prazo'),'') end;
  v_destino_tipo:=case when v_motivo in ('ferias','folga_campo','recesso') and coalesce((p_solicitacao->>'usar_destino_excepcional')::boolean,false) then 'excepcional' when v_motivo in ('ferias','folga_campo','recesso') then 'rh' end;
  v_destino_justificativa:=case when v_destino_tipo='excepcional' then nullif(trim(p_solicitacao->>'destino_residencial_justificativa'),'') end;
  for v_doc in select value from jsonb_array_elements(coalesce(p_documentos,'[]'::jsonb)) loop
    select * into v_obj from storage.objects o where o.bucket_id='ro-documentos-internos' and o.name=v_doc->>'storage_path' and o.owner_id::text=auth.uid()::text;
    if not found then raise exception 'DOCUMENTO_NAO_ENCONTRADO_OU_SEM_PERMISSAO';end if;if (v_doc->>'storage_path') not like v_id::text||'/'||(v_doc->>'categoria')||'/%' then raise exception 'CAMINHO_DOCUMENTO_INVALIDO';end if;
    if coalesce(v_obj.metadata->>'mimetype','')<>'application/pdf' or lower(storage.extension(v_obj.name))<>'pdf' then raise exception 'DOCUMENTO_NAO_PDF';end if;if coalesce((v_obj.metadata->>'size')::bigint,0)<=0 or (v_obj.metadata->>'size')::bigint>10485760 then raise exception 'DOCUMENTO_TAMANHO_INVALIDO';end if;
    insert into public.ro_passagem_documentos_internos(id,solicitacao_id,categoria,storage_path,arquivo_nome,mime_type,tamanho_bytes,created_by) values(gen_random_uuid(),v_id,v_doc->>'categoria',v_doc->>'storage_path',v_doc->>'arquivo_nome','application/pdf',(v_obj.metadata->>'size')::bigint,auth.uid());
  end loop;
  insert into public.ro_passagem_solicitacoes(id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,primeiro_embarque_em,data_retorno,destino_retorno,centro_custo_retorno_id,retorno_indefinido,centro_custo_destino_id,desligamento_subtipo,prazo_excecao_justificativa,justificativa_excecao_prazo,observacoes_solicitante,solicitacao_origem_id,folga_antecipacao_justificativa,destino_residencial_origem,destino_residencial_justificativa)
  values(v_id,(p_solicitacao->>'funcionario_id')::uuid,nullif(p_solicitacao->>'obra_id','')::uuid,auth.uid(),p_solicitacao->>'origem',p_solicitacao->>'destino',v_motivo,nullif(p_solicitacao->>'data_ida','')::date,null,case when v_tem_retorno then nullif(p_solicitacao->>'data_retorno','')::date end,case when v_tem_retorno and not v_retorno_indefinido then nullif(trim(p_solicitacao->>'destino_retorno'),'') end,case when v_tem_retorno and not v_retorno_indefinido then nullif(p_solicitacao->>'centro_custo_retorno_id','')::uuid end,v_retorno_indefinido,nullif(p_solicitacao->>'centro_custo_destino_id','')::uuid,nullif(p_solicitacao->>'desligamento_subtipo',''),v_justificativa,v_justificativa,nullif(p_solicitacao->>'observacoes_solicitante',''),nullif(p_solicitacao->>'solicitacao_origem_id','')::uuid,nullif(trim(p_solicitacao->>'folga_antecipacao_justificativa'),''),v_destino_tipo,v_destino_justificativa);
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) select 'solicitacao_validada',v_id,jsonb_build_object('regra',s.prazo_regra_codigo,'tipo',s.prazo_tipo,'quantidade',s.prazo_quantidade,'data_minima',s.data_minima_permitida,'data_ida',s.data_ida,'excecao',s.prazo_excecao,'destino_residencial_origem',s.destino_residencial_origem),auth.uid() from public.ro_passagem_solicitacoes s where s.id=v_id;
  insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) select 'documento_interno_anexado',v_id,jsonb_build_object('categoria',d.categoria),auth.uid() from public.ro_passagem_documentos_internos d where d.solicitacao_id=v_id;return v_id;
end $$;

revoke all on table public.ro_funcionarios_enderecos_privados,public.ro_enderecos_importacoes_auditoria from public,anon,authenticated;
grant select,insert,update,delete on public.ro_funcionarios_enderecos_privados to authenticated;
grant select on public.ro_enderecos_importacoes_auditoria to authenticated;
revoke all on function public.ro_can_manage_private_addresses(uuid),public.ro_can_view_private_addresses(uuid),public.ro_obter_destino_residencial_resumido(uuid),public.ro_obter_endereco_residencial_completo(uuid),public.ro_catalogo_funcionarios_enderecos(),public.ro_salvar_endereco_funcionario(uuid,jsonb),public.ro_importar_enderecos_funcionarios(text,jsonb),public.ro_aplicar_destino_residencial(),public.ro_criar_solicitacao_validada(jsonb,jsonb) from public,anon;
grant execute on function public.ro_obter_destino_residencial_resumido(uuid),public.ro_obter_endereco_residencial_completo(uuid),public.ro_catalogo_funcionarios_enderecos(),public.ro_salvar_endereco_funcionario(uuid,jsonb),public.ro_importar_enderecos_funcionarios(text,jsonb) to authenticated;
grant execute on function public.ro_can_manage_private_addresses(uuid),public.ro_can_view_private_addresses(uuid) to authenticated;
grant execute on function public.ro_criar_solicitacao_validada(jsonb,jsonb) to authenticated;

rollback;