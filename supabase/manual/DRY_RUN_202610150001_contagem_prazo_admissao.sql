begin;

-- Captura os objetos instalados antes da redefinição para comparar semântica
-- e estruturalmente o estado anterior com o estado temporário do dry run.
create temp table contagem_admissao_definicoes_antes on commit drop as
select
  pg_get_functiondef('public.ro_prazo_regra_efetiva(text,text,uuid)'::regprocedure) as regra,
  pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure) as validador;

-- DRY_RUN_MIGRATION_BEGIN
-- Admissão RH: quatro dias úteis incluindo o próprio dia da viagem.
-- Mantém public.ro_data_minima_util como fonte canônica de fins de semana,
-- feriados e demais dias não úteis. As outras regras permanecem inalteradas.

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
  if v_reg.prazo_tipo='dias_uteis' then
    if v_reg.regra_codigo='rh_admissao' then
      v_min:=public.ro_data_minima_util((v_hoje+time '12:00') at time zone 'America/Sao_Paulo',v_reg.prazo_quantidade);
    else v_min:=public.ro_data_minima_util(now(),v_reg.prazo_quantidade); end if;
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
-- DRY_RUN_MIGRATION_END

create temp table contagem_admissao_resultados(
  indicador text primary key,
  aprovado boolean not null,
  detalhe text not null
) on commit drop;

do $dry$
declare
  v_viagem constant date:='2026-10-20';
  v_limite_14 date:=public.ro_data_minima_util('2026-10-14 12:00:00-03'::timestamptz,4);
  v_limite_15 date:=public.ro_data_minima_util('2026-10-15 12:00:00-03'::timestamptz,4);
  v_limite_16 date:=public.ro_data_minima_util('2026-10-16 12:00:00-03'::timestamptz,4);
  v_limite_19 date:=public.ro_data_minima_util('2026-10-19 12:00:00-03'::timestamptz,4);
  v_regra_antes text;
  v_validador_antes text;
  v_regra_depois text:=pg_get_functiondef('public.ro_prazo_regra_efetiva(text,text,uuid)'::regprocedure);
  v_validador_depois text:=pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure);
  v_regra_antes_norm text;
  v_regra_depois_norm text;
  v_validador_antes_norm text;
  v_validador_depois_norm text;
  v_validador_esperado_norm text;
  v_antes_exclusiva boolean;
  v_depois_inclusiva boolean;
  v_regra_efetiva_igual boolean;
  v_somente_delta_esperado boolean;
