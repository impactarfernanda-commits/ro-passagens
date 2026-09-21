-- Preencher exclusivamente com UUIDs e e-mail reconfirmados em produção.
-- Este script falha fechado enquanto qualquer valor permanecer nulo.
begin;

do $$
declare
  v_user_id uuid:=null::uuid; -- UUID confirmado em auth.users para o Yordan.
  v_funcionario_id uuid:=null::uuid; -- UUID confirmado em public.funcionarios para o Yordan.
  v_email_esperado text:=null::text; -- E-mail confirmado do mesmo auth user.
  v_executor_id uuid:=null::uuid; -- UUID confirmado de quem executa a operação administrativa.
  v_executor_email text:='fernanda.souza@tanksbr.com.br';
  v_total integer;
begin
  if v_user_id is null or v_funcionario_id is null or nullif(btrim(v_email_esperado),'') is null or v_executor_id is null then
    raise exception 'PREENCHA_IDS_E_EMAIL_CONFIRMADOS_ANTES_DE_EXECUTAR';
  end if;

  select count(*) into v_total
  from auth.users u
  where u.id=v_user_id and lower(coalesce(u.email,''))=lower(v_email_esperado);
  if v_total<>1 then raise exception 'AUTH_USER_ESPERADO_NAO_ENCONTRADO'; end if;

  select count(*) into v_total from public.funcionarios f where f.id=v_funcionario_id;
  if v_total<>1 then raise exception 'FUNCIONARIO_ESPERADO_NAO_ENCONTRADO'; end if;

  if not exists(
    select 1 from public.funcionarios f
    where f.id=v_funcionario_id
      and f.ativo
      and f.deleted_at is null
      and f.visivel_passagens
      and f.escopo_passagens='restrito_ro'
  ) then
    raise exception 'FUNCIONARIO_NAO_MANTEM_PRECONDICOES_RESTRITO_RO';
  end if;

  select count(*) into v_total
  from public.user_roles r
  where r.user_id=v_user_id and r.role::text='coordenador';
  if v_total<>1 then raise exception 'PERFIL_COORDENADOR_ESPERADO_NAO_CONFIRMADO'; end if;

  select count(*) into v_total
  from auth.users u
  join public.user_roles r on r.user_id=u.id and r.role::text='diretor'
  where u.id=v_executor_id and lower(coalesce(u.email,''))=lower(v_executor_email);
  if v_total<>1 then raise exception 'EXECUTOR_ADMINISTRATIVO_NAO_CONFIRMADO'; end if;

  if exists(
    select 1 from public.ro_usuario_funcionario_vinculos v
    where v.ativo and v.user_id=v_user_id and v.funcionario_id<>v_funcionario_id
  ) then raise exception 'USUARIO_JA_POSSUI_OUTRO_VINCULO_ATIVO'; end if;

  if exists(
    select 1 from public.ro_usuario_funcionario_vinculos v
    where v.ativo and v.funcionario_id=v_funcionario_id and v.user_id<>v_user_id
  ) then raise exception 'FUNCIONARIO_JA_POSSUI_OUTRO_VINCULO_ATIVO'; end if;

  insert into public.ro_usuario_funcionario_vinculos(
    user_id,funcionario_id,ativo,criado_por,atualizado_por
  ) values(
    v_user_id,v_funcionario_id,true,v_executor_id,v_executor_id
  )
  on conflict(user_id,funcionario_id) do update
  set ativo=true,atualizado_em=now(),atualizado_por=excluded.atualizado_por;

  perform set_config('ro.manual_yordan_user_id',v_user_id::text,true);
  perform set_config('ro.manual_yordan_funcionario_id',v_funcionario_id::text,true);
end;
$$;

select id,user_id,funcionario_id,ativo,criado_em,criado_por,atualizado_em,atualizado_por
from public.ro_usuario_funcionario_vinculos
where user_id=current_setting('ro.manual_yordan_user_id')::uuid
  and funcionario_id=current_setting('ro.manual_yordan_funcionario_id')::uuid;

commit;
