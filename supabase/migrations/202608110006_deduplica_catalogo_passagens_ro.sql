begin;

create or replace function public.ro_correspondencia_nome_catalogo_ro(p_nome_legado text,p_nome_privado text)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare
 a text:=public.ro_normalizar_nome_colaborador(p_nome_legado);b text:=public.ro_normalizar_nome_colaborador(p_nome_privado);
 sa text;sb text;ta text[];tb text[];small text[];big text[];i int:=1;t text;
begin
 a:=trim(regexp_replace(a,'[^a-z0-9]+',' ','g'));b:=trim(regexp_replace(b,'[^a-z0-9]+',' ','g'));
 if a='' or b='' then return null;end if;
 if a=b then return 'DUPLICIDADE_EXATA';end if;
 sa:=regexp_replace(trim(regexp_replace(' '||a||' ',' (de|da|do|das|dos|e) ',' ','g')),' +',' ','g');
 sb:=regexp_replace(trim(regexp_replace(' '||b||' ',' (de|da|do|das|dos|e) ',' ','g')),' +',' ','g');
 if sa=sb then return 'PARTICULA_DIVERGENTE';end if;
 ta:=string_to_array(sa,' ');tb:=string_to_array(sb,' ');
 if cardinality(ta)=cardinality(tb) and cardinality(ta)>1
  and ta[1:cardinality(ta)-1]=tb[1:cardinality(tb)-1]
  and least(length(ta[cardinality(ta)]),length(tb[cardinality(tb)]))>=5
  and (ta[cardinality(ta)] like tb[cardinality(tb)]||'%' or tb[cardinality(tb)] like ta[cardinality(ta)]||'%')
 then return 'SOBRENOME_TRUNCADO';end if;
 if cardinality(ta)=cardinality(tb) then return null;end if;
 if cardinality(ta)<cardinality(tb) then small:=ta;big:=tb;else small:=tb;big:=ta;end if;
 if small[1]<>big[1] or small[cardinality(small)]<>big[cardinality(big)] then return null;end if;
 foreach t in array big loop if i<=cardinality(small) and t=small[i] then i:=i+1;end if;end loop;
 if i=cardinality(small)+1 then return 'NOME_INTERMEDIARIO_AUSENTE';end if;
 return null;
end $$;

create or replace function public.ro_catalogo_colaboradores_viagem()
returns table(id uuid,nome text,funcionario_id uuid,ativo boolean,visivel_obras_control boolean,visivel_passagens boolean,escopo_passagens text)
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
 select p.id,p.nome,p.funcionario_id,p.ativo,coalesce(f.visivel_obras_control,false),true,case when f.id is null then 'restrito_ro' else f.escopo_passagens end
 from privados p left join public.funcionarios f on f.id=p.funcionario_id
 where auth.uid() is not null
 union all
 select f.id,f.nome,f.id,true,f.visivel_obras_control,f.visivel_passagens,f.escopo_passagens
 from public.funcionarios f
 where auth.uid() is not null and f.ativo and f.deleted_at is null and f.visivel_passagens
  and not exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.funcionario_id=f.id)
  and not (
   f.escopo_passagens='restrito_ro' and not f.visivel_obras_control
   and exists(select 1 from unicos u where u.legado_id=f.id)
  )
 order by 2;
$$;

revoke all on function public.ro_correspondencia_nome_catalogo_ro(text,text),public.ro_catalogo_colaboradores_viagem() from public,anon;
grant execute on function public.ro_catalogo_colaboradores_viagem() to authenticated;

commit;

