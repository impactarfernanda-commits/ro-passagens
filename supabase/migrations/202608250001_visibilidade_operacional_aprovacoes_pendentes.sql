-- Amplia somente a leitura de solicitações pendentes para quem já possui
-- visão ampla (RO ativo, Gerência e Diretoria). Os bloqueios de escrita,
-- triggers e RPCs operacionais permanecem inalterados.
drop policy if exists ro_sol_select
on public.ro_passagem_solicitacoes;

create policy ro_sol_select
on public.ro_passagem_solicitacoes
for select
to authenticated
using(
  (
    excluida_em is null
    and (
      solicitante_id=(select auth.uid())
      or aprovador_id=(select auth.uid())
      or public.ro_can_view_all()
      or (
        public.ro_is_rh_active()
        and origem_solicitacao='rh'
      )
    )
  )
  or (
    excluida_em is not null
    and public.ro_can_operate()
  )
);
