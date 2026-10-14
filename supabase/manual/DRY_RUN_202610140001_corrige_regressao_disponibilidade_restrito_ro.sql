begin;

-- DRY_RUN_MIGRATION_BEGIN
create or replace function public.ro_validar_solicitacao_visibilidade()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_restrito boolean:=public.ro_can_view_all() or public.ro_is_rh_active(auth.uid());
begin
  if new.obra_id is null then raise exception 'Centro de custo atual é obrigatório';end if;
  if new.viajante_nome_informado is not null then
    if not public.ro_is_rh_active(auth.uid()) then raise exception 'VIAJANTE_MANUAL_APENAS_RH';end if;
  elsif new.colaborador_id is not null then
    if not exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.id=new.colaborador_id and e.ativo) then raise exception 'Colaborador indisponível para este solicitante';end if;
  elsif not public.ro_funcionario_disponivel_para_usuario(auth.uid(),new.funcionario_id) then raise exception 'Funcionário indisponível para este solicitante';end if;
  if not exists(select 1 from public.obras o where o.id=new.obra_id and o.visivel_passagens and o.escopo_passagens in('comum','restrito_ro') and (o.escopo_passagens='comum' or v_restrito)) then raise exception 'Centro de custo indisponível para este solicitante';end if;
  return new;
end $$;
-- DRY_RUN_MIGRATION_END

create temporary table dry_restrito_ro_checks(
  indicador text primary key,
  aprovado boolean not null,
  detalhe text not null
) on commit drop;

