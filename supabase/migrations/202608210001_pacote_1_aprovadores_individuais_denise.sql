begin;

-- Novos campos permanecem nulos nas solicitações históricas.
alter table public.ro_passagem_solicitacoes
 add column if not exists aprovador_id uuid references auth.users(id) on delete restrict,
 add column if not exists aprovacao_status text,
 add column if not exists aprovado_em timestamptz,
 add column if not exists reprovado_em timestamptz,
 add column if not exists motivo_reprovacao_aprovador text;

do $$
begin
  alter table public.ro_passagem_solicitacoes
    add constraint ro_aprovacao_status_ck
    check(
      aprovacao_status is null
      or aprovacao_status in('pendente','aprovada','reprovada','dispensada')
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ro_passagem_solicitacoes
    add constraint ro_aprovacao_coerente_ck
    check(
      (
        aprovacao_status is null
        and aprovador_id is null
        and aprovado_em is null
        and reprovado_em is null
        and motivo_reprovacao_aprovador is null
      )
      or (
        aprovacao_status='pendente'
        and aprovador_id is not null
        and aprovado_em is null
        and reprovado_em is null
        and motivo_reprovacao_aprovador is null
      )
      or (
        aprovacao_status='aprovada'
        and aprovador_id is not null
        and aprovado_em is not null
        and reprovado_em is null
        and motivo_reprovacao_aprovador is null
      )
      or (
        aprovacao_status='reprovada'
        and aprovador_id is not null
        and aprovado_em is null
        and reprovado_em is not null
        and char_length(btrim(motivo_reprovacao_aprovador))>=10
      )
      or (
        aprovacao_status='dispensada'
        and aprovador_id is null
        and aprovado_em is not null
        and reprovado_em is null
        and motivo_reprovacao_aprovador is null
      )
    );
exception
  when duplicate_object then null;
end $$;

create index if not exists ro_minhas_aprovacoes_idx
on public.ro_passagem_solicitacoes(aprovador_id,created_at desc)
where aprovacao_status='pendente'
  and excluida_em is null;


create or replace function public.ro_is_denise(
  p_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select p_user='d6081413-3730-41f0-981d-935a44303993'::uuid;
$$;


create or replace function public.ro_is_approval_candidate(
  p_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    p_user is not null
    and (
      p_user in(
        '3660689c-1e6f-4e09-b414-3433b44d1681'::uuid,
        '0811a9c7-b52e-4213-9086-ffddefbbca16'::uuid
      )
      or exists(
        select 1
        from public.user_roles r
        where r.user_id=p_user
          and r.role::text='coordenador'
      )
    );
$$;


create or replace function public.ro_approval_exempt(
  p_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    p_user is not null
    and (
      coalesce(public.ro_can_operate(p_user),false)
      or coalesce(public.ro_is_rh_active(p_user),false)
      or exists(
        select 1
        from public.user_roles r
        where r.user_id=p_user
          and r.role::text in('gerente','diretor')
      )
    );
$$;


create or replace function public.ro_listar_aprovadores()
returns table(
  id uuid,
  label text
)
language sql
stable
security definer
set search_path=''
as $$
  select
    p.id,
    coalesce(nullif(btrim(p.full_name),''),u.email::text)
  from public.users_profiles p
  join auth.users u on u.id=p.id
  where auth.uid() is not null
    and public.ro_is_approval_candidate(p.id)
  order by 2,1;
$$;


-- Impede que o INSERT direto contorne a escolha/dispensa de aprovador.
create or replace function public.ro_exigir_fluxo_aprovacao_nova()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if coalesce(current_setting('ro.approval_creation',true),'')<>'1' then
    raise exception 'CRIACAO_SOMENTE_POR_RPC_COM_APROVADOR';
  end if;

  return new;
end $$;

drop trigger if exists ro_exigir_fluxo_aprovacao_nova
on public.ro_passagem_solicitacoes;

create trigger ro_exigir_fluxo_aprovacao_nova
before insert on public.ro_passagem_solicitacoes
for each row
execute function public.ro_exigir_fluxo_aprovacao_nova();


create or replace function public.ro_notificar_equipe_solicitacao_liberada(
  p_solicitacao_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_nome text;
  v_sol public.ro_passagem_solicitacoes%rowtype;
  v_ro record;
begin

  select *
  into v_sol
  from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id;

  if not found
     or v_sol.aprovacao_status not in('aprovada','dispensada') then
    raise exception 'SOLICITACAO_NAO_LIBERADA_PARA_O_RO';
  end if;

  select f.nome
  into v_nome
  from public.funcionarios f
  where f.id=v_sol.funcionario_id;

  for v_ro in
    select r.user_id
    from public.ro_responsaveis r
    where r.ativo
  loop

    insert into public.ro_passagem_notificacoes(
      solicitacao_id,
      canal,
      destinatario_tipo,
      destinatario,
      mensagem
    )
    values(
      v_sol.id,
      'interno',
      'ro',
      v_ro.user_id::text,
      format(
        'Nova solicitação de passagem liberada para %s, motivo %s, origem %s, destino %s.',
        v_nome,
        v_sol.motivo,
        v_sol.origem,
        v_sol.destino
      )
    );

  end loop;

end $$;


-- O trigger continua criando histórico, mas posterga a notificação operacional no novo fluxo.
create or replace function public.ro_on_solicitacao_criada()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_nome text;
  v_ro record;
begin

  insert into public.ro_passagem_historico(
    solicitacao_id,
    status_novo,
    descricao,
    criado_por
  )
  values(
    new.id,
    new.status,
    'Solicitação criada.',
    new.solicitante_id
  );

  if coalesce(current_setting('ro.approval_creation',true),'')='1' then
    return new;
  end if;

  select f.nome
  into v_nome
  from public.funcionarios f
  where f.id=new.funcionario_id;

  for v_ro in
    select r.user_id
    from public.ro_responsaveis r
    where r.ativo
  loop

    insert into public.ro_passagem_notificacoes(
      solicitacao_id,
      canal,
      destinatario_tipo,
      destinatario,
      mensagem
    )
    values(
      new.id,
      'interno',
      'ro',
      v_ro.user_id::text,
      format(
        'Nova solicitação de passagem criada para %s, motivo %s, origem %s, destino %s.',
        v_nome,
        new.motivo,
        new.origem,
        new.destino
      )
    );

  end loop;

  return new;
end $$;


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
  v_dispensa boolean;
begin

  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;

  v_dispensa:=public.ro_approval_exempt(auth.uid());

  if v_dispensa then
    v_aprovador:=null;
  else

    if v_aprovador is null then
      raise exception 'APROVADOR_OBRIGATORIO';
    end if;

    if not public.ro_is_approval_candidate(v_aprovador) then
      raise exception 'APROVADOR_INVALIDO';
    end if;

    v_auto:=
      v_aprovador=auth.uid()
      and exists(
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
      when v_dispensa then
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


create or replace function public.ro_aprovar_solicitacao(
  p_solicitacao_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.ro_passagem_solicitacoes%rowtype;
begin

  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;

  select *
  into v
  from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id
    and excluida_em is null
  for update;

  if not found then
    raise exception 'SOLICITACAO_NAO_ENCONTRADA';
  end if;

  if v.aprovador_id is distinct from auth.uid() then
    raise exception 'SOLICITACAO_NAO_DESTINADA_A_ESTE_APROVADOR';
  end if;

  if not public.ro_is_approval_candidate(auth.uid()) then
    raise exception 'APROVADOR_NAO_ELEGIVEL';
  end if;

  if v.aprovacao_status<>'pendente'
     or v.status<>'solicitada' then
    raise exception 'APROVACAO_NAO_PENDENTE';
  end if;

  perform set_config('ro.aprovacao_rpc','1',true);

  update public.ro_passagem_solicitacoes
  set
    aprovacao_status='aprovada',
    aprovado_em=now()
  where id=v.id;

  insert into public.ro_passagem_historico(
    solicitacao_id,
    status_anterior,
    status_novo,
    descricao,
    criado_por
  )
  values(
    v.id,
    v.status,
    v.status,
    'Solicitação aprovada pelo aprovador responsável.',
    auth.uid()
  );

  perform public.ro_notificar_equipe_solicitacao_liberada(v.id);

end $$;


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
  m text:=btrim(regexp_replace(coalesce(p_motivo,''),'\s+',' ','g'));
begin

  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;

  if char_length(m)<10 then
    raise exception 'MOTIVO_REPROVACAO_MINIMO_10_CARACTERES';
  end if;

  select *
  into v
  from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id
    and excluida_em is null
  for update;

  if not found then
    raise exception 'SOLICITACAO_NAO_ENCONTRADA';
  end if;

  if v.aprovador_id is distinct from auth.uid() then
    raise exception 'SOLICITACAO_NAO_DESTINADA_A_ESTE_APROVADOR';
  end if;

  if not public.ro_is_approval_candidate(auth.uid()) then
    raise exception 'APROVADOR_NAO_ELEGIVEL';
  end if;

  if v.aprovacao_status<>'pendente'
     or v.status<>'solicitada' then
    raise exception 'APROVACAO_NAO_PENDENTE';
  end if;

  perform set_config('ro.aprovacao_rpc','1',true);

  update public.ro_passagem_solicitacoes
  set
    aprovacao_status='reprovada',
    reprovado_em=now(),
    motivo_reprovacao_aprovador=m,
    status='recusada'
  where id=v.id;

  insert into public.ro_passagem_historico(
    solicitacao_id,
    status_anterior,
    status_novo,
    descricao,
    criado_por
  )
  values(
    v.id,
    v.status,
    'recusada',
    'Solicitação reprovada pelo aprovador responsável. Motivo: '||m,
    auth.uid()
  );

end $$;


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
      solicitante_id=auth.uid()
      or aprovador_id=auth.uid()
      or (
        public.ro_can_view_all()
        and aprovacao_status is distinct from 'pendente'
      )
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


create or replace function public.ro_bloquear_operacao_sem_aprovacao()
returns trigger
language plpgsql
set search_path=''
as $$
begin

  if old.aprovacao_status='pendente'
     and (
       new.status is distinct from old.status
       or new.comprado_em is distinct from old.comprado_em
       or new.responsavel_ro_id is distinct from old.responsavel_ro_id
       or new.excluida_em is distinct from old.excluida_em
     )
     and coalesce(current_setting('ro.aprovacao_rpc',true),'')<>'1'
  then
    raise exception 'SOLICITACAO_AGUARDANDO_APROVACAO';
  end if;

  return new;
end $$;

drop trigger if exists ro_bloquear_operacao_sem_aprovacao
on public.ro_passagem_solicitacoes;

create trigger ro_bloquear_operacao_sem_aprovacao
before update on public.ro_passagem_solicitacoes
for each row
execute function public.ro_bloquear_operacao_sem_aprovacao();


create or replace function public.ro_proteger_campos_aprovacao()
returns trigger
language plpgsql
set search_path=''
as $$
begin

  if (
    new.aprovador_id,
    new.aprovacao_status,
    new.aprovado_em,
    new.reprovado_em,
    new.motivo_reprovacao_aprovador
  ) is distinct from (
    old.aprovador_id,
    old.aprovacao_status,
    old.aprovado_em,
    old.reprovado_em,
    old.motivo_reprovacao_aprovador
  )
  and coalesce(current_setting('ro.aprovacao_rpc',true),'')<>'1'
  then
    raise exception 'CAMPOS_APROVACAO_SOMENTE_POR_RPC';
  end if;

  return new;
end $$;

drop trigger if exists ro_proteger_campos_aprovacao
on public.ro_passagem_solicitacoes;

create trigger ro_proteger_campos_aprovacao
before update on public.ro_passagem_solicitacoes
for each row
execute function public.ro_proteger_campos_aprovacao();


create or replace function public.ro_proteger_filhos_sem_aprovacao()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_id uuid:=
    case
      when tg_op='DELETE' then old.solicitacao_id
      else new.solicitacao_id
    end;
begin

  -- AJUSTE REVISAO 1:
  -- também bloqueia operação em solicitações já reprovadas.
  if exists(
    select 1
    from public.ro_passagem_solicitacoes s
    where s.id=v_id
      and s.aprovacao_status in('pendente','reprovada')
  ) then
    raise exception 'SOLICITACAO_NAO_LIBERADA';
  end if;

  return
    case
      when tg_op='DELETE' then old
      else new
    end;
end $$;


drop trigger if exists ro_custos_bloquear_sem_aprovacao
on public.ro_passagem_custos;

create trigger ro_custos_bloquear_sem_aprovacao
before insert or update or delete
on public.ro_passagem_custos
for each row
execute function public.ro_proteger_filhos_sem_aprovacao();


drop trigger if exists ro_anexos_bloquear_sem_aprovacao
on public.ro_passagem_anexos;

create trigger ro_anexos_bloquear_sem_aprovacao
before insert or update or delete
on public.ro_passagem_anexos
for each row
execute function public.ro_proteger_filhos_sem_aprovacao();


create or replace function public.ro_proteger_valor_passagem()
returns trigger
language plpgsql
set search_path=''
as $$
begin

  if old.tipo='passagem'
     and new.valor is distinct from old.valor
     and coalesce(current_setting('ro.edicao_passagem_denise',true),'')<>'1'
  then
    raise exception 'PASSAGEM_SOMENTE_POR_RPC_DENISE';
  end if;

  return new;
end $$;


drop trigger if exists ro_proteger_valor_passagem
on public.ro_passagem_custos;

create trigger ro_proteger_valor_passagem
before update on public.ro_passagem_custos
for each row
execute function public.ro_proteger_valor_passagem();


create or replace function public.ro_atualizar_valor_passagem(
  p_solicitacao_id uuid,
  p_custo_id uuid,
  p_novo_valor numeric,
  p_justificativa text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.ro_passagem_solicitacoes%rowtype;
  c public.ro_passagem_custos%rowtype;
  v numeric(12,2);
  j text;
  t numeric(12,2);
begin

  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;

  if not public.ro_is_denise(auth.uid()) then
    raise exception 'EDICAO_PASSAGEM_EXCLUSIVA_DENISE';
  end if;

  j:=btrim(
    regexp_replace(
      coalesce(p_justificativa,''),
      '\s+',
      ' ',
      'g'
    )
  );

  if char_length(j)<10 then
    raise exception 'JUSTIFICATIVA_MINIMO_10_CARACTERES';
  end if;

  if p_novo_valor is null
     or p_novo_valor::text in('NaN','Infinity','-Infinity') then
    raise exception 'VALOR_CUSTO_INVALIDO';
  end if;

  v:=round(p_novo_valor,2);

  if v<0.01
     or v>9999999999.99 then
    raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';
  end if;

  select *
  into s
  from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id
    and excluida_em is null
  for update;

  if not found
     or s.status in('cancelada','recusada') then
    raise exception 'SOLICITACAO_NAO_PERMITE_EDICAO';
  end if;

  -- AJUSTE REVISAO 2:
  -- Denise também não pode alterar passagem antes da aprovação.
  if s.aprovacao_status='pendente' then
    raise exception 'SOLICITACAO_AGUARDANDO_APROVACAO';
  end if;

  select *
  into c
  from public.ro_passagem_custos
  where id=p_custo_id
    and solicitacao_id=p_solicitacao_id
    and tipo='passagem'
  for update;

  if not found then
    raise exception 'PASSAGEM_NAO_PERTENCE_A_SOLICITACAO';
  end if;

  perform set_config(
    'ro.edicao_passagem_denise',
    '1',
    true
  );

  update public.ro_passagem_custos
  set valor=v
  where id=c.id;

  insert into public.ro_passagem_historico(
    solicitacao_id,
    status_anterior,
    status_novo,
    descricao,
    criado_por
  )
  values(
    s.id,
    s.status,
    s.status,
    format(
      'Valor da passagem %s alterado de R$ %s para R$ %s. Justificativa: %s',
      c.id,
      c.valor,
      v,
      j
    ),
    auth.uid()
  );

  select coalesce(sum(valor),0)
  into t
  from public.ro_passagem_custos
  where solicitacao_id=s.id;

  return jsonb_build_object(
    'custo_id',c.id,
    'valor_anterior',c.valor,
    'valor_novo',v,
    'total',t,
    'justificativa',j,
    'alterado_por',auth.uid(),
    'alterado_em',now()
  );

end $$;


create or replace function public.ro_proteger_complemento_denise()
returns trigger
language plpgsql
set search_path=''
as $$
begin

  if new.complementar
     and not public.ro_is_denise(auth.uid()) then
    raise exception 'PASSAGEM_COMPLEMENTAR_EXCLUSIVA_DENISE';
  end if;

  return new;
end $$;


drop trigger if exists ro_proteger_complemento_denise
on public.ro_passagem_anexos;

create trigger ro_proteger_complemento_denise
before insert or update
on public.ro_passagem_anexos
for each row
execute function public.ro_proteger_complemento_denise();


-- Substitui a assinatura atual: valida identidade, Storage e grava anexo/custo/histórico atomicamente.
create or replace function public.ro_registrar_passagem_complementar(
  p_solicitacao_id uuid,
  p_anexos jsonb,
  p_imprevisto boolean,
  p_motivo_complementar text,
  p_custos_adicionais jsonb
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.ro_passagem_solicitacoes%rowtype;
  i jsonb;
  v_path text;
  v_cc uuid;
  v_valor numeric(12,2);
  v_anexo uuid;
  v_custo uuid;
  v_motivo text;
begin

  if auth.uid() is null then
    raise exception 'AUTENTICACAO_OBRIGATORIA';
  end if;

  if not public.ro_is_denise(auth.uid()) then
    raise exception 'PASSAGEM_COMPLEMENTAR_EXCLUSIVA_DENISE';
  end if;

  v_motivo:=btrim(
    regexp_replace(
      coalesce(p_motivo_complementar,''),
      '\s+',
      ' ',
      'g'
    )
  );

  if char_length(v_motivo)<10 then
    raise exception 'JUSTIFICATIVA_COMPLEMENTO_MINIMO_10_CARACTERES';
  end if;

  if jsonb_array_length(coalesce(p_anexos,'[]'::jsonb))=0 then
    raise exception 'ANEXO_COMPLEMENTAR_OBRIGATORIO';
  end if;

  select *
  into s
  from public.ro_passagem_solicitacoes
  where id=p_solicitacao_id
    and excluida_em is null
  for update;

  if not found then
    raise exception 'SOLICITACAO_NAO_ENCONTRADA';
  end if;

  if s.status not in('passagem_comprada','finalizada') then
    raise exception 'COMPLEMENTO_EXIGE_PASSAGEM_COMPRADA_OU_FINALIZADA';
  end if;

  for i in
    select value
    from jsonb_array_elements(p_anexos)
  loop

    v_path:=i->>'storage_path';

    if v_path is null
       or v_path not like p_solicitacao_id::text||'/complementares/%' then
      raise exception 'STORAGE_PATH_COMPLEMENTAR_INVALIDO';
    end if;

    if not exists(
      select 1
      from storage.objects o
      where o.bucket_id='ro-passagem-anexos'
        and o.name=v_path
        and o.owner_id::text=auth.uid()::text
    ) then
      raise exception 'ARQUIVO_INEXISTENTE_OU_NAO_PERTENCE_A_DENISE';
    end if;

    if exists(
      select 1
      from public.ro_passagem_anexos a
      where a.storage_path=v_path
    ) then
      raise exception 'ARQUIVO_JA_VINCULADO';
    end if;

    v_cc:=nullif(i->>'centro_custo_id','')::uuid;

    if v_cc is null
       or not (
         v_cc is not distinct from s.obra_id
         or v_cc is not distinct from s.centro_custo_destino_id
         or v_cc is not distinct from s.centro_custo_retorno_id
       )
       or not exists(
         select 1
         from public.obras o
         where o.id=v_cc
           and o.visivel_passagens
           and o.escopo_passagens in('comum','restrito_ro')
       )
    then
      raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';
    end if;

    v_valor:=
      case
        when nullif(i->>'valor','') is null then null
        else round((i->>'valor')::numeric,2)
      end;

    if v_valor is not null
       and (
         v_valor<0.01
         or v_valor>9999999999.99
       ) then
      raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';
    end if;

    insert into public.ro_passagem_anexos(
      solicitacao_id,
      tipo,
      nome_arquivo,
      storage_path,
      mime_type,
      tamanho_bytes,
      uploaded_by,
      partida_em,
      valor,
      observacao,
      complementar,
      imprevisto,
      motivo_complementar,
      criado_por
    )
    values(
      p_solicitacao_id,
      'passagem_pdf',
      i->>'nome_arquivo',
      v_path,
      i->>'mime_type',
      (i->>'tamanho_bytes')::bigint,
      auth.uid(),
      nullif(i->>'partida_em','')::timestamptz,
      v_valor,
      nullif(i->>'observacao',''),
      true,
      coalesce(p_imprevisto,false),
      v_motivo,
      auth.uid()
    )
    returning id into v_anexo;

    v_custo:=null;

    if v_valor is not null then

      insert into public.ro_passagem_custos(
        solicitacao_id,
        tipo,
        descricao,
        valor,
        centro_custo_id,
        created_by
      )
      values(
        p_solicitacao_id,
        'passagem',
        'Passagem complementar: '||(i->>'nome_arquivo'),
        v_valor,
        v_cc,
        auth.uid()
      )
      returning id into v_custo;

    end if;

    insert into public.ro_passagem_historico(
      solicitacao_id,
      status_anterior,
      status_novo,
      descricao,
      criado_por
    )
    values(
      p_solicitacao_id,
      s.status,
      s.status,
      format(
        'Passagem complementar registrada. Anexo: %s. Caminho: %s. Custo: %s. Justificativa: %s',
        v_anexo,
        v_path,
        coalesce(v_custo::text,'sem valor'),
        v_motivo
      ),
      auth.uid()
    );

  end loop;


  for i in
    select value
    from jsonb_array_elements(
      coalesce(p_custos_adicionais,'[]'::jsonb)
    )
  loop

    if i->>'tipo' not in('uber','refeicao','outros') then
      raise exception 'TIPO_CUSTO_ADICIONAL_INVALIDO';
    end if;

    v_cc:=nullif(i->>'centro_custo_id','')::uuid;

    -- AJUSTE REVISAO 3:
    -- aplica aos custos adicionais a mesma validação de CC usada no anexo complementar.
    if v_cc is null
       or not (
         v_cc is not distinct from s.obra_id
         or v_cc is not distinct from s.centro_custo_destino_id
         or v_cc is not distinct from s.centro_custo_retorno_id
       )
       or not exists(
         select 1
         from public.obras o
         where o.id=v_cc
           and o.visivel_passagens
           and o.escopo_passagens in('comum','restrito_ro')
       )
    then
      raise exception 'CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO';
    end if;

    v_valor:=round(
      coalesce(
        nullif(i->>'valor','')::numeric,
        0
      ),
      2
    );

    if v_valor<0.01
       or v_valor>9999999999.99 then
      raise exception 'VALOR_CUSTO_FORA_DO_LIMITE';
    end if;

    insert into public.ro_passagem_custos(
      solicitacao_id,
      tipo,
      descricao,
      valor,
      centro_custo_id,
      created_by
    )
    values(
      p_solicitacao_id,
      i->>'tipo',
      coalesce(
        nullif(i->>'descricao',''),
        'Complemento: '||(i->>'tipo')
      ),
      v_valor,
      v_cc,
      auth.uid()
    );

  end loop;

end $$;


drop policy if exists ro_storage_insert
on storage.objects;

create policy ro_storage_insert
on storage.objects
for insert
to authenticated
with check(
  bucket_id='ro-passagem-anexos'
  and owner_id::text=auth.uid()::text
  and public.ro_can_operate()
  and (
    (
      (storage.foldername(name))[2]='complementares'
      and public.ro_is_denise(auth.uid())
    )
    or coalesce(
      (storage.foldername(name))[2],
      ''
    )<>'complementares'
  )
  and exists(
    select 1
    from public.ro_passagem_solicitacoes s
    where s.id::text=(storage.foldername(name))[1]
      and s.excluida_em is null
      and s.aprovacao_status is distinct from 'pendente'
      and s.status in(
        'em_andamento',
        'passagem_comprada',
        'finalizada'
      )
      and s.folga_antecipacao_status is distinct from 'pendente'
  )
);


revoke all on function
  public.ro_is_denise(uuid),
  public.ro_is_approval_candidate(uuid),
  public.ro_approval_exempt(uuid),
  public.ro_listar_aprovadores(),
  public.ro_criar_solicitacao_com_aprovador(jsonb,jsonb),
  public.ro_aprovar_solicitacao(uuid),
  public.ro_reprovar_solicitacao(uuid,text),
  public.ro_atualizar_valor_passagem(uuid,uuid,numeric,text),
  public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb)
from public,anon;


revoke all on function
  public.ro_notificar_equipe_solicitacao_liberada(uuid)
from public,anon,authenticated;


revoke all on function
  public.ro_criar_solicitacao_validada(jsonb,jsonb),
  public.ro_criar_solicitacao_colaborador_validada(jsonb,jsonb),
  public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text)
from public,anon,authenticated;


grant execute on function
  public.ro_is_denise(uuid),
  public.ro_is_approval_candidate(uuid),
  public.ro_listar_aprovadores(),
  public.ro_criar_solicitacao_com_aprovador(jsonb,jsonb),
  public.ro_aprovar_solicitacao(uuid),
  public.ro_reprovar_solicitacao(uuid,text),
  public.ro_atualizar_valor_passagem(uuid,uuid,numeric,text),
  public.ro_registrar_passagem_complementar(uuid,jsonb,boolean,text,jsonb)
to authenticated;

commit;