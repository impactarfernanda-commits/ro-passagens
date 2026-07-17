alter table public.ro_passagem_anexos
  add column if not exists partida_em timestamptz,
  add column if not exists valor numeric(12,2),
  add column if not exists observacao text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ro_anexos_valor_nao_negativo'
      and conrelid = 'public.ro_passagem_anexos'::regclass
  ) then
    alter table public.ro_passagem_anexos
      add constraint ro_anexos_valor_nao_negativo
      check (valor is null or valor >= 0);
  end if;
end
$$;

drop trigger if exists ro_notificacao_anexo on public.ro_passagem_anexos;
drop trigger if exists ro_notificacao_possui_anexo on public.ro_passagem_notificacoes;
drop function if exists public.ro_marcar_notificacao_com_anexo();
drop function if exists public.ro_incluir_anexo_na_notificacao();

create or replace function public.ro_formatar_notificacao_compra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_funcionario text;
  v_quantidade integer;
  v_primeira_partida timestamptz;
  v_complemento text := '';
begin
  select f.nome
  into v_funcionario
  from public.ro_passagem_solicitacoes s
  join public.funcionarios f on f.id = s.funcionario_id
  where s.id = new.solicitacao_id;

  select count(*), min(a.partida_em)
  into v_quantidade, v_primeira_partida
  from public.ro_passagem_anexos a
  where a.solicitacao_id = new.solicitacao_id;

  if v_primeira_partida is not null then
    v_complemento := format(
      ' Primeira partida prevista em %s.',
      to_char(v_primeira_partida at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
    );
  end if;

  if new.destinatario_tipo = 'solicitante' then
    new.mensagem := format(
      'Passagem comprada para %s. %s PDF(s) anexado(s) à solicitação.%s',
      v_funcionario,
      v_quantidade,
      v_complemento
    );
  elsif new.destinatario_tipo = 'funcionario' then
    if v_quantidade > 0 then
      new.mensagem := 'Sua passagem foi comprada. O(s) PDF(s) da passagem estão anexados à solicitação.' || v_complemento;
    else
      new.mensagem := 'Sua passagem foi comprada.' || v_complemento;
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists ro_formatar_notificacao_compra
on public.ro_passagem_notificacoes;

create trigger ro_formatar_notificacao_compra
before insert on public.ro_passagem_notificacoes
for each row
when (new.destinatario_tipo in ('solicitante', 'funcionario'))
execute function public.ro_formatar_notificacao_compra();
