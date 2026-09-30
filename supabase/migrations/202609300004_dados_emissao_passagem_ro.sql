begin;

create or replace function public.ro_obter_dados_emissao_passagem(
  p_solicitacao_id uuid
)
returns table(
  nome text,
  data_nascimento date,
  cpf text,
  rg text,
  telefone text
)
language plpgsql
stable
security definer
set search_path='public','pg_temp'
as $$
declare
  v_colaborador_id uuid;
  v_funcionario_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;
  if not coalesce(public.ro_is_operador_ativo(auth.uid()),false) then
    raise exception 'APENAS_OPERADOR_RO_ATIVO';
  end if;

  select s.colaborador_id,s.funcionario_id
    into v_colaborador_id,v_funcionario_id
  from public.ro_passagem_solicitacoes s
  where s.id=p_solicitacao_id and s.excluida_em is null;
  if not found then
    raise exception 'SOLICITACAO_NAO_ENCONTRADA_OU_EXCLUIDA';
  end if;

  return query
  select e.nome::text,e.data_nascimento::date,e.cpf::text,e.rg::text,e.telefone::text
  from public.ro_funcionarios_enderecos_privados e
  where e.ativo
    and(
      (v_colaborador_id is not null and e.id=v_colaborador_id)
      or
      (v_colaborador_id is null and v_funcionario_id is not null and e.funcionario_id=v_funcionario_id)
    )
  order by (e.id=v_colaborador_id) desc,e.atualizado_em desc,e.id
  limit 1;
end $$;

revoke all on function public.ro_obter_dados_emissao_passagem(uuid) from public,anon;
grant execute on function public.ro_obter_dados_emissao_passagem(uuid) to authenticated;

drop policy if exists ro_endereco_select_restrito
on public.ro_funcionarios_enderecos_privados;
create policy ro_endereco_select_restrito
on public.ro_funcionarios_enderecos_privados
for select
to authenticated
using(public.ro_can_manage_private_addresses(auth.uid()));

commit;
