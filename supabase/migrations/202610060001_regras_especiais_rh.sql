alter table public.ro_passagem_solicitacoes
  add column if not exists viajante_nome_informado text;

alter table public.ro_passagem_solicitacoes
  drop constraint if exists ro_solicitacao_pessoa_ck;
alter table public.ro_passagem_solicitacoes
  add constraint ro_solicitacao_pessoa_ck check (
    (viajante_nome_informado is null and (funcionario_id is not null or colaborador_id is not null))
    or
    (funcionario_id is null and colaborador_id is null and viajante_nome_informado is not null
      and char_length(viajante_nome_informado) between 3 and 150)
  );

create or replace function public.ro_validar_identidade_viajante_manual()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_nome text:=nullif(btrim(regexp_replace(coalesce(new.viajante_nome_informado,current_setting('ro.viajante_nome_informado',true)),E'\\s+',' ','g')),'');
begin
  new.viajante_nome_informado:=v_nome;
  if v_nome is not null then
    if not coalesce(public.ro_is_rh_active(auth.uid()),false) then
      raise exception 'VIAJANTE_MANUAL_APENAS_RH';
    end if;
    if char_length(v_nome) not between 3 and 150 then
      raise exception 'VIAJANTE_NOME_INVALIDO';
    end if;
    if new.funcionario_id is not null or new.colaborador_id is not null then
      raise exception 'IDENTIDADE_VIAJANTE_INCONSISTENTE';
    end if;
  elsif new.funcionario_id is null and new.colaborador_id is null then
    raise exception 'IDENTIDADE_EXPLICITA_OBRIGATORIA';
  end if;
  return new;
end $$;

drop trigger if exists ro_00_validar_identidade_viajante_manual on public.ro_passagem_solicitacoes;
create trigger ro_00_validar_identidade_viajante_manual
before insert or update of funcionario_id,colaborador_id,viajante_nome_informado
on public.ro_passagem_solicitacoes
for each row execute function public.ro_validar_identidade_viajante_manual();

-- Preserva integralmente a cadeia atual e injeta o novo campo no mesmo INSERT,
-- por configuração local lida pelo trigger anterior à constraint.
alter function public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb)
  rename to ro_criar_solicitacao_colaborador_validada_pre_rh_manual;
