select pg_get_functiondef('public.ro_interpretar_cidade_uf_residencial(text,text)'::regprocedure) helper_leitura;
select pg_get_functiondef('public.ro_obter_destino_colaborador_resumido(uuid)'::regprocedure) rpc_destino;
select pg_get_functiondef('public.ro_aplicar_destino_residencial()'::regprocedure) trigger_destino;
select count(*) registros_reconhecidos from public.ro_funcionarios_enderecos_privados e
cross join lateral public.ro_interpretar_cidade_uf_residencial(e.cidade,e.uf) i where e.uf is null and i.possui_endereco;
