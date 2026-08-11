select conname,pg_get_constraintdef(oid) definicao from pg_constraint
where conrelid='public.ro_funcionarios_enderecos_privados'::regclass and contype='u';
select funcionario_id,count(*) quantidade from public.ro_funcionarios_enderecos_privados
where funcionario_id is not null group by funcionario_id having count(*)>1;
select public.ro_normalizar_nome_colaborador('  ABMAEL   LÍMA-DA.SILVA ') nome_normalizado_esperado;
-- PÓS-MIGRATION 202608110002. Verificação somente leitura.
