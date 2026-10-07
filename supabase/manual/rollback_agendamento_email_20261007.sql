-- ROLLBACK CONTROLADO. Altera exclusivamente ro-email-notifications-5min.
-- Não remove extensões, schemas, outros jobs, secrets ou históricos.

do $rollback$
declare
  v_count integer;
begin
  if to_regclass('cron.job') is null then
    raise exception 'pg_cron/cron.job não está disponível; nada foi alterado';
  end if;

  select count(*)
    into v_count
  from cron.job
  where jobname = 'ro-email-notifications-5min';

  if v_count = 0 then
    raise notice 'Job ro-email-notifications-5min já está ausente; nada a fazer';
  elsif v_count = 1 then
    perform cron.unschedule('ro-email-notifications-5min');
  else
    raise exception 'Estado inesperado: mais de um job com o nome alvo; nada foi alterado';
  end if;
end
$rollback$;

-- Alternativa reversível para apenas pausar (execute no lugar do bloco acima):
-- select cron.alter_job(jobid, active := false)
-- from cron.job
-- where jobname = 'ro-email-notifications-5min';
