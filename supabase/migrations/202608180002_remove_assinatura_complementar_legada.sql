begin;
-- FASE 2: somente após publicar e validar o frontend que envia p_custos_adicionais.
drop function if exists public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text);
revoke all on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb) from public,anon;
grant execute on function public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb) to authenticated;
revoke all on function public.ro_excluir_solicitacao(uuid,text) from public,anon;
grant execute on function public.ro_excluir_solicitacao(uuid,text) to authenticated;
revoke all on function public.ro_atualizar_custo_operacional(uuid,uuid,numeric) from public,anon;
grant execute on function public.ro_atualizar_custo_operacional(uuid,uuid,numeric) to authenticated;
commit;
