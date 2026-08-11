select pg_get_functiondef('public.ro_catalogo_colaboradores_viagem()'::regprocedure) catalogo_deduplicado;
select pg_get_functiondef('public.ro_correspondencia_nome_catalogo_ro(text,text)'::regprocedure) matching_conservador;
select count(*) entradas_catalogo from public.ro_catalogo_colaboradores_viagem();

