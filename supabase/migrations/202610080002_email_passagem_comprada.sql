begin;

alter table public.ro_email_outbox
  drop constraint if exists ro_email_outbox_tipo_evento_check;
alter table public.ro_email_outbox
  add constraint ro_email_outbox_tipo_evento_check check (
    tipo_evento in (
      'aprovacao_pendente',
      'solicitacao_aprovada',
      'solicitacao_reprovada',
      'solicitacao_recusada_ro',
      'passagem_comprada'
    )
  );

alter table public.ro_email_logs
  drop constraint if exists ro_email_logs_tipo_evento_check;
alter table public.ro_email_logs
  add constraint ro_email_logs_tipo_evento_check check (
    tipo_evento in (
      'nova_solicitacao_ro',
      'passagem_comprada_solicitante',
      'aprovacao_pendente',
      'solicitacao_aprovada',
      'solicitacao_reprovada',
      'solicitacao_recusada_ro',
      'passagem_comprada'
    )
  );

create or replace function public.ro_enfileirar_passagem_comprada()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_viajante text;
begin
  if old.status is not distinct from 'passagem_comprada'
     or new.status is distinct from 'passagem_comprada'
     or new.comprado_em is null
     or new.comprado_por is null
     or new.excluida_em is not null then
    return new;
  end if;

  select coalesce(
    nullif(btrim(new.viajante_nome_informado),''),
    nullif(btrim(privado.nome),''),
    nullif(btrim(funcionario.nome),'')
  )
  into v_viajante
  from (select 1) base
  left join public.ro_funcionarios_enderecos_privados privado
    on privado.id=new.colaborador_id
  left join public.funcionarios funcionario
    on funcionario.id=new.funcionario_id;

  insert into public.ro_email_outbox(
    solicitacao_id,tipo_evento,destinatario_user_id,assunto,chave_deduplicacao
  )
  values(
    new.id,
    'passagem_comprada',
    new.solicitante_id,
    'Passagem comprada — '||coalesce(v_viajante,'Viajante'),
    'passagem_comprada:'||new.id::text||':'||new.solicitante_id::text
  )
  on conflict(chave_deduplicacao) do nothing;

  return new;
end $$;

drop trigger if exists ro_enfileirar_passagem_comprada
on public.ro_passagem_solicitacoes;
create trigger ro_enfileirar_passagem_comprada
after update of status,comprado_em,comprado_por
on public.ro_passagem_solicitacoes
for each row
execute function public.ro_enfileirar_passagem_comprada();

revoke all on function public.ro_enfileirar_passagem_comprada()
from public,anon,authenticated;

commit;
