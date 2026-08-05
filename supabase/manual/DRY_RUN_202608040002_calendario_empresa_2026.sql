begin;

alter table public.ro_calendario_nao_util
  drop constraint if exists ro_calendario_abrangencia_ck;
alter table public.ro_calendario_nao_util
  drop constraint if exists ro_calendario_nao_util_abrangencia_check;
alter table public.ro_calendario_nao_util
  drop constraint if exists ro_calendario_nao_util_tipo_check;

alter table public.ro_calendario_nao_util
  add constraint ro_calendario_nao_util_tipo_check
  check (tipo in ('feriado','ponto_facultativo','convencao_coletiva','recesso'));
alter table public.ro_calendario_nao_util
  add constraint ro_calendario_abrangencia_ck check (
    (abrangencia = 'nacional' and estado is null and municipio is null) or
    (abrangencia = 'estadual' and estado = 'SP' and municipio is null) or
    (abrangencia = 'municipal' and estado = 'SP' and municipio = 'Rio Claro') or
    (abrangencia = 'empresa' and estado is null and municipio is null)
  );

create or replace function public.ro_data_minima_util(p_agora timestamptz,p_quantidade integer)
returns date language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_local timestamp:=p_agora at time zone 'America/Sao_Paulo'; v_data date:=v_local::date; v_restante integer:=p_quantidade; v_util boolean; v_ano integer; v_primeiro boolean:=true;
begin
  while v_restante>0 loop
    v_ano:=extract(year from v_data);
    if not exists(select 1 from public.ro_calendario_anos a where a.ano=v_ano and a.completo) then raise exception 'CALENDARIO_INCOMPLETO:%',v_ano; end if;
    v_util:=extract(isodow from v_data)<6 and not exists(
      select 1 from public.ro_calendario_nao_util c
      where c.data=v_data and c.ativo and (
        c.abrangencia='nacional' or
        (c.abrangencia='estadual' and c.estado='SP' and c.municipio is null) or
        (c.abrangencia='municipal' and c.estado='SP' and c.municipio='Rio Claro') or
        (c.abrangencia='empresa' and c.estado is null and c.municipio is null)
      )
    );
    if v_util and not (v_primeiro and ((extract(isodow from v_data)=5 and v_local::time>time '15:30') or (extract(isodow from v_data)<5 and v_local::time>time '16:30'))) then v_restante:=v_restante-1; if v_restante=0 then return v_data; end if; end if;
    v_primeiro:=false;
    v_data:=v_data+1;
  end loop; return v_data;
end $$;

revoke all on function public.ro_data_minima_util(timestamptz,integer) from public;
grant execute on function public.ro_data_minima_util(timestamptz,integer) to authenticated;

merge into public.ro_calendario_nao_util as destino
using (values
  ('2026-01-01'::date,'Ano Novo','feriado','nacional',null::text,null::text,true),
  ('2026-04-03'::date,'Paixão de Cristo','feriado','nacional',null,null,true),
  ('2026-04-21'::date,'Tiradentes','feriado','nacional',null,null,true),
  ('2026-05-01'::date,'Dia do Trabalhador','feriado','nacional',null,null,true),
  ('2026-06-04'::date,'Corpus Christi','feriado','estadual','SP',null,true),
  ('2026-06-24'::date,'Aniversário de Rio Claro','feriado','municipal','SP','Rio Claro',true),
  ('2026-07-09'::date,'Revolução Constitucionalista','feriado','estadual','SP',null,true),
  ('2026-09-07'::date,'Independência do Brasil','feriado','nacional',null,null,true),
  ('2026-10-12'::date,'Nossa Senhora Aparecida','feriado','nacional',null,null,true),
  ('2026-11-02'::date,'Finados','feriado','nacional',null,null,true),
  ('2026-11-15'::date,'Proclamação da República','feriado','nacional',null,null,true),
  ('2026-11-20'::date,'Consciência Negra','feriado','nacional',null,null,true),
  ('2026-12-25'::date,'Natal','feriado','nacional',null,null,true),
  ('2026-12-24'::date,'Convenção coletiva','convencao_coletiva','empresa',null,null,true),
  ('2026-12-31'::date,'Convenção coletiva','convencao_coletiva','empresa',null,null,true),
  ('2026-02-16'::date,'Carnaval — dia-ponte','ponto_facultativo','empresa',null,null,true),
  ('2026-02-17'::date,'Carnaval — dia-ponte','ponto_facultativo','empresa',null,null,true),
  ('2026-04-20'::date,'Ponte de Tiradentes','ponto_facultativo','empresa',null,null,true),
  ('2026-06-05'::date,'Ponte de Corpus Christi','ponto_facultativo','empresa',null,null,true),
  ('2026-07-10'::date,'Ponte da Revolução Constitucionalista','ponto_facultativo','empresa',null,null,true),
  ('2026-12-21'::date,'Recesso final de ano — pendente de confirmação','recesso','empresa',null,null,false),
  ('2026-12-22'::date,'Recesso final de ano — pendente de confirmação','recesso','empresa',null,null,false),
  ('2026-12-23'::date,'Recesso final de ano — pendente de confirmação','recesso','empresa',null,null,false),
  ('2026-12-28'::date,'Recesso final de ano — pendente de confirmação','recesso','empresa',null,null,false),
  ('2026-12-29'::date,'Recesso final de ano — pendente de confirmação','recesso','empresa',null,null,false),
  ('2026-12-30'::date,'Recesso final de ano — pendente de confirmação','recesso','empresa',null,null,false)
) as origem(data,descricao,tipo,abrangencia,estado,municipio,ativo)
on destino.data=origem.data
  and destino.tipo=origem.tipo
  and destino.abrangencia=origem.abrangencia
  and destino.estado is not distinct from origem.estado
  and destino.municipio is not distinct from origem.municipio
when matched then update set descricao=origem.descricao,ativo=origem.ativo
when not matched then insert(data,descricao,tipo,abrangencia,estado,municipio,ativo)
  values(origem.data,origem.descricao,origem.tipo,origem.abrangencia,origem.estado,origem.municipio,origem.ativo);

insert into public.ro_calendario_anos(ano,completo,observacoes)
values(2026,true,'Calendário corporativo TanksBR 2026 carregado por migration. Seis datas de recesso permanecem inativas e pendentes de confirmação.')
on conflict(ano) do update set completo=true,observacoes=excluded.observacoes;

rollback;
