-- Agenda o worker da outbox de e-mails a cada cinco minutos.
-- Pré-requisito operacional: criar no Vault, antes desta migration, os secrets
-- portal_passagens_project_url e portal_passagens_cron_secret_key.
-- Esta migration não instala extensões, não cria secrets e não executa o worker.

do $migration$
declare
  v_job_id bigint;
  v_job_command text := $job$
select net.http_post(
  url := (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'portal_passagens_project_url'
  ) || '/functions/v1/ro-email-notifications',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'portal_passagens_cron_secret_key'
    )
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
) as request_id;
$job$;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Dependência ausente: habilite a extensão pg_cron antes de aplicar esta migration';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Dependência ausente: habilite a extensão pg_net antes de aplicar esta migration';
  end if;

  if to_regnamespace('cron') is null or to_regclass('cron.job') is null then
    raise exception 'Dependência ausente: schema/tabela cron.job não está disponível';
  end if;

  if to_regnamespace('net') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Dependência ausente: net.http_post esperado não está disponível';
  end if;

  if to_regnamespace('vault') is null
     or to_regclass('vault.secrets') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Dependência ausente: Supabase Vault não está disponível';
  end if;

  if (select count(*) from vault.secrets where name = 'portal_passagens_project_url') <> 1 then
    raise exception 'Vault inválido: deve existir exatamente um secret chamado portal_passagens_project_url';
  end if;

  if (select count(*) from vault.secrets where name = 'portal_passagens_cron_secret_key') <> 1 then
    raise exception 'Vault inválido: deve existir exatamente um secret chamado portal_passagens_cron_secret_key';
  end if;

  if exists (
    select 1
    from cron.job
    where jobname <> 'ro-email-notifications-5min'
      and position('/functions/v1/ro-email-notifications' in lower(command)) > 0
  ) then
    raise exception 'Conflito: já existe outro cron job apontando para ro-email-notifications; nenhum job foi alterado';
  end if;

  -- cron.schedule com nome é um upsert por (jobname, username), tornando a
  -- reaplicação segura sem remover nem alterar qualquer outro job.
  execute 'select cron.schedule($1, $2, $3)'
    into v_job_id
    using 'ro-email-notifications-5min', '*/5 * * * *', v_job_command;

  execute 'select cron.alter_job($1, active := true)'
    using v_job_id;
end
$migration$;
