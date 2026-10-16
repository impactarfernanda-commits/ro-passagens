begin;

-- Tudo neste arquivo, inclusive calendário sintético, tabela de teste e nova
-- definição da função, é descartado pelo ROLLBACK final.
create temporary table corte_admissao_resultados(
  indicador text primary key,
  aprovado boolean not null,
  detalhe text
) on commit drop;

create temporary table corte_admissao_definicoes as
select
  pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure) as validador_antes,
  pg_get_functiondef('public.ro_prazo_regra_efetiva(text,text,uuid)'::regprocedure) as regra_antes,
  pg_get_functiondef('public.ro_data_minima_util(timestamptz,integer)'::regprocedure) as helper_antes;

-- Testes fixos do helper antes da fixture de feriado.
insert into corte_admissao_resultados values
  ('segunda_163000_conta',public.ro_data_minima_util('2026-10-15 16:30:00 America/Sao_Paulo'::timestamptz,4)='2026-10-20'::date,'quinta-feira 15/10/2026, limite inclusivo'),
  ('segunda_163001_nao_conta',public.ro_data_minima_util('2026-10-15 16:30:01 America/Sao_Paulo'::timestamptz,4)='2026-10-21'::date,'quinta-feira 15/10/2026, um segundo após o corte'),
  ('sexta_153000_conta',public.ro_data_minima_util('2026-10-16 15:30:00 America/Sao_Paulo'::timestamptz,4)='2026-10-21'::date,'sexta-feira 16/10/2026, limite inclusivo'),
  ('sexta_153001_nao_conta',public.ro_data_minima_util('2026-10-16 15:30:01 America/Sao_Paulo'::timestamptz,4)='2026-10-22'::date,'sexta-feira 16/10/2026, um segundo após o corte'),
  ('fim_semana_ignorado',public.ro_data_minima_util('2026-10-16 15:30:00 America/Sao_Paulo'::timestamptz,2)='2026-10-19'::date,'sábado e domingo não reduzem o saldo'),
  ('datepicker_backend_alinhados',
    public.ro_data_minima_util('2026-10-15 16:30:00 America/Sao_Paulo'::timestamptz,4)='2026-10-20'::date
    and public.ro_data_minima_util('2026-10-15 16:30:01 America/Sao_Paulo'::timestamptz,4)='2026-10-21'::date,
    'mesmos casos-limite cobertos pelo helper TypeScript');

insert into public.ro_calendario_nao_util(id,data,descricao,tipo,abrangencia,estado,municipio,ativo)
values('f0020002-1630-4000-8000-000000000001'::uuid,'2026-10-16','Fixture dry run corte admissão','feriado','empresa',null,null,true);

-- O trigger ro_calendar_invalidate marca 2026 como incompleto. A revalidação
-- abaixo pertence à fixture e também será integralmente revertida.
update public.ro_calendario_anos
set completo=true
where ano=2026;

insert into corte_admissao_resultados values(
  'feriado_ignorado',
  public.ro_data_minima_util('2026-10-15 16:30:00 America/Sao_Paulo'::timestamptz,4)='2026-10-21'::date,
  'sexta-feira sintética não reduz o saldo e será removida pelo rollback'
);

-- MIGRATION_202610150002_BEGIN
-- Admissão RH mantém a contagem inclusiva de quatro dias úteis e volta a
-- respeitar o horário de corte canônico de public.ro_data_minima_util.

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
-- MIGRATION_202610150002_END