create function public.ro_criar_solicitacao_colaborador_validada(
  p_solicitacao jsonb,
  p_documentos jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_nome text:=nullif(btrim(regexp_replace(coalesce(p_solicitacao->>'viajante_nome_informado',''),E'\\s+',' ','g')),'');
begin
  if v_nome is not null and not coalesce(public.ro_is_rh_active(auth.uid()),false) then
    raise exception 'VIAJANTE_MANUAL_APENAS_RH';
  end if;
  perform set_config('ro.viajante_nome_informado',coalesce(v_nome,''),true);
  return public.ro_criar_solicitacao_colaborador_validada_pre_rh_manual(
    p_solicitacao-'viajante_nome_informado'-'viajante_modo',p_documentos
  );
end $$;

create or replace function public.ro_prazo_regra_efetiva(
  p_motivo text,
  p_subtipo text,
  p_user uuid default auth.uid()
)
returns table(regra_codigo text,prazo_tipo text,prazo_quantidade integer,categoria_documento text)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if coalesce(public.ro_is_rh_active(p_user),false) then
    if p_motivo='admissao' then return query select 'rh_admissao'::text,'dias_corridos'::text,7,null::text; return; end if;
    if p_motivo='inicio_obra' then return query select 'rh_inicio_obra'::text,'dias_corridos'::text,4,null::text; return; end if;
    if p_motivo='desligamento' and p_subtipo='programado_outros' then return query select 'rh_desligamento_programado_outros'::text,'dias_corridos'::text,5,null::text; return; end if;
    if p_motivo='viagem_administrativa' then return query select 'rh_viagem_administrativa'::text,'sem_prazo_minimo'::text,0,null::text; return; end if;
  end if;
  return query select * from public.ro_prazo_regra(p_motivo,p_subtipo);
end $$;

create or replace function public.ro_validar_nova_solicitacao()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_role text:=public.ro_role(auth.uid());
  v_is_gerencial boolean:=coalesce(v_role,'') in ('gerente','diretor');
  v_can_excepcionar_prazo boolean:=coalesce(v_role,'') in ('coordenador','gerente','diretor');
  v_operador_ro boolean:=coalesce(public.ro_is_operador_ativo(auth.uid()),false);
  v_rh boolean:=coalesce(public.ro_is_rh_active(auth.uid()),false);
  v_can_administrativo boolean:=coalesce(public.ro_can_view_all(),false);
  v_hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
  v_reg record; v_min date; v_categoria text;
begin
  if auth.uid() is null or new.solicitante_id is distinct from auth.uid() then raise exception 'SOLICITANTE_INVALIDO'; end if;
  if new.motivo='viagem_diretoria' then raise exception 'MOTIVO_NAO_DISPONIVEL'; end if;
  if new.motivo is null and not v_can_administrativo then raise exception 'MOTIVO_ADMINISTRATIVO_NAO_PERMITIDO'; end if;
  if not v_is_gerencial and v_rh and coalesce(new.motivo,'') not in ('admissao','desligamento','inicio_obra','viagem_administrativa') then raise exception 'MOTIVO_NAO_PERMITIDO'; end if;
  if not v_is_gerencial and not v_rh and new.motivo='admissao' then raise exception 'MOTIVO_NAO_PERMITIDO'; end if;
  if new.motivo='desligamento' and (new.desligamento_subtipo is null or coalesce(new.desligamento_subtipo,'') not in ('programado_outros','justa_causa','pedido_demissao','ma_conduta')) then raise exception 'SUBTIPO_DESLIGAMENTO_OBRIGATORIO'; end if;
  if new.motivo is distinct from 'desligamento' and new.desligamento_subtipo is not null then raise exception 'SUBTIPO_DESLIGAMENTO_INVALIDO'; end if;
  if new.data_ida is null then raise exception 'DATA_IDA_OBRIGATORIA'; end if;
  if new.data_ida<v_hoje and not v_operador_ro then raise exception 'DATA_IDA_NO_PASSADO'; end if;
  new.primeiro_embarque_em:=(new.data_ida+time '12:00') at time zone 'America/Sao_Paulo';
  select * into v_reg from public.ro_prazo_regra_efetiva(new.motivo,new.desligamento_subtipo,auth.uid());
  if v_reg.prazo_tipo='dias_uteis' then v_min:=public.ro_data_minima_util(now(),v_reg.prazo_quantidade);
  elsif v_reg.prazo_tipo='dias_corridos' then v_min:=v_hoje+v_reg.prazo_quantidade;
  else v_min:=v_hoje; end if;
  if tg_op='INSERT' then new.origem_solicitacao:=case when new.motivo is null then 'administrativo' when v_is_gerencial then 'gerencial' when v_rh then 'rh' else 'comum' end;
  else new.origem_solicitacao:=old.origem_solicitacao; end if;
  new.prazo_regra_codigo:=v_reg.regra_codigo; new.prazo_tipo:=v_reg.prazo_tipo; new.prazo_quantidade:=v_reg.prazo_quantidade; new.data_minima_permitida:=v_min; new.prazo_calculado_em:=now();
  if new.data_ida<v_min then
    if not v_operador_ro and not v_can_excepcionar_prazo then raise exception 'FORA_DO_PRAZO:%',v_min; end if;
    if not v_operador_ro and length(trim(coalesce(new.prazo_excecao_justificativa,new.justificativa_excecao_prazo,'')))<10 then raise exception 'JUSTIFICATIVA_EXCECAO_OBRIGATORIA'; end if;
    new.prazo_excecao:=true; new.prazo_excecao_por:=auth.uid(); new.prazo_excecao_em:=now();
    if v_operador_ro then new.prazo_excecao_justificativa:=null; new.justificativa_excecao_prazo:=null; end if;
  else
    new.prazo_excecao:=false; new.prazo_excecao_justificativa:=null; new.justificativa_excecao_prazo:=null; new.prazo_excecao_por:=null; new.prazo_excecao_em:=null;
  end if;
  v_categoria:=v_reg.categoria_documento;
  if v_categoria is not null and not exists(select 1 from public.ro_passagem_documentos_internos d where d.solicitacao_id=new.id and d.categoria=v_categoria) then raise exception 'DOCUMENTO_INTERNO_OBRIGATORIO:%',v_categoria; end if;
  if tg_op='UPDATE' then
    insert into public.ro_auditoria_interna(evento,solicitacao_id,detalhes,criado_por)
    values('solicitacao_revalidada',new.id,jsonb_build_object('motivo_anterior',old.motivo,'motivo_novo',new.motivo,'subtipo_anterior',old.desligamento_subtipo,'subtipo_novo',new.desligamento_subtipo,'data_ida_anterior',old.data_ida,'data_ida_nova',new.data_ida,'data_minima',new.data_minima_permitida,'excecao',new.prazo_excecao,'operador_ro',v_operador_ro),auth.uid());
  end if;
  return new;
end $$;

create or replace function public.ro_catalogo_centros_custo()
returns table(id uuid,nome text)
language sql stable security definer set search_path=''
as $$
  select o.id,o.nome
  from public.obras o
  where auth.uid() is not null
    and o.visivel_passagens
    and o.escopo_passagens in ('comum','restrito_ro')
    and (o.escopo_passagens='comum' or public.ro_can_view_all() or public.ro_is_rh_active(auth.uid()))
  order by o.nome;
$$;

create or replace function public.ro_validar_solicitacao_visibilidade()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_restrito boolean:=public.ro_can_view_all() or public.ro_is_rh_active(auth.uid());
begin
  if new.obra_id is null then raise exception 'Centro de custo atual é obrigatório';end if;
  if new.viajante_nome_informado is not null then
    if not public.ro_is_rh_active(auth.uid()) then raise exception 'VIAJANTE_MANUAL_APENAS_RH';end if;
  elsif new.colaborador_id is not null then
    if not exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.id=new.colaborador_id and e.ativo) then raise exception 'Colaborador indisponível para este solicitante';end if;
  elsif not exists(select 1 from public.funcionarios f where f.id=new.funcionario_id and f.ativo and f.deleted_at is null and f.visivel_passagens and (f.escopo_passagens='comum' or (v_restrito and f.escopo_passagens='restrito_ro'))) then raise exception 'Funcionário indisponível para este solicitante';end if;
  if not exists(select 1 from public.obras o where o.id=new.obra_id and o.visivel_passagens and o.escopo_passagens in('comum','restrito_ro') and (o.escopo_passagens='comum' or v_restrito)) then raise exception 'Centro de custo indisponível para este solicitante';end if;
  return new;
