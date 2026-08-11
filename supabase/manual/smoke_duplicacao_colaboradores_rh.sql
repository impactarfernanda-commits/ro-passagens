-- PÓS-MIGRATION 202608110002. Smoke transacional; sempre desfaz.
begin;
select public.ro_normalizar_nome_colaborador('João  da-Silva')=public.ro_normalizar_nome_colaborador(' JOAO DA SILVA ') normalizacao_ok;
select not exists(select 1 from public.ro_funcionarios_enderecos_privados where funcionario_id is not null group by funcionario_id having count(*)>1) unicidade_atual_ok;
rollback;
