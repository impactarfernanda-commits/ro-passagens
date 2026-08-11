begin;
create or replace function public.ro_proteger_cpf_colaborador_reconciliado()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if old.cpf is not null and new.cpf is not null and old.cpf<>new.cpf then raise exception 'CPF_DIVERGENTE_CADASTRO_EXISTENTE';end if;
  return new;
end $$;
drop trigger if exists ro_proteger_cpf_colaborador_reconciliado on public.ro_funcionarios_enderecos_privados;
create trigger ro_proteger_cpf_colaborador_reconciliado before update of cpf on public.ro_funcionarios_enderecos_privados for each row execute function public.ro_proteger_cpf_colaborador_reconciliado();
revoke all on function public.ro_proteger_cpf_colaborador_reconciliado() from public,anon,authenticated;
rollback;
