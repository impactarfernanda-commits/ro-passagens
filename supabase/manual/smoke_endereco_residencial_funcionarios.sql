begin;
-- Execute somente em ambiente isolado. As identidades abaixo devem ser substituídas por fixtures locais.
do $$ begin
  if current_setting('ro.smoke_enderecos_isolado',true) is distinct from '1' then raise exception 'Defina ro.smoke_enderecos_isolado=1 apenas no ambiente de testes'; end if;
end $$;
-- Matriz coberta pelas funções/policies sob identidades de teste: RH cria/atualiza; Fernanda cria/edita;
-- RO lê completo e não escreve; comum/gerente/diretor sem associação não leem completo;
-- comum lê apenas Cidade/UF; funcionário inexistente e linha externa são ignorados;
-- igualdade normalizada única importa; ambíguo/aproximado não importa sem confirmação;
-- unique+upsert impedem duplicidade; férias/folga/recesso usam o destino RH;
-- transferência não usa endereço; exceção exige justificativa e não altera o cadastro.
select public.ro_can_manage_private_addresses(),public.ro_can_view_private_addresses();
select count(*)>=0 as estrutura_consultavel from public.ro_funcionarios_enderecos_privados;
rollback;