end $$;

drop trigger if exists ro_validar_solicitacao_visibilidade on public.ro_passagem_solicitacoes;
create trigger ro_validar_solicitacao_visibilidade
before insert or update of funcionario_id,colaborador_id,viajante_nome_informado,obra_id
on public.ro_passagem_solicitacoes
for each row execute function public.ro_validar_solicitacao_visibilidade();

create or replace function public.ro_nomes_colaboradores_solicitacoes(p_solicitacao_ids uuid[])
returns table(solicitacao_id uuid,funcionario_nome_exibicao text)
language sql stable security definer set search_path=''
as $$
  select s.id,coalesce(nullif(btrim(s.viajante_nome_informado),''),nullif(btrim(e.nome),''),nullif(btrim(f.nome),''))
  from public.ro_passagem_solicitacoes s
  left join public.ro_funcionarios_enderecos_privados e on e.id=s.colaborador_id
  left join public.funcionarios f on f.id=s.funcionario_id
  where auth.uid() is not null and public.ro_is_active_internal_user()
    and s.id=any(coalesce(p_solicitacao_ids,'{}'::uuid[]))
    and (s.excluida_em is null or public.ro_can_operate())
    and coalesce(nullif(btrim(s.viajante_nome_informado),''),nullif(btrim(e.nome),''),nullif(btrim(f.nome),'')) is not null;
