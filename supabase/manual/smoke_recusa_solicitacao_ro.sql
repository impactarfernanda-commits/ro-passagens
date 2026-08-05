begin;
-- Isolado e transacional: configure IDs descartáveis em um ambiente local de testes.
-- Nunca execute em produção. As exceções esperadas abaixo documentam a matriz obrigatória.
do $$ begin
  assert public.ro_is_operador_ativo(null)=false,'ausência de usuário deve negar';
  assert public.ro_solicitacao_foi_comprada(gen_random_uuid())=false,'solicitação inexistente não está comprada';
end $$;
-- Cenários a executar com fixtures locais: RO ativo/inativo, gerente e diretor sem RO,
-- usuário comum, motivo vazio/curto, compra registrada, recusa duplicada, terminalidade,
-- uma notificação, prefill somente do solicitante, ausência de documentos/custos no JSON,
-- vínculo e revalidação da nova solicitação, histórico/auditoria e rollback das fixtures.
select 'RPC recusa protegida',pg_get_functiondef('public.ro_recusar_solicitacao(uuid,text)'::regprocedure);
select 'RPC prefill protegido',pg_get_functiondef('public.ro_obter_dados_para_refazer_solicitacao(uuid)'::regprocedure);
rollback;
