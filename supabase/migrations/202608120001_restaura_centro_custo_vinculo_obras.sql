begin;

drop function if exists public.ro_catalogo_colaboradores_viagem();
create function public.ro_catalogo_colaboradores_viagem()
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
language sql stable security definer set search_path=public,pg_temp as $$
 with privados as(
  select e.*,split_part(regexp_replace(trim(regexp_replace(' '||public.ro_normalizar_nome_colaborador(e.nome)||' ',' (de|da|do|das|dos|e) ',' ','g')),' +',' ','g'),' ',1) primeiro_nome
  from public.ro_funcionarios_enderecos_privados e where e.ativo
 ),legados as(
  select f.*,split_part(regexp_replace(trim(regexp_replace(' '||public.ro_normalizar_nome_colaborador(f.nome)||' ',' (de|da|do|das|dos|e) ',' ','g')),' +',' ','g'),' ',1) primeiro_nome
  from public.funcionarios f
  where f.ativo and f.deleted_at is null and f.visivel_passagens and f.escopo_passagens='restrito_ro' and not f.visivel_obras_control
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
 where auth.uid() is not null and f.ativo and f.deleted_at is null and f.visivel_passagens
  and not exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.funcionario_id=f.id)
  and not (
   f.escopo_passagens='restrito_ro' and not f.visivel_obras_control
   and exists(select 1 from unicos u where u.legado_id=f.id)
  )
 order by 2;
$$;

revoke all on function public.ro_catalogo_colaboradores_viagem() from public,anon;
grant execute on function public.ro_catalogo_colaboradores_viagem() to authenticated;

commit;