begin
  select regra,validador into v_regra_antes,v_validador_antes
  from contagem_admissao_definicoes_antes;

  v_regra_antes_norm:=regexp_replace(v_regra_antes,'[[:space:]]+','','g');
  v_regra_depois_norm:=regexp_replace(v_regra_depois,'[[:space:]]+','','g');
  v_validador_antes_norm:=regexp_replace(v_validador_antes,'[[:space:]]+','','g');
  v_validador_depois_norm:=regexp_replace(v_validador_depois,'[[:space:]]+','','g');
  v_validador_esperado_norm:=replace(
    v_validador_antes_norm,
    'ifv_reg.regra_codigo=''rh_admissao''thenv_min:=public.ro_data_minima_util((v_hoje+time''12:00'')attimezone''America/Sao_Paulo'',v_reg.prazo_quantidade)+1;',
    'ifv_reg.regra_codigo=''rh_admissao''thenv_min:=public.ro_data_minima_util((v_hoje+time''12:00'')attimezone''America/Sao_Paulo'',v_reg.prazo_quantidade);'
  );
  v_antes_exclusiva:=v_validador_antes ~ $re$if\s+v_reg\.regra_codigo\s*=\s*'rh_admissao'\s+then\s+v_min\s*:=\s*public\.ro_data_minima_util\([^;]*v_reg\.prazo_quantidade\)\s*\+\s*1\s*;$re$;
  v_depois_inclusiva:=v_validador_depois ~ $re$if\s+v_reg\.regra_codigo\s*=\s*'rh_admissao'\s+then\s+v_min\s*:=\s*public\.ro_data_minima_util\([^;]*v_reg\.prazo_quantidade\)\s*;$re$;
  v_regra_efetiva_igual:=v_regra_antes_norm=v_regra_depois_norm;
  v_somente_delta_esperado:=v_validador_esperado_norm=v_validador_depois_norm;

  insert into contagem_admissao_resultados values
    ('admissao_14_permitida',v_viagem>=v_limite_14,format('viagem=%s; mínimo=%s',v_viagem,v_limite_14)),
    ('admissao_15_permitida',v_viagem>=v_limite_15,format('viagem=%s; mínimo=%s',v_viagem,v_limite_15)),
    ('admissao_16_bloqueada',v_viagem<v_limite_16,format('viagem=%s; mínimo=%s',v_viagem,v_limite_16)),
    ('admissao_19_bloqueada',v_viagem<v_limite_19,format('viagem=%s; mínimo=%s',v_viagem,v_limite_19)),
    ('dia_viagem_conta',v_limite_15='2026-10-20'::date,'15, 16, 19 e 20 são os quatro dias úteis'),
    ('fim_semana_nao_conta',v_limite_14='2026-10-19'::date and v_limite_15='2026-10-20'::date,'17/10 e 18/10 não participaram da contagem'),
    ('viagem_nao_util_preservada',v_limite_14>'2026-10-17'::date and v_limite_14>'2026-10-18'::date,'viagens em 17/10 e 18/10 ficam bloqueadas; data não útil posterior ao mínimo continua permitida'),
    ('inicio_obra_preservado',v_regra_depois like '%p_motivo=''inicio_obra''%''dias_corridos''::text,4%','4 dias corridos'),
    ('desligamento_preservado',v_regra_depois like '%rh_desligamento_programado_outros''::text,''dias_corridos''::text,5%','programado/outros: 5 dias corridos'),
    ('viagem_administrativa_preservada',v_regra_depois like '%rh_viagem_administrativa''::text,''sem_prazo_minimo''::text,0%','sem prazo mínimo'),
    ('somente_admissao_ajustada',v_antes_exclusiva and v_depois_inclusiva and v_regra_efetiva_igual and v_somente_delta_esperado,
      format('antes_exclusiva=%s; depois_inclusiva=%s; regra_efetiva_igual=%s; somente_delta_esperado=%s',v_antes_exclusiva,v_depois_inclusiva,v_regra_efetiva_igual,v_somente_delta_esperado));
end $dry$;

-- Fixture sintética e identificável; a transação inteira termina em ROLLBACK.
insert into public.ro_calendario_nao_util(id,data,descricao,tipo,abrangencia,estado,municipio,ativo)
values('00000000-0000-4000-8000-202610150001'::uuid,'2026-10-16','DRY RUN contagem inclusiva admissão — não persistir','feriado','empresa',null,null,true);

-- O trigger do calendário marca o ano incompleto. Esta revalidação também é
-- transitória e permite ao helper canônico avaliar a fixture no dry run.
insert into public.ro_calendario_anos(ano,completo,observacoes)
values(2026,true,'DRY RUN contagem inclusiva admissão — não persistir')
on conflict(ano) do update set completo=true;

insert into contagem_admissao_resultados(indicador,aprovado,detalhe)
select 'feriado_recuou_prazo',
  public.ro_data_minima_util('2026-10-14 12:00:00-03'::timestamptz,4)='2026-10-20'::date
  and public.ro_data_minima_util('2026-10-15 12:00:00-03'::timestamptz,4)='2026-10-21'::date,
  'Com 16/10 não útil: pedido em 14/10 permite 20/10; pedido em 15/10 exige 21/10';

select
  indicador,
  aprovado,
  detalhe,
  bool_and(aprovado) over () as todos_aprovados
from contagem_admissao_resultados
order by indicador;

rollback;
