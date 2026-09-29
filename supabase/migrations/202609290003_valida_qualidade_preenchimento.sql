begin;

create or replace function public.ro_texto_significativo(p_texto text,p_minimo integer)
returns boolean
language sql
immutable
set search_path=''
as $$
  select char_length(btrim(coalesce(p_texto,'')))>=p_minimo
    and btrim(coalesce(p_texto,'')) ~ '[A-Za-zÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]';
$$;

create or replace function public.ro_validar_qualidade_solicitacao()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op='INSERT' or new.origem is distinct from old.origem then
    if not public.ro_texto_significativo(new.origem,3) then raise exception 'ORIGEM_INVALIDA';end if;
    new.origem:=btrim(new.origem);
  end if;
  if tg_op='INSERT' or new.destino is distinct from old.destino then
    if not public.ro_texto_significativo(new.destino,3) then raise exception 'DESTINO_INVALIDO';end if;
    new.destino:=btrim(new.destino);
  end if;
  if (tg_op='INSERT' or new.justificativa_excecao_prazo is distinct from old.justificativa_excecao_prazo)
    and new.justificativa_excecao_prazo is not null then
    if not public.ro_texto_significativo(new.justificativa_excecao_prazo,20) then raise exception 'JUSTIFICATIVA_EXCECAO_INVALIDA';end if;
    new.justificativa_excecao_prazo:=btrim(new.justificativa_excecao_prazo);
  end if;
  if (tg_op='INSERT' or new.prazo_excecao_justificativa is distinct from old.prazo_excecao_justificativa)
    and new.prazo_excecao_justificativa is not null then
    if not public.ro_texto_significativo(new.prazo_excecao_justificativa,20) then raise exception 'JUSTIFICATIVA_EXCECAO_INVALIDA';end if;
    new.prazo_excecao_justificativa:=btrim(new.prazo_excecao_justificativa);
  end if;
  return new;
end $$;

drop trigger if exists ro_validar_qualidade_solicitacao on public.ro_passagem_solicitacoes;
create trigger ro_validar_qualidade_solicitacao
before insert or update of origem,destino,justificativa_excecao_prazo,prazo_excecao_justificativa
on public.ro_passagem_solicitacoes
for each row execute function public.ro_validar_qualidade_solicitacao();

create or replace function public.ro_reprovar_solicitacao(
  p_solicitacao_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.ro_passagem_solicitacoes%rowtype;
  m text:=btrim(coalesce(p_motivo,''));
begin
  if auth.uid() is null then raise exception 'AUTENTICACAO_OBRIGATORIA';end if;
  if not public.ro_texto_significativo(m,20) then raise exception 'MOTIVO_REPROVACAO_INVALIDO';end if;
  select * into v from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id and excluida_em is null for update;
  if not found then raise exception 'SOLICITACAO_NAO_ENCONTRADA';end if;
  if v.aprovador_id is distinct from auth.uid() then raise exception 'SOLICITACAO_NAO_DESTINADA_A_ESTE_APROVADOR';end if;
  if not public.ro_is_approval_candidate(auth.uid()) then raise exception 'APROVADOR_NAO_ELEGIVEL';end if;
  if v.aprovacao_status<>'pendente' or v.status<>'solicitada' then raise exception 'APROVACAO_NAO_PENDENTE';end if;
  perform set_config('ro.aprovacao_rpc','1',true);
  update public.ro_passagem_solicitacoes
  set status='recusada',aprovacao_status='reprovada',reprovado_em=now(),motivo_reprovacao_aprovador=m
  where id=v.id;
  insert into public.ro_passagem_historico(solicitacao_id,status_anterior,status_novo,descricao,criado_por)
  values(v.id,v.status,'recusada','Solicitação reprovada pelo aprovador responsável. Motivo: '||m,auth.uid());
end $$;

revoke all on function public.ro_texto_significativo(text,integer),public.ro_validar_qualidade_solicitacao() from public,anon;
revoke all on function public.ro_reprovar_solicitacao(uuid,text) from public,anon;
grant execute on function public.ro_reprovar_solicitacao(uuid,text) to authenticated;

commit;
