begin;

create or replace function public.ro_criar_solicitacao_com_aprovador(
  p_solicitacao jsonb,
  p_documentos jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_aprovador uuid:=nullif(p_solicitacao->>'aprovador_id','')::uuid;
  v_auto boolean:=false;
  v_dispensa_perfil boolean;
  v_dispensa_desligamento_urgente boolean:=
    p_solicitacao->>'motivo'='desligamento'
    and p_solicitacao->>'desligamento_subtipo'
        in('pedido_demissao','justa_causa');
  v_dispensa boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;

  v_dispensa_perfil:=public.ro_approval_exempt(auth.uid());
  v_dispensa:=v_dispensa_perfil or v_dispensa_desligamento_urgente;

  if v_dispensa then
    v_aprovador:=null;
  else
    if v_aprovador is null then
      raise exception 'APROVADOR_OBRIGATORIO';
    end if;

    if not public.ro_is_approval_candidate(v_aprovador) then
      raise exception 'APROVADOR_INVALIDO';
    end if;

    v_auto:=v_aprovador=auth.uid() and exists(
      select 1
      from public.user_roles r
      where r.user_id=auth.uid()
        and r.role::text='coordenador'
    );

    if v_aprovador=auth.uid() and not v_auto then
      raise exception 'AUTOAPROVACAO_NAO_PERMITIDA';
    end if;
  end if;

  perform set_config('ro.approval_creation','1',true);

  v_id:=public.ro_criar_solicitacao_colaborador_validada(
    p_solicitacao-'aprovador_id',
    p_documentos
  );

  perform set_config('ro.aprovacao_rpc','1',true);

  update public.ro_passagem_solicitacoes
  set
    aprovador_id=v_aprovador,
    aprovacao_status=
      case
        when v_dispensa then 'dispensada'
        when v_auto then 'aprovada'
        else 'pendente'
      end,
    aprovado_em=
      case
        when v_dispensa or v_auto then now()
      end
  where id=v_id;

  insert into public.ro_passagem_historico(
    solicitacao_id,
    status_anterior,
    status_novo,
    descricao,
    criado_por
  )
  values(
    v_id,
    'solicitada',
    'solicitada',
    case
      when v_dispensa_desligamento_urgente then
        'Aprovação dispensada por regra de desligamento urgente.'
      when v_dispensa_perfil then
        'Aprovação dispensada por regra de perfil (RH, RO, Gerência ou Diretoria).'
      when v_auto then
        'Autoaprovação pelo próprio coordenador.'
      else
        'Solicitação aguardando aprovação do aprovador responsável.'
    end,
    auth.uid()
  );

  if v_dispensa or v_auto then
    perform public.ro_notificar_equipe_solicitacao_liberada(v_id);
  end if;

  return v_id;
end $$;

revoke all on function
public.ro_criar_solicitacao_com_aprovador(jsonb,jsonb)
from public,anon;

grant execute on function
public.ro_criar_solicitacao_com_aprovador(jsonb,jsonb)
to authenticated;

commit;