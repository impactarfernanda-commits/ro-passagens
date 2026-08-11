begin;

create or replace function public.ro_interpretar_cidade_uf_residencial(p_cidade text,p_uf text)
returns table(possui_endereco boolean,cidade text,uf text)
language plpgsql immutable set search_path=public,pg_temp as $$
declare
  v_cidade text:=nullif(trim(p_cidade),'');
  v_uf_explicita text:=nullif(upper(trim(p_uf)),'');
  v_uf_embutida text;
  v_ufs constant text[]:=array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
begin
  if v_cidade is null then return query select false,null::text,v_uf_explicita;return;end if;
  v_uf_embutida:=substring(upper(v_cidade) from '[-/][[:space:]]*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)[[:space:]]*$');
  if v_uf_explicita=any(v_ufs) then
    return query select true,
      case when v_uf_embutida=v_uf_explicita then nullif(trim(regexp_replace(v_cidade,'[[:space:]]*[-/][[:space:]]*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)[[:space:]]*$','','i')),'') else v_cidade end,
      v_uf_explicita;
    return;
  end if;
  if v_uf_embutida=any(v_ufs) then
    return query select true,nullif(trim(regexp_replace(v_cidade,'[[:space:]]*[-/][[:space:]]*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)[[:space:]]*$','','i')),''),v_uf_embutida;
    return;
  end if;
  return query select false,v_cidade,null::text;
end $$;

create or replace function public.ro_obter_destino_colaborador_resumido(p_colaborador_id uuid)
returns table(possui_endereco boolean,cidade text,uf text)
language sql stable security definer set search_path=public,pg_temp as $$
 select i.possui_endereco,i.cidade,i.uf
 from public.ro_funcionarios_enderecos_privados e
 cross join lateral public.ro_interpretar_cidade_uf_residencial(e.cidade,e.uf) i
 where e.id=p_colaborador_id and auth.uid() is not null;
$$;

-- A validação de gravação reutiliza a mesma leitura para férias, folga de campo e recesso.
create or replace function public.ro_aplicar_destino_residencial()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_end record;v_interpretado record;begin
 if new.motivo not in ('ferias','folga_campo','recesso') then new.destino_residencial_origem:=null;new.destino_residencial_justificativa:=null;return new;end if;
 if new.destino_residencial_origem='excepcional' then if length(trim(coalesce(new.destino_residencial_justificativa,'')))<10 then raise exception 'JUSTIFICATIVA_DESTINO_EXCEPCIONAL_OBRIGATORIA';end if;return new;end if;
 select cidade,uf into v_end from public.ro_funcionarios_enderecos_privados where id=new.colaborador_id or (new.colaborador_id is null and funcionario_id=new.funcionario_id) order by id=new.colaborador_id desc limit 1;
 if not found then raise exception 'ENDERECO_RESIDENCIAL_NAO_CADASTRADO';end if;
 select * into v_interpretado from public.ro_interpretar_cidade_uf_residencial(v_end.cidade,v_end.uf);
 if not v_interpretado.possui_endereco then raise exception 'ENDERECO_RESIDENCIAL_NAO_CADASTRADO';end if;
 new.destino:=v_interpretado.cidade||' / '||v_interpretado.uf;new.destino_residencial_origem:='rh';new.destino_residencial_justificativa:=null;return new;
end $$;

revoke all on function public.ro_interpretar_cidade_uf_residencial(text,text) from public,anon;
grant execute on function public.ro_interpretar_cidade_uf_residencial(text,text) to authenticated;

rollback;
