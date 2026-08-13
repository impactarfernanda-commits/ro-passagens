-- Somente leitura. Execute após aplicar a migration em ambiente controlado.
select column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name='ro_passagem_solicitacoes' and column_name in ('pix_viajante','necessita_hospedagem','hospedagem_checkin','hospedagem_checkout','ida_a_partir_horario') order by ordinal_position;
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname in ('ro_pix_viajante_preenchido_ck','ro_hospedagem_consistente_ck');
select p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('ro_ultimo_pix_viajante','ro_criar_solicitacao_validada','ro_criar_solicitacao_colaborador_validada','ro_registrar_compra') order by p.proname;
select count(*) filter(where pix_viajante is not null and btrim(pix_viajante)='') pix_vazio_invalido,count(*) filter(where necessita_hospedagem and (hospedagem_checkin is null or hospedagem_checkout is null or hospedagem_checkout<hospedagem_checkin)) hospedagem_invalida,count(*) filter(where not necessita_hospedagem and (hospedagem_checkin is not null or hospedagem_checkout is not null)) datas_indevidas from public.ro_passagem_solicitacoes;
with alvo as (
  select p.oid,p.proowner,pg_get_function_identity_arguments(p.oid) argumentos,p.proacl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ro_ultimo_pix_viajante'
    and pg_get_function_identity_arguments(p.oid)='p_colaborador_id uuid, p_funcionario_id uuid'
), acl as (
  select alvo.argumentos,x.grantee,x.privilege_type
  from alvo cross join lateral aclexplode(coalesce(alvo.proacl,acldefault('f',alvo.proowner))) x
)
select exists(select 1 from alvo) assinatura_existe,
  not exists(select 1 from acl where grantee=0 and privilege_type='EXECUTE') public_sem_execute,
  not exists(select 1 from acl where grantee=(select oid from pg_roles where rolname='anon') and privilege_type='EXECUTE') anon_sem_execute,
  exists(select 1 from acl where grantee=(select oid from pg_roles where rolname='authenticated') and privilege_type='EXECUTE') authenticated_com_execute;
