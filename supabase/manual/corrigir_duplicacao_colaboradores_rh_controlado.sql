-- PÓS-MIGRATION 202608110002. Depende de public.ro_normalizar_nome_colaborador(text).
-- NÃO EXECUTAR sem revisar o DRY RUN. Preserva id e todos os dados privados; não apaga registros.
begin;
lock table public.ro_funcionarios_enderecos_privados in share row exclusive mode;
with candidatos as (
 select e.id colaborador_id,(array_agg(f.id order by f.id))[1] funcionario_id,count(f.id) quantidade
 from public.ro_funcionarios_enderecos_privados e join public.funcionarios f
   on f.ativo and f.deleted_at is null and f.visivel_obras_control
  and public.ro_normalizar_nome_colaborador(f.nome)=public.ro_normalizar_nome_colaborador(e.nome)
 where e.funcionario_id is null
   and not exists(select 1 from public.ro_funcionarios_enderecos_privados x where x.id<>e.id and x.cpf is not null and x.cpf=e.cpf)
 group by e.id
), aptos as (
 select c.* from candidatos c where c.quantidade=1
   and not exists(select 1 from public.ro_funcionarios_enderecos_privados x where x.funcionario_id=c.funcionario_id)
)
update public.ro_funcionarios_enderecos_privados e set funcionario_id=a.funcionario_id,atualizado_em=now()
from aptos a where e.id=a.colaborador_id and e.funcionario_id is null;
-- Troque por COMMIT somente depois de conferir o resultado nesta mesma sessão.
select funcionario_id,count(*) from public.ro_funcionarios_enderecos_privados where funcionario_id is not null group by funcionario_id having count(*)>1;
rollback;
