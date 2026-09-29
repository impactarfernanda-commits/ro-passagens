begin;

-- Mantém a tabela de custos protegida pela policy administrativa existente.
-- Todo usuário interno ativo recebe somente a projeção mínima dos custos
-- operacionais de solicitações visíveis, sem dados administrativos.
create or replace function public.ro_custos_operacionais_visiveis(
  p_solicitacao_id uuid
)
returns table(
  id uuid,
  tipo text,
  valor numeric,
  descricao text
)
language sql
stable
security definer
set search_path=''
as $$
  select c.id,c.tipo,c.valor,c.descricao
  from public.ro_passagem_custos c
  join public.ro_passagem_solicitacoes s on s.id=c.solicitacao_id
  where s.id=p_solicitacao_id
    and auth.uid() is not null
    and s.excluida_em is null
    and public.ro_is_active_internal_user()
    and c.tipo in('refeicao','uber','outros')
    and c.valor>0
  order by c.created_at,c.id;
$$;

revoke all on function public.ro_custos_operacionais_visiveis(uuid) from public,anon;
grant execute on function public.ro_custos_operacionais_visiveis(uuid) to authenticated;

commit;
