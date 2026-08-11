begin;

-- O schema real já possui nome próprio e funcionario_id opcional.
alter table public.ro_funcionarios_enderecos_privados
  add column if not exists data_nascimento date,
  add column if not exists cpf text,
  add column if not exists rg text,
  add column if not exists telefone text,
  add column if not exists ativo boolean not null default true;
alter table public.ro_funcionarios_enderecos_privados
  alter column cidade drop not null,
  alter column uf drop not null;
alter table public.ro_funcionarios_enderecos_privados drop constraint if exists ro_endereco_cidade_ck;
alter table public.ro_funcionarios_enderecos_privados drop constraint if exists ro_endereco_uf_ck;
alter table public.ro_funcionarios_enderecos_privados drop constraint if exists ro_colaborador_cpf_ck;
alter table public.ro_funcionarios_enderecos_privados drop constraint if exists ro_colaborador_uf_ck;
alter table public.ro_funcionarios_enderecos_privados
  add constraint ro_colaborador_cpf_ck check(cpf is null or cpf ~ '^\d{11}$' and cpf !~ '^(\d)\1{10}$'),
  add constraint ro_colaborador_uf_ck check(uf is null or upper(uf) in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'));
create unique index if not exists ro_colaborador_cpf_unico_idx on public.ro_funcionarios_enderecos_privados(cpf) where cpf is not null;
create index if not exists ro_colaborador_nome_idx on public.ro_funcionarios_enderecos_privados(lower(nome));
create index if not exists ro_colaborador_telefone_idx on public.ro_funcionarios_enderecos_privados(telefone) where telefone is not null;

alter table public.ro_passagem_solicitacoes add column if not exists colaborador_id uuid references public.ro_funcionarios_enderecos_privados(id) on delete restrict;
alter table public.ro_passagem_solicitacoes alter column funcionario_id drop not null;
alter table public.ro_passagem_solicitacoes drop constraint if exists ro_solicitacao_pessoa_ck;
alter table public.ro_passagem_solicitacoes add constraint ro_solicitacao_pessoa_ck check(funcionario_id is not null or colaborador_id is not null);
create index if not exists ro_solicitacao_colaborador_idx on public.ro_passagem_solicitacoes(colaborador_id);

create or replace function public.ro_validar_solicitacao_visibilidade()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ declare v_restrito boolean:=public.ro_can_view_all();begin
 if new.obra_id is null then raise exception 'Centro de custo atual é obrigatório';end if;
 if new.colaborador_id is not null then
  if not exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.id=new.colaborador_id and e.ativo) then raise exception 'Colaborador indisponível para este solicitante';end if;
 elsif not exists(select 1 from public.funcionarios f where f.id=new.funcionario_id and f.ativo and f.deleted_at is null and f.visivel_passagens and (f.escopo_passagens='comum' or (v_restrito and f.escopo_passagens='restrito_ro'))) then raise exception 'Funcionário indisponível para este solicitante';end if;
 if not exists(select 1 from public.obras o where o.id=new.obra_id and o.visivel_passagens and (o.escopo_passagens='comum' or (v_restrito and o.escopo_passagens='restrito_ro'))) then raise exception 'Centro de custo indisponível para este solicitante';end if;return new;end $$;
drop trigger if exists ro_validar_solicitacao_visibilidade on public.ro_passagem_solicitacoes;
create trigger ro_validar_solicitacao_visibilidade before insert or update of funcionario_id,colaborador_id,obra_id on public.ro_passagem_solicitacoes for each row execute function public.ro_validar_solicitacao_visibilidade();

create table if not exists public.ro_colaboradores_auditoria(
  id uuid primary key default gen_random_uuid(), colaborador_id uuid references public.ro_funcionarios_enderecos_privados(id) on delete restrict,
  operacao text not null check(operacao in ('importacao','criacao','atualizacao','vinculacao','desvinculacao','ativacao','inativacao')),
  campos_alterados text[] not null default '{}', arquivo_nome text, criado_em timestamptz not null default now(), criado_por uuid not null references auth.users(id)
);
alter table public.ro_colaboradores_auditoria enable row level security;
drop policy if exists ro_colaborador_auditoria_manage on public.ro_colaboradores_auditoria;
create policy ro_colaborador_auditoria_manage on public.ro_colaboradores_auditoria for select to authenticated using(public.ro_can_manage_private_addresses());

