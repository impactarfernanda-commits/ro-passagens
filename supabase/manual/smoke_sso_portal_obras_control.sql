begin;
set local role service_role;
do $$ declare v_user uuid; v_hash text:=repeat('a',64); v_count integer; v_path text;
begin
 select id into v_user from auth.users order by created_at limit 1;
 if v_user is null then raise notice 'SMOKE IGNORADO: requer usuário fixture existente; nenhum dado foi alterado'; return; end if;
 insert into public.portal_sso_handoffs(code_hash,user_id,target_app,return_path,expires_at) values(v_hash,v_user,'obras-control','/alocacoes',now()+interval '60 seconds');
 select count(*),max(return_path) into v_count,v_path from public.portal_consumir_sso_handoff(v_hash,'obras-control');
 if v_count<>1 or v_path<>'/alocacoes' then raise exception 'handoff válido falhou'; end if;
 select count(*) into v_count from public.portal_consumir_sso_handoff(v_hash,'obras-control'); if v_count<>0 then raise exception 'reuso aceito'; end if;
 insert into public.portal_sso_handoffs(code_hash,user_id,target_app,return_path,created_at,expires_at) values(repeat('b',64),v_user,'obras-control','/obras',now()-interval '2 minutes',now()-interval '1 minute');
 select count(*) into v_count from public.portal_consumir_sso_handoff(repeat('b',64),'obras-control'); if v_count<>0 then raise exception 'expirado aceito'; end if;
 insert into public.portal_sso_handoffs(code_hash,user_id,target_app,return_path,expires_at) values(repeat('c',64),v_user,'obras-control','/relatorios',now()+interval '60 seconds');
 select count(*) into v_count from public.portal_consumir_sso_handoff(repeat('c',64),'outro'); if v_count<>0 then raise exception 'target incorreto aceito'; end if;
end $$;
reset role;
rollback;