$$;

create or replace function public.ro_obter_dados_emissao_passagem(p_solicitacao_id uuid)
returns table(nome text,data_nascimento date,cpf text,rg text,telefone text)
language plpgsql stable security definer set search_path='public','pg_temp'
as $$
declare v_colaborador_id uuid; v_funcionario_id uuid; v_nome_manual text;
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA'; end if;
  if not coalesce(public.ro_is_operador_ativo(auth.uid()),false) then raise exception 'APENAS_OPERADOR_RO_ATIVO'; end if;
  select s.colaborador_id,s.funcionario_id,s.viajante_nome_informado into v_colaborador_id,v_funcionario_id,v_nome_manual
  from public.ro_passagem_solicitacoes s where s.id=p_solicitacao_id and s.excluida_em is null;
  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA_OU_EXCLUIDA'; end if;
  if v_nome_manual is not null then return query select v_nome_manual,null::date,null::text,null::text,null::text; return; end if;
  return query select e.nome::text,e.data_nascimento::date,e.cpf::text,e.rg::text,e.telefone::text
  from public.ro_funcionarios_enderecos_privados e where e.ativo and ((v_colaborador_id is not null and e.id=v_colaborador_id) or (v_colaborador_id is null and v_funcionario_id is not null and e.funcionario_id=v_funcionario_id))
  order by (e.id=v_colaborador_id) desc,e.atualizado_em desc,e.id limit 1;
end $$;

create or replace function public.ro_notificar_equipe_solicitacao_liberada(p_solicitacao_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_nome text; v_sol public.ro_passagem_solicitacoes%rowtype; v_ro record;
begin
  select * into v_sol from public.ro_passagem_solicitacoes where id=p_solicitacao_id;
  if not found or v_sol.aprovacao_status not in('aprovada','dispensada') then raise exception 'SOLICITACAO_NAO_LIBERADA_PARA_O_RO'; end if;
  select coalesce(nullif(btrim(v_sol.viajante_nome_informado),''),nullif(btrim(e.nome),''),nullif(btrim(f.nome),'')) into v_nome
  from (select 1) x left join public.ro_funcionarios_enderecos_privados e on e.id=v_sol.colaborador_id left join public.funcionarios f on f.id=v_sol.funcionario_id;
  for v_ro in select r.user_id from public.ro_responsaveis r where r.ativo loop
    insert into public.ro_passagem_notificacoes(solicitacao_id,canal,destinatario_tipo,destinatario,mensagem)
    values(v_sol.id,'interno','ro',v_ro.user_id::text,format('Nova solicitação de passagem liberada para %s, motivo %s, origem %s, destino %s.',coalesce(v_nome,'Viajante não identificado'),v_sol.motivo,v_sol.origem,v_sol.destino));
  end loop;
end $$;

revoke all on function public.ro_validar_identidade_viajante_manual(),public.ro_prazo_regra_efetiva(text,text,uuid) from public,anon;
revoke all on function public.ro_criar_solicitacao_colaborador_validada_pre_rh_manual(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb),public.ro_catalogo_centros_custo(),public.ro_nomes_colaboradores_solicitacoes(uuid[]),public.ro_obter_dados_emissao_passagem(uuid) from public,anon;
grant execute on function public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb),public.ro_catalogo_centros_custo(),public.ro_nomes_colaboradores_solicitacoes(uuid[]),public.ro_obter_dados_emissao_passagem(uuid) to authenticated;
grant execute on function public.ro_prazo_regra_efetiva(text,text,uuid) to authenticated,service_role;
