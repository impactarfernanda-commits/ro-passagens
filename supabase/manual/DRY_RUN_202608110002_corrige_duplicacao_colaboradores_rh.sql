-- DRY RUN DA MIGRATION 202608110002: cria a dependência dentro da transação e sempre desfaz.
begin;
create or replace function public.ro_normalizar_nome_colaborador(p_nome text)
returns text language sql immutable strict set search_path=public,pg_temp as $$
  select trim(regexp_replace(regexp_replace(lower(translate(p_nome,
    'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn')),
    '[._:/\\-]+',' ','g'),'\s+',' ','g'));
$$;

-- Prévia das linhas que o script controlado pós-migration poderá vincular.
with candidatos as (
 select e.id colaborador_id,(array_agg(f.id order by f.id))[1] funcionario_id,count(f.id) quantidade
 from public.ro_funcionarios_enderecos_privados e join public.funcionarios f
   on f.ativo and f.deleted_at is null and f.visivel_obras_control
  and public.ro_normalizar_nome_colaborador(f.nome)=public.ro_normalizar_nome_colaborador(e.nome)
 where e.funcionario_id is null
   and not exists(select 1 from public.ro_funcionarios_enderecos_privados x where x.id<>e.id and x.cpf is not null and x.cpf=e.cpf)
 group by e.id
)
select colaborador_id,funcionario_id,'apto_vinculo_inequivoco' classificacao from candidatos c
where quantidade=1 and not exists(select 1 from public.ro_funcionarios_enderecos_privados x where x.funcionario_id=c.funcionario_id)
order by colaborador_id;
rollback;
