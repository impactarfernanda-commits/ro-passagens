begin;

alter table public.ro_email_outbox
  drop constraint if exists ro_email_outbox_tipo_evento_check;
alter table public.ro_email_outbox
  add constraint ro_email_outbox_tipo_evento_check check (
    tipo_evento in (
      'aprovacao_pendente',
      'solicitacao_aprovada',
      'solicitacao_reprovada'
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
      'solicitacao_reprovada'
    )
  );

create or replace function public.ro_enfileirar_resultado_aprovacao()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_evento text;
  v_viajante text;
begin
  if old.aprovacao_status is distinct from 'pendente'
     or new.aprovacao_status not in ('aprovada','reprovada') then
    return new;
  end if;

  v_evento:=case new.aprovacao_status
    when 'aprovada' then 'solicitacao_aprovada'
    else 'solicitacao_reprovada'
  end;

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
    solicitacao_id,
    tipo_evento,
    destinatario_user_id,
    assunto,
    chave_deduplicacao
  )
  values(
    new.id,
    v_evento,
    new.solicitante_id,
    case new.aprovacao_status
      when 'aprovada' then 'Solicitação de passagem aprovada — '
      else 'Solicitação de passagem reprovada — '
    end || coalesce(v_viajante,'Viajante'),
    v_evento||':'||new.id::text||':'||new.solicitante_id::text
  )
  on conflict(chave_deduplicacao) do nothing;

  return new;
end $$;

drop trigger if exists ro_enfileirar_resultado_aprovacao
on public.ro_passagem_solicitacoes;

create trigger ro_enfileirar_resultado_aprovacao
after update of aprovacao_status
on public.ro_passagem_solicitacoes
for each row
execute function public.ro_enfileirar_resultado_aprovacao();

revoke all on function public.ro_enfileirar_resultado_aprovacao()
from public,anon,authenticated;

commit;
