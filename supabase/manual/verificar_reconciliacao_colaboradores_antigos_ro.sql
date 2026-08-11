select tgname from pg_trigger where tgrelid='public.ro_funcionarios_enderecos_privados'::regclass and tgname='ro_proteger_cpf_colaborador_reconciliado' and not tgisinternal;
select funcionario_id,count(*) from public.ro_funcionarios_enderecos_privados where funcionario_id is not null group by funcionario_id having count(*)>1;
