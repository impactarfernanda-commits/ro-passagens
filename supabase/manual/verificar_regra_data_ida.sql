-- Somente leitura. Execute antes e depois da aplicação controlada e compare o resumo histórico.
select pg_get_functiondef('public.ro_validar_nova_solicitacao()'::regprocedure) as definicao_validacao;
select pg_get_functiondef('public.ro_criar_solicitacao_validada(jsonb,jsonb)'::regprocedure) as definicao_rpc;

select t.tgname as trigger, pg_get_triggerdef(t.oid,true) as definicao
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal
  and n.nspname='public'
  and c.relname='ro_passagem_solicitacoes'
  and t.tgname in ('ro_validar_nova_solicitacao','ro_revalidar_solicitacao_editada')
order by t.tgname;

select column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public'
  and table_name='ro_passagem_solicitacoes'
  and column_name in ('data_ida','primeiro_embarque_em')
order by column_name;

-- Este resumo não altera linhas e permite confirmar que o histórico permanece legível e estável.
select count(*) as total_historico,
       min(created_at) as registro_mais_antigo,
       max(created_at) as registro_mais_recente,
       count(*) filter (where primeiro_embarque_em is null) as historicos_sem_primeiro_embarque,
       count(*) filter (where motivo is null) as historicos_administrativos,
       count(*) filter (where motivo='viagem_diretoria') as historicos_viagem_diretoria
from public.ro_passagem_solicitacoes;