-- Compatibilidade da RPC histórica com o nome real da coluna privada.
create or replace function public.ro_salvar_endereco_funcionario(p_funcionario_id uuid,p_endereco jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_cep text:=nullif(regexp_replace(coalesce(p_endereco->>'cep',''),'\D','','g'),'');begin
 if not public.ro_can_manage_private_addresses() then raise exception 'ACESSO_NEGADO';end if;
 if not exists(select 1 from public.funcionarios f where f.id=p_funcionario_id and f.ativo and f.deleted_at is null and f.visivel_obras_control) then raise exception 'FUNCIONARIO_NAO_CADASTRADO_NO_OBRAS_CONTROL';end if;
 insert into public.ro_funcionarios_enderecos_privados(funcionario_id,nome,cep,logradouro,numero,complemento,bairro,cidade,uf,criado_por,atualizado_por)
 select f.id,f.nome,v_cep,nullif(trim(p_endereco->>'logradouro'),''),nullif(trim(p_endereco->>'numero'),''),nullif(trim(p_endereco->>'complemento'),''),nullif(trim(p_endereco->>'bairro'),''),nullif(trim(p_endereco->>'cidade'),''),nullif(upper(trim(p_endereco->>'uf')),''),auth.uid(),auth.uid() from public.funcionarios f where f.id=p_funcionario_id
 on conflict(funcionario_id) do update set nome=excluded.nome,cep=coalesce(excluded.cep,public.ro_funcionarios_enderecos_privados.cep),logradouro=coalesce(excluded.logradouro,public.ro_funcionarios_enderecos_privados.logradouro),numero=coalesce(excluded.numero,public.ro_funcionarios_enderecos_privados.numero),complemento=coalesce(excluded.complemento,public.ro_funcionarios_enderecos_privados.complemento),bairro=coalesce(excluded.bairro,public.ro_funcionarios_enderecos_privados.bairro),cidade=coalesce(excluded.cidade,public.ro_funcionarios_enderecos_privados.cidade),uf=coalesce(excluded.uf,public.ro_funcionarios_enderecos_privados.uf),atualizado_em=now(),atualizado_por=auth.uid()
 returning id into v_id;
 insert into public.ro_auditoria_interna(evento,detalhes,criado_por) values('endereco_residencial_salvo',jsonb_build_object('funcionario_id',p_funcionario_id),auth.uid());return v_id;end $$;

create or replace function public.ro_catalogo_colaboradores_viagem()
returns table(id uuid,nome text,funcionario_id uuid,ativo boolean,visivel_obras_control boolean,visivel_passagens boolean,escopo_passagens text)
language sql stable security definer set search_path=public,pg_temp as $$
  select e.id,e.nome,e.funcionario_id,e.ativo,coalesce(f.visivel_obras_control,false),true,case when f.id is null then 'restrito_ro' else f.escopo_passagens end
  from public.ro_funcionarios_enderecos_privados e left join public.funcionarios f on f.id=e.funcionario_id
  where auth.uid() is not null and e.ativo
  union all
  select f.id,f.nome,f.id,true,f.visivel_obras_control,f.visivel_passagens,f.escopo_passagens from public.funcionarios f
  where auth.uid() is not null and f.ativo and f.deleted_at is null and f.visivel_passagens
    and not exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.funcionario_id=f.id)
  order by 2;
$$;

create or replace function public.ro_obter_colaborador_resumo(p_colaborador_id uuid)
returns table(id uuid,nome text,cidade text,uf text) language sql stable security definer set search_path=public,pg_temp as $$
 select e.id,e.nome,e.cidade,e.uf from public.ro_funcionarios_enderecos_privados e where e.id=p_colaborador_id and auth.uid() is not null;
