with f as(select pg_get_functiondef('public.ro_is_denise(uuid)'::regprocedure) d)
select
 to_regprocedure('public.ro_is_denise(uuid)') is not null helper_presente,
 (select d like '%d6081413-3730-41f0-981d-935a44303993%' from f) uuid_fixo_presente,
 (select d not like '%ro_denise_autorizados%' from f) associacao_ainda_ausente_no_helper,
 to_regclass('public.ro_denise_autorizados') is null tabela_nova_ausente,
 to_regprocedure('public.ro_atualizar_valor_passagem(uuid,uuid,numeric,text)') is not null edicao_passagem_presente,
 to_regprocedure('public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb)') is not null complementar_presente,
 exists(
   select 1
   from pg_policies
   where schemaname='storage'
     and tablename='objects'
     and (coalesce(qual,'')||coalesce(with_check,'')) like '%ro_is_denise%'
 ) storage_protegido;
