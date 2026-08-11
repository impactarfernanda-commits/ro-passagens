begin;
do $$ declare v_id uuid;begin
 select id into v_id from public.ro_funcionarios_enderecos_privados where cpf is not null limit 1;
 if v_id is not null then begin update public.ro_funcionarios_enderecos_privados set cpf=case when cpf='11111111111' then '22222222222' else '11111111111' end where id=v_id;raise exception 'SMOKE_FALHOU';exception when others then if sqlerrm='SMOKE_FALHOU' then raise;end if;end;end if;
end $$;
rollback;