do $dry$
declare
  v_user uuid:=gen_random_uuid();
  v_restrito uuid;
  v_comum uuid;
  v_inativo uuid;
  v_excluido uuid;
  v_invisivel uuid;
  v_indisponivel uuid;
  v_cc_valido uuid;
  v_cc_invalido uuid;
  v_id uuid;
  v_erro text;
  v_role_count integer;
  v_role text;
  v_def text:=pg_get_functiondef('public.ro_validar_solicitacao_visibilidade()'::regprocedure);
  v_payload_base jsonb;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','dry-run-140001-'||v_user||'@example.invalid','',now(),'{"provider":"email","providers":["email"]}','{"fixture":"dry_run_140001"}',now(),now());

  -- on_auth_user_created/handle_new_user cria exatamente uma role assistente.
  -- A fixture transacional reutiliza essa linha e muda somente o usuário sintético.
  update public.user_roles set role='coordenador' where user_id=v_user;
  select count(*),min(role::text) into v_role_count,v_role
  from public.user_roles where user_id=v_user;
  if v_role_count<>1 or v_role is distinct from 'coordenador' then
    raise exception 'FIXTURE_ROLE_INVALIDA: quantidade=%, role=%',v_role_count,coalesce(v_role,'null');
  end if;

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  if public.ro_can_view_all(v_user) or public.ro_is_rh_active(v_user) or public.ro_is_operador_ativo(v_user) then
    raise exception 'FIXTURE_SOLICITANTE_NAO_COMUM';
  end if;

  insert into public.funcionarios(nome,categoria_mo,ativo,deleted_at,visivel_obras_control,visivel_passagens,escopo_passagens) values
    ('DRY140001-RESTRITO','Administrativo',true,null,false,true,'restrito_ro'),
    ('DRY140001-COMUM','Administrativo',true,null,false,true,'comum'),
    ('DRY140001-INATIVO','Administrativo',false,null,false,true,'restrito_ro'),
    ('DRY140001-EXCLUIDO','Administrativo',true,now(),false,true,'restrito_ro'),
    ('DRY140001-INVISIVEL','Administrativo',true,null,false,false,'restrito_ro'),
    ('DRY140001-INDISPONIVEL','Administrativo',true,null,false,true,'indisponivel');

  select id into v_restrito from public.funcionarios where nome='DRY140001-RESTRITO';
  select id into v_comum from public.funcionarios where nome='DRY140001-COMUM';
  select id into v_inativo from public.funcionarios where nome='DRY140001-INATIVO';
  select id into v_excluido from public.funcionarios where nome='DRY140001-EXCLUIDO';
  select id into v_invisivel from public.funcionarios where nome='DRY140001-INVISIVEL';
  select id into v_indisponivel from public.funcionarios where nome='DRY140001-INDISPONIVEL';

  insert into public.obras(codigo,nome,descricao,tipo_centro_custo,visivel_obras_control,visivel_passagens,escopo_passagens) values
    ('DRY140001-OK','DRY140001-CC-VALIDO','Fixture transacional','administrativo',false,true,'comum'),
    ('DRY140001-BLOQ','DRY140001-CC-INVALIDO','Fixture transacional','administrativo',false,false,'comum');
  select id into v_cc_valido from public.obras where codigo='DRY140001-OK';
  select id into v_cc_invalido from public.obras where codigo='DRY140001-BLOQ';

  v_payload_base:=jsonb_build_object(
    'obra_id',v_cc_valido,'origem','Origem Sintética - SP','destino','Destino Sintético - RO',
    'motivo','transferencia_obra','data_ida',((now() at time zone 'America/Sao_Paulo')::date+60)::text,
    'pix_viajante','dry-run-pix-nao-real@example.invalid','aprovador_id',v_user
  );

  insert into dry_restrito_ro_checks values(
    'helper_restrito_ro_disponivel',
    public.ro_funcionario_disponivel_para_usuario(v_user,v_restrito),
    'helper canônico aceita a fixture restrito_ro para solicitante autenticado'
  );

  v_id:=public.ro_criar_solicitacao_com_aprovador(v_payload_base||jsonb_build_object('funcionario_id',v_restrito),'[]'::jsonb);
  insert into dry_restrito_ro_checks
  select 'solicitante_comum_pode_restrito_ro',count(*)=1,'solicitacao='||v_id
  from public.ro_passagem_solicitacoes where id=v_id and funcionario_id=v_restrito and solicitante_id=v_user;

  v_id:=public.ro_criar_solicitacao_com_aprovador(v_payload_base||jsonb_build_object('funcionario_id',v_comum),'[]'::jsonb);
  insert into dry_restrito_ro_checks
  select 'funcionario_comum_preservado',count(*)=1,'solicitacao='||v_id
  from public.ro_passagem_solicitacoes where id=v_id and funcionario_id=v_comum;

  foreach v_id in array array[v_inativo,v_excluido,v_invisivel,v_indisponivel] loop
    v_erro:=null;
    begin
      perform public.ro_criar_solicitacao_com_aprovador(v_payload_base||jsonb_build_object('funcionario_id',v_id),'[]'::jsonb);
    exception when others then v_erro:=sqlerrm;
    end;
    insert into dry_restrito_ro_checks values(
      case v_id when v_inativo then 'inativo_bloqueado' when v_excluido then 'excluido_bloqueado' when v_invisivel then 'invisivel_passagens_bloqueado' else 'indisponivel_bloqueado' end,
      v_erro like '%Funcionário indisponível para este solicitante%',coalesce(v_erro,'nenhum erro')
    );
  end loop;

  v_erro:=null;
  begin
    perform public.ro_criar_solicitacao_com_aprovador(
      (v_payload_base||jsonb_build_object('funcionario_id',v_comum,'obra_id',v_cc_invalido)),'[]'::jsonb
    );
  exception when others then v_erro:=sqlerrm;
  end;
  insert into dry_restrito_ro_checks values(
    'cc_invalido_continua_bloqueado',v_erro like '%Centro de custo indisponível para este solicitante%',coalesce(v_erro,'nenhum erro')
  );

  insert into dry_restrito_ro_checks values(
    'regras_rh_preservadas',
    v_def like '%viajante_nome_informado%' and v_def like '%ro_is_rh_active(auth.uid())%'
      and v_def like '%VIAJANTE_MANUAL_APENAS_RH%' and v_def like '%colaborador_id%',
    'ramos de viajante manual, RH e colaborador histórico continuam presentes'
  );
  insert into dry_restrito_ro_checks values(
    'catalogo_trigger_alinhados',
    public.ro_funcionario_disponivel_para_usuario(v_user,v_restrito)
      and v_def ~* 'ro_funcionario_disponivel_para_usuario\s*\(\s*auth\.uid\(\)\s*,\s*new\.funcionario_id\s*\)',
    'helper do catálogo também governa funcionario_id no trigger'
  );
end $dry$;

select indicador,aprovado,detalhe from dry_restrito_ro_checks order by indicador;
select bool_and(aprovado) as todos_aprovados from dry_restrito_ro_checks;

rollback;
