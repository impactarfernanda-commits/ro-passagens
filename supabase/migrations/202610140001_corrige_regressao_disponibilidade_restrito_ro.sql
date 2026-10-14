begin;

-- Mantém a versão instalada em 2026-10-06 e alinha somente a elegibilidade
-- do funcionário ao helper canônico já usado pelo catálogo de viajantes.
create or replace function public.ro_validar_solicitacao_visibilidade()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_restrito boolean:=public.ro_can_view_all() or public.ro_is_rh_active(auth.uid());
begin
  if new.obra_id is null then raise exception 'Centro de custo atual é obrigatório';end if;
  if new.viajante_nome_informado is not null then
    if not public.ro_is_rh_active(auth.uid()) then raise exception 'VIAJANTE_MANUAL_APENAS_RH';end if;
  elsif new.colaborador_id is not null then
    if not exists(select 1 from public.ro_funcionarios_enderecos_privados e where e.id=new.colaborador_id and e.ativo) then raise exception 'Colaborador indisponível para este solicitante';end if;
  elsif not public.ro_funcionario_disponivel_para_usuario(auth.uid(),new.funcionario_id) then raise exception 'Funcionário indisponível para este solicitante';end if;
  if not exists(select 1 from public.obras o where o.id=new.obra_id and o.visivel_passagens and o.escopo_passagens in('comum','restrito_ro') and (o.escopo_passagens='comum' or v_restrito)) then raise exception 'Centro de custo indisponível para este solicitante';end if;
  return new;
end $$;

commit;
