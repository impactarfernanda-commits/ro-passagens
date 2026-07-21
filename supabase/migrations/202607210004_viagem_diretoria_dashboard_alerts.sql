-- Viagem diretoria: motivo restrito a responsáveis RO ativos.
do $$
declare v record;
begin
  for v in select conname from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%motivo%' loop
    execute format('alter table public.ro_passagem_solicitacoes drop constraint %I',v.conname);
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.ro_passagem_solicitacoes'::regclass and conname='ro_motivo_valido') then
    alter table public.ro_passagem_solicitacoes add constraint ro_motivo_valido
      check(motivo in ('ferias','folga_campo','desligamento','transferencia_obra','viagem_diretoria'));
  end if;
end $$;

create or replace function public.ro_preparar_viagem_diretoria()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.motivo='viagem_diretoria' then
    if not public.ro_can_operate() then
      raise exception 'Apenas responsáveis RO ativos podem registrar Viagem diretoria.';
    end if;
    new.status:='em_andamento';
    new.responsavel_ro_id:=auth.uid();
    new.assumida_em:=now();
    new.centro_custo_retorno_id:=null;
    new.retorno_indefinido:=false;
  end if;
  return new;
end $$;
drop trigger if exists ro_preparar_viagem_diretoria on public.ro_passagem_solicitacoes;
create trigger ro_preparar_viagem_diretoria before insert on public.ro_passagem_solicitacoes
for each row execute function public.ro_preparar_viagem_diretoria();

drop policy if exists ro_sol_insert on public.ro_passagem_solicitacoes;
create policy ro_sol_insert on public.ro_passagem_solicitacoes
for insert to authenticated
with check(
  solicitante_id=auth.uid()
  and (
    status='solicitada'
    or (motivo='viagem_diretoria' and status='em_andamento' and responsavel_ro_id=auth.uid() and public.ro_can_operate())
  )
);
