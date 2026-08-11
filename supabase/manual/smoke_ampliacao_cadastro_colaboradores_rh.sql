begin;
-- Smoke transacional; use somente ambiente local/staging com auth.uid() configurado.
do $$ declare v_obras uuid;v_externo uuid;v_catalogados integer;begin
 select f.id into v_obras from public.funcionarios f where f.ativo and f.deleted_at is null
   order by exists(select 1 from public.alocacoes a where a.funcionario_id=f.id),f.id limit 1;
 if v_obras is null then raise notice 'Fixture Obras indisponível: cenário vinculado não executado';else
  insert into public.ro_funcionarios_enderecos_privados(funcionario_id,nome,cpf,cidade,uf,criado_por,atualizado_por) values(v_obras,'Fixture Vinculado','12345678901','Porto Velho','RO',auth.uid(),auth.uid());
 end if;
 insert into public.ro_funcionarios_enderecos_privados(nome,cpf,telefone,cidade,uf,criado_por,atualizado_por) values('Fixture Externo','98765432100','69999999999','Ji-Paraná','RO',auth.uid(),auth.uid()) returning id into v_externo;
 select count(*) into v_catalogados from public.ro_catalogo_colaboradores_viagem() c where c.id=v_externo and c.funcionario_id is null;
 if v_catalogados<>1 then raise exception 'Externo sem obra/alocação ausente do catálogo';end if;
 perform public.ro_salvar_colaborador_viagem(jsonb_build_object('id',v_externo,'nome','Fixture Externo','telefone','','bairro','Centro'));
 if (select telefone from public.ro_funcionarios_enderecos_privados where id=v_externo)<>'69999999999' then raise exception 'Célula vazia apagou telefone';end if;
 update public.ro_funcionarios_enderecos_privados set ativo=false where id=v_externo;
 if exists(select 1 from public.ro_catalogo_colaboradores_viagem() c where c.id=v_externo) then raise exception 'Inativo apareceu no catálogo';end if;
 begin insert into public.ro_funcionarios_enderecos_privados(nome,cpf,criado_por,atualizado_por) values('Duplicado','98765432100',auth.uid(),auth.uid());raise exception 'Duplicidade não bloqueada';exception when unique_violation then null;end;
 if not public.ro_can_manage_private_addresses() then raise exception 'Execute como RH/administradora';end if;
 if not public.ro_can_view_private_addresses() then raise exception 'Leitura RO/RH indisponível';end if;
end $$;
rollback;
