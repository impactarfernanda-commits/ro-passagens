begin;

create table public.ro_usuario_funcionario_vinculos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid not null references auth.users(id) on delete restrict,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid not null references auth.users(id) on delete restrict,
  constraint ro_usuario_funcionario_vinculos_par_uidx unique (user_id,funcionario_id)
);

create unique index ro_usuario_funcionario_vinculos_user_ativo_uidx
  on public.ro_usuario_funcionario_vinculos(user_id)
  where ativo;
create unique index ro_usuario_funcionario_vinculos_funcionario_ativo_uidx
  on public.ro_usuario_funcionario_vinculos(funcionario_id)
  where ativo;

alter table public.ro_usuario_funcionario_vinculos enable row level security;
revoke all on table public.ro_usuario_funcionario_vinculos from public,anon,authenticated,service_role;
grant select,insert,update on table public.ro_usuario_funcionario_vinculos to service_role;

create or replace function public.ro_proteger_usuario_funcionario_vinculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.funcionario_id is distinct from old.funcionario_id
    or new.criado_em is distinct from old.criado_em
    or new.criado_por is distinct from old.criado_por
  then
    raise exception 'IDENTIDADE_VINCULO_IMUTAVEL';
  end if;
  new.atualizado_em:=now();
  return new;
end;
$$;

create trigger ro_proteger_usuario_funcionario_vinculo
before update on public.ro_usuario_funcionario_vinculos
for each row execute function public.ro_proteger_usuario_funcionario_vinculo();

create or replace function public.ro_auditar_usuario_funcionario_vinculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ro_auditoria_interna(evento,detalhes,criado_por)
  values(
    'vinculo_usuario_funcionario_alterado',
    jsonb_build_object(
      'vinculo_id',new.id,
      'user_id',new.user_id,
      'funcionario_id',new.funcionario_id,
      'ativo',new.ativo,
      'operacao',tg_op
    ),
    coalesce(auth.uid(),new.atualizado_por,new.criado_por)
  );
  return new;
end;
$$;

create trigger ro_auditar_usuario_funcionario_vinculo
after insert or update on public.ro_usuario_funcionario_vinculos
for each row execute function public.ro_auditar_usuario_funcionario_vinculo();

create or replace function public.ro_funcionario_disponivel_para_usuario(
  p_user_id uuid,
  p_funcionario_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_funcionario_id is not null
    and exists(
      select 1
      from public.funcionarios f
      where f.id=p_funcionario_id
        and f.ativo
        and f.deleted_at is null
        and f.visivel_passagens
        and (
          f.escopo_passagens='comum'
          or (
            f.escopo_passagens='restrito_ro'
            and (
              coalesce(public.ro_can_view_all(p_user_id),false)
              or exists(
                select 1
                from public.ro_usuario_funcionario_vinculos v
                where v.user_id=p_user_id
                  and v.funcionario_id=f.id
                  and v.ativo
              )
            )
          )
        )
    );
$$;

revoke all on function public.ro_funcionario_disponivel_para_usuario(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ro_funcionario_disponivel_para_usuario(uuid,uuid) to service_role;

create or replace function public.ro_validar_solicitacao_visibilidade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restrito boolean:=public.ro_can_view_all();
begin
  if new.obra_id is null then
    raise exception 'Centro de custo atual é obrigatório';
  end if;
  if new.colaborador_id is not null then
    if not exists(
      select 1
      from public.ro_funcionarios_enderecos_privados e
      where e.id=new.colaborador_id and e.ativo
    ) then
      raise exception 'Colaborador indisponível para este solicitante';
    end if;
  elsif not public.ro_funcionario_disponivel_para_usuario(auth.uid(),new.funcionario_id) then
    raise exception 'Funcionário indisponível para este solicitante';
  end if;
  if not exists(
    select 1
    from public.obras o
    where o.id=new.obra_id
      and o.visivel_passagens
      and (o.escopo_passagens='comum' or (v_restrito and o.escopo_passagens='restrito_ro'))
  ) then
    raise exception 'Centro de custo indisponível para este solicitante';
  end if;
  return new;
end;
$$;

create or replace function public.ro_catalogo_colaboradores_viagem()
returns table(
  id uuid,
  nome text,
  funcionario_id uuid,
  ativo boolean,
  visivel_obras_control boolean,
  visivel_passagens boolean,
  escopo_passagens text,
  obra_id uuid,
  obra_nome text
)
language sql
stable
security definer
set search_path = ''
as $$
  with privados as(
    select e.*,split_part(regexp_replace(trim(regexp_replace(' '||public.ro_normalizar_nome_colaborador(e.nome)||' ',' (de|da|do|das|dos|e) ',' ','g')),' +',' ','g'),' ',1) primeiro_nome
    from public.ro_funcionarios_enderecos_privados e
    where e.ativo and public.ro_can_view_private_addresses()
  ),legados as(
    select f.*,split_part(regexp_replace(trim(regexp_replace(' '||public.ro_normalizar_nome_colaborador(f.nome)||' ',' (de|da|do|das|dos|e) ',' ','g')),' +',' ','g'),' ',1) primeiro_nome
    from public.funcionarios f
    where public.ro_funcionario_disponivel_para_usuario(auth.uid(),f.id)
      and f.escopo_passagens='restrito_ro'
      and not f.visivel_obras_control
  ),candidatos as(
    select l.id legado_id,p.id privado_id
    from legados l join privados p on p.primeiro_nome=l.primeiro_nome
    where public.ro_correspondencia_nome_catalogo_ro(l.nome,p.nome) is not null
  ),unicos as(
    select legado_id from candidatos group by legado_id having count(*)=1
  )
  select p.id,p.nome,p.funcionario_id,p.ativo,coalesce(f.visivel_obras_control,false),true,
         case when f.id is null then 'restrito_ro' else f.escopo_passagens end,
         atual.obra_id,o.nome
  from privados p
  left join public.funcionarios f
    on f.id=p.funcionario_id
   and f.ativo
   and f.deleted_at is null
   and f.visivel_obras_control
  left join lateral(
    select a.obra_id from public.alocacoes a
    where a.funcionario_id=f.id
    order by a.data desc
    limit 1
  ) atual on true
  left join public.obras o on o.id=atual.obra_id
  where auth.uid() is not null
  union all
  select f.id,f.nome,f.id,true,f.visivel_obras_control,f.visivel_passagens,f.escopo_passagens,
         atual.obra_id,o.nome
  from public.funcionarios f
  left join lateral(
    select a.obra_id from public.alocacoes a
    where a.funcionario_id=f.id
    order by a.data desc
    limit 1
  ) atual on f.visivel_obras_control
  left join public.obras o on o.id=atual.obra_id
  where public.ro_funcionario_disponivel_para_usuario(auth.uid(),f.id)
    and not exists(
      select 1
      from public.ro_funcionarios_enderecos_privados e
      where e.funcionario_id=f.id
    )
    and not (
      f.escopo_passagens='restrito_ro'
      and not f.visivel_obras_control
      and exists(select 1 from unicos u where u.legado_id=f.id)
    )
  order by 2;
$$;

revoke all on function public.ro_auditar_usuario_funcionario_vinculo() from public,anon,authenticated;
revoke all on function public.ro_proteger_usuario_funcionario_vinculo() from public,anon,authenticated;
revoke all on function public.ro_validar_solicitacao_visibilidade() from public,anon,authenticated;
revoke all on function public.ro_catalogo_colaboradores_viagem() from public,anon;
grant execute on function public.ro_catalogo_colaboradores_viagem() to authenticated,service_role;

commit;