$$;
create or replace function public.ro_obter_colaborador_detalhe(p_colaborador_id uuid)
returns table(id uuid,funcionario_id uuid,nome text,data_nascimento date,cpf text,rg text,telefone text,logradouro text,bairro text,cidade text,uf text,ativo boolean,atualizado_em timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select e.id,e.funcionario_id,e.nome,e.data_nascimento,e.cpf,e.rg,e.telefone,e.logradouro,e.bairro,e.cidade,e.uf,e.ativo,e.atualizado_em
 from public.ro_funcionarios_enderecos_privados e where e.id=p_colaborador_id and public.ro_can_view_private_addresses();
$$;
create or replace function public.ro_catalogo_colaboradores_privado(p_busca text default null)
returns table(id uuid,funcionario_id uuid,nome text,data_nascimento date,cpf text,rg text,telefone text,logradouro text,bairro text,cidade text,uf text,ativo boolean,atualizado_em timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$ begin
 if not public.ro_can_view_private_addresses() then raise exception 'ACESSO_NEGADO'; end if;
 return query select e.id,e.funcionario_id,e.nome,e.data_nascimento,e.cpf,e.rg,e.telefone,e.logradouro,e.bairro,e.cidade,e.uf,e.ativo,e.atualizado_em
 from public.ro_funcionarios_enderecos_privados e where nullif(trim(p_busca),'') is null or lower(e.nome) like '%'||lower(trim(p_busca))||'%' or e.cpf like '%'||regexp_replace(p_busca,'\D','','g')||'%' or e.telefone like '%'||regexp_replace(p_busca,'\D','','g')||'%' order by e.nome; end $$;

create or replace function public.ro_salvar_colaborador_viagem(p_colaborador jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid:=nullif(p_colaborador->>'id','')::uuid;v_old public.ro_funcionarios_enderecos_privados%rowtype;v_cpf text:=nullif(regexp_replace(coalesce(p_colaborador->>'cpf',''),'\D','','g'),'');v_phone text:=nullif(regexp_replace(coalesce(p_colaborador->>'telefone',''),'\D','','g'),'');v_op text;begin
 if not public.ro_can_manage_private_addresses() then raise exception 'ACESSO_NEGADO';end if;
 if length(trim(coalesce(p_colaborador->>'nome','')))=0 then raise exception 'NOME_OBRIGATORIO';end if;
 if v_cpf is not null and (length(v_cpf)<>11 or v_cpf ~ '^(\d)\1{10}$') then raise exception 'CPF_INVALIDO';end if;
 if v_id is not null then select * into v_old from public.ro_funcionarios_enderecos_privados where id=v_id for update;end if;
 if v_id is null then
  insert into public.ro_funcionarios_enderecos_privados(funcionario_id,nome,data_nascimento,cpf,rg,telefone,logradouro,bairro,cidade,uf,ativo,criado_por,atualizado_por)
  values(nullif(p_colaborador->>'funcionario_id','')::uuid,trim(p_colaborador->>'nome'),nullif(p_colaborador->>'data_nascimento','')::date,v_cpf,nullif(trim(p_colaborador->>'rg'),''),v_phone,nullif(trim(p_colaborador->>'logradouro'),''),nullif(trim(p_colaborador->>'bairro'),''),nullif(trim(p_colaborador->>'cidade'),''),nullif(upper(trim(p_colaborador->>'estado')),''),coalesce((p_colaborador->>'ativo')::boolean,true),auth.uid(),auth.uid()) returning id into v_id;v_op:='criacao';
 else
  update public.ro_funcionarios_enderecos_privados set funcionario_id=case when p_colaborador?'funcionario_id' then nullif(p_colaborador->>'funcionario_id','')::uuid else funcionario_id end,nome=trim(p_colaborador->>'nome'),data_nascimento=coalesce(nullif(p_colaborador->>'data_nascimento','')::date,data_nascimento),cpf=coalesce(v_cpf,cpf),rg=coalesce(nullif(trim(p_colaborador->>'rg'),''),rg),telefone=coalesce(v_phone,telefone),logradouro=coalesce(nullif(trim(p_colaborador->>'logradouro'),''),logradouro),bairro=coalesce(nullif(trim(p_colaborador->>'bairro'),''),bairro),cidade=coalesce(nullif(trim(p_colaborador->>'cidade'),''),cidade),uf=coalesce(nullif(upper(trim(p_colaborador->>'estado')),''),uf),ativo=coalesce((p_colaborador->>'ativo')::boolean,ativo),atualizado_em=now(),atualizado_por=auth.uid() where id=v_id;v_op:='atualizacao';
 end if;
 insert into public.ro_colaboradores_auditoria(colaborador_id,operacao,campos_alterados,criado_por) values(v_id,v_op,array(select jsonb_object_keys(p_colaborador-'cpf'-'rg')),auth.uid());return v_id;end $$;

create or replace function public.ro_importar_colaboradores_rh(p_arquivo_nome text,p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;v_id uuid;v_total int:=jsonb_array_length(coalesce(p_linhas,'[]'));v_novos int:=0;v_updates int:=0;v_erros int:=0;begin
 if not public.ro_can_manage_private_addresses() then raise exception 'ACESSO_NEGADO';end if;
 for v in select value from jsonb_array_elements(coalesce(p_linhas,'[]')) loop
  if v->>'status' not in ('novo','atualizacao','vinculado') then v_erros:=v_erros+1;continue;end if;
  v_id:=nullif(v->>'colaborador_id','')::uuid;if v_id is null then v_novos:=v_novos+1;else v_updates:=v_updates+1;end if;
  v_id:=public.ro_salvar_colaborador_viagem(v||jsonb_build_object('id',v_id));
  insert into public.ro_colaboradores_auditoria(colaborador_id,operacao,campos_alterados,arquivo_nome,criado_por) values(v_id,'importacao',array(select jsonb_object_keys(v-'cpf'-'rg')),p_arquivo_nome,auth.uid());
 end loop;
 insert into public.ro_enderecos_importacoes_auditoria(arquivo_nome,linhas_processadas,importadas,atualizadas,ignoradas,correspondencias_manuais,criado_por) values(p_arquivo_nome,v_total,v_novos+v_updates,v_updates,v_erros,0,auth.uid());
 return jsonb_build_object('processadas',v_total,'novos',v_novos,'atualizados',v_updates,'ignorados',v_erros,'funcionarios_obras_criados',0);end $$;

create or replace function public.ro_obter_destino_colaborador_resumido(p_colaborador_id uuid)
returns table(possui_endereco boolean,cidade text,uf text) language sql stable security definer set search_path=public,pg_temp as $$
 select e.cidade is not null and e.uf is not null,e.cidade,e.uf from public.ro_funcionarios_enderecos_privados e where e.id=p_colaborador_id and auth.uid() is not null;
$$;

create or replace function public.ro_criar_solicitacao_colaborador_validada(p_solicitacao jsonb,p_documentos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_colaborador uuid:=nullif(p_solicitacao->>'colaborador_id','')::uuid;v_funcionario uuid:=nullif(p_solicitacao->>'funcionario_id','')::uuid;v_id uuid:=coalesce(nullif(p_solicitacao->>'id','')::uuid,gen_random_uuid());v_motivo text:=nullif(p_solicitacao->>'motivo','');begin
 if v_colaborador is null then return public.ro_criar_solicitacao_validada(p_solicitacao,p_documentos);end if;
 select funcionario_id into v_funcionario from public.ro_funcionarios_enderecos_privados where id=v_colaborador and ativo;
 if not found then raise exception 'COLABORADOR_INATIVO_OU_INEXISTENTE';end if;
 if jsonb_array_length(coalesce(p_documentos,'[]'))>0 then raise exception 'DOCUMENTO_EXTERNO_NAO_SUPORTADO';end if;
 insert into public.ro_passagem_solicitacoes(id,colaborador_id,funcionario_id,obra_id,solicitante_id,origem,destino,motivo,data_ida,data_retorno,destino_retorno,centro_custo_retorno_id,retorno_indefinido,centro_custo_destino_id,desligamento_subtipo,justificativa_excecao_prazo,observacoes_solicitante,solicitacao_origem_id,folga_antecipacao_justificativa,destino_residencial_origem,destino_residencial_justificativa)
 values(v_id,v_colaborador,v_funcionario,nullif(p_solicitacao->>'obra_id','')::uuid,auth.uid(),p_solicitacao->>'origem',p_solicitacao->>'destino',v_motivo,nullif(p_solicitacao->>'data_ida','')::date,nullif(p_solicitacao->>'data_retorno','')::date,nullif(trim(p_solicitacao->>'destino_retorno'),''),nullif(p_solicitacao->>'centro_custo_retorno_id','')::uuid,coalesce((p_solicitacao->>'retorno_indefinido')::boolean,false),nullif(p_solicitacao->>'centro_custo_destino_id','')::uuid,nullif(p_solicitacao->>'desligamento_subtipo',''),nullif(trim(p_solicitacao->>'justificativa_excecao_prazo'),''),nullif(p_solicitacao->>'observacoes_solicitante',''),nullif(p_solicitacao->>'solicitacao_origem_id','')::uuid,nullif(trim(p_solicitacao->>'folga_antecipacao_justificativa'),''),case when coalesce((p_solicitacao->>'usar_destino_excepcional')::boolean,false) then 'excepcional' when v_motivo in ('ferias','folga_campo','recesso') then 'rh' end,nullif(trim(p_solicitacao->>'destino_residencial_justificativa'),''));
 insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por) values('solicitacao_colaborador_privado_criada',v_id,jsonb_build_object('colaborador_id',v_colaborador,'vinculado_obras',v_funcionario is not null),auth.uid());return v_id;end $$;

-- O trigger passa a resolver primeiro pelo snapshot de vínculo privado.
create or replace function public.ro_aplicar_destino_residencial() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ declare v_end record;begin
 if new.motivo not in ('ferias','folga_campo','recesso') then new.destino_residencial_origem:=null;new.destino_residencial_justificativa:=null;return new;end if;
 if new.destino_residencial_origem='excepcional' then if length(trim(coalesce(new.destino_residencial_justificativa,'')))<10 then raise exception 'JUSTIFICATIVA_DESTINO_EXCEPCIONAL_OBRIGATORIA';end if;return new;end if;
 select cidade,uf into v_end from public.ro_funcionarios_enderecos_privados where id=new.colaborador_id or (new.colaborador_id is null and funcionario_id=new.funcionario_id) order by id=new.colaborador_id desc limit 1;
 if not found or v_end.cidade is null or v_end.uf is null then raise exception 'ENDERECO_RESIDENCIAL_NAO_CADASTRADO';end if;
 new.destino:=v_end.cidade||' / '||v_end.uf;new.destino_residencial_origem:='rh';new.destino_residencial_justificativa:=null;return new;end $$;

revoke all on public.ro_colaboradores_auditoria from public,anon,authenticated;grant select on public.ro_colaboradores_auditoria to authenticated;
revoke all on function public.ro_catalogo_colaboradores_viagem(),public.ro_obter_colaborador_resumo(uuid),public.ro_obter_colaborador_detalhe(uuid),public.ro_catalogo_colaboradores_privado(text),public.ro_salvar_colaborador_viagem(jsonb),public.ro_importar_colaboradores_rh(text,jsonb),public.ro_obter_destino_colaborador_resumido(uuid),public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb) from public,anon;
grant execute on function public.ro_catalogo_colaboradores_viagem(),public.ro_obter_colaborador_resumo(uuid),public.ro_obter_colaborador_detalhe(uuid),public.ro_catalogo_colaboradores_privado(text),public.ro_salvar_colaborador_viagem(jsonb),public.ro_importar_colaboradores_rh(text,jsonb),public.ro_obter_destino_colaborador_resumido(uuid),public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb) to authenticated;

commit;