insert into corte_admissao_resultados
select 'admissao_usa_now',
  pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure)
    ~* $$if\s+v_reg\.prazo_tipo\s*=\s*'dias_uteis'\s+then\s+v_min\s*:=\s*public\.ro_data_minima_util\s*\(\s*now\s*\(\s*\)$$,
  'validador instalado chama o helper com o relógio real';

-- Prova que apenas o ramo artificial de meio-dia foi substituído.
insert into corte_admissao_resultados
select 'somente_delta_esperado',
  replace(
    regexp_replace(validador_antes,'\s','','g'),
    $$ifv_reg.prazo_tipo='dias_uteis'thenifv_reg.regra_codigo='rh_admissao'thenv_min:=public.ro_data_minima_util((v_hoje+time'12:00')attimezone'America/Sao_Paulo',v_reg.prazo_quantidade);elsev_min:=public.ro_data_minima_util(now(),v_reg.prazo_quantidade);endif;$$,
    $$ifv_reg.prazo_tipo='dias_uteis'thenv_min:=public.ro_data_minima_util(now(),v_reg.prazo_quantidade);$$
  )=regexp_replace(pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure),'\s','','g')
  and regra_antes=pg_get_functiondef('public.ro_prazo_regra_efetiva(text,text,uuid)'::regprocedure)
  and helper_antes=pg_get_functiondef('public.ro_data_minima_util(timestamptz,integer)'::regprocedure),
  'todo o restante das três definições permaneceu byte a byte igual'
from corte_admissao_definicoes;

do $$
declare
  v_rh uuid;
  v_min date:=public.ro_data_minima_util(now(),4);
  v_anterior date:=public.ro_data_minima_util(now(),3);
  v_bloqueada boolean:=false;
  v_reg record;
begin
  select r.user_id into v_rh
  from public.ro_rh_responsaveis r
  where r.ativo
    and coalesce(public.ro_role(r.user_id),'') not in ('coordenador','gerente','diretor')
    and not coalesce(public.ro_is_operador_ativo(r.user_id),false)
  order by r.user_id limit 1;
  if v_rh is null then raise exception 'PRE_REQUISITO_DRY_RUN: RH ativo sem poder de exceção não encontrado'; end if;
  perform set_config('request.jwt.claim.sub',v_rh::text,true);

  create temporary table corte_admissao_solicitacoes as
    select * from public.ro_passagem_solicitacoes with no data;
  create trigger corte_admissao_validar before insert or update
    on corte_admissao_solicitacoes for each row
    execute function public.ro_validar_nova_solicitacao();

  insert into corte_admissao_solicitacoes(id,solicitante_id,motivo,data_ida,origem,destino)
  values('f0020002-1630-4000-8000-000000000002',v_rh,'admissao',v_min,'Fixture','Fixture');

  begin
    insert into corte_admissao_solicitacoes(id,solicitante_id,motivo,data_ida,origem,destino)
    values('f0020002-1630-4000-8000-000000000003',v_rh,'admissao',v_anterior,'Fixture','Fixture');
  exception when others then
    v_bloqueada:=sqlerrm like 'FORA_DO_PRAZO:%';
  end;

  insert into corte_admissao_resultados values
    ('data_minima_atual_permitida',exists(select 1 from corte_admissao_solicitacoes where id='f0020002-1630-4000-8000-000000000002' and data_minima_permitida=v_min),v_min::text),
    ('data_anterior_bloqueada',v_bloqueada,v_anterior::text);

  select * into v_reg from public.ro_prazo_regra_efetiva('inicio_obra',null,v_rh);
  insert into corte_admissao_resultados values('inicio_obra_preservado',v_reg.regra_codigo='rh_inicio_obra' and v_reg.prazo_tipo='dias_corridos' and v_reg.prazo_quantidade=4,null);
  select * into v_reg from public.ro_prazo_regra_efetiva('desligamento','programado_outros',v_rh);
  insert into corte_admissao_resultados values('desligamento_preservado',v_reg.prazo_tipo='dias_corridos' and v_reg.prazo_quantidade=5,null);
  select * into v_reg from public.ro_prazo_regra_efetiva('viagem_administrativa',null,v_rh);
  insert into corte_admissao_resultados values('viagem_administrativa_preservada',v_reg.prazo_tipo='sem_prazo_minimo' and v_reg.prazo_quantidade=0,null);
end $$;

select indicador,aprovado,detalhe from corte_admissao_resultados order by indicador;
select bool_and(aprovado) as todos_aprovados from corte_admissao_resultados;

rollback;
