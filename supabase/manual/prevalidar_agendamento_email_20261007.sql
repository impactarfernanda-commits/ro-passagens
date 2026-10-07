-- READ-ONLY. Retorna exatamente uma linha e não chama a Edge Function.
-- query_to_xml permite consultar objetos opcionais sem abortar quando eles
-- ainda não existem. Nenhum valor armazenado no Vault é lido.

with capacidades as (
  select
    exists (select 1 from pg_extension where extname = 'pg_cron') as pg_cron_instalado,
    exists (select 1 from pg_extension where extname = 'pg_net') as pg_net_instalado,
    exists (select 1 from pg_extension where extname = 'supabase_vault')
      and to_regnamespace('vault') is not null
      and to_regclass('vault.secrets') is not null as vault_instalado,
    to_regclass('cron.job') is not null as cron_job_presente,
    to_regclass('cron.job_run_details') is not null as cron_job_run_details_presente,
    to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null
      as net_http_post_presente,
    to_regclass('vault.secrets') is not null as vault_secrets_presente
),
cron_xml as (
  select case
    when cron_job_presente then query_to_xml(
      $consulta$
        select
          count(*) filter (where jobname = 'ro-email-notifications-5min')::bigint
            as qtd_job_nome_esperado,
          count(*) filter (
            where position('/functions/v1/ro-email-notifications' in lower(command)) > 0
          )::bigint as qtd_jobs_endpoint,
          count(*) filter (
            where jobname <> 'ro-email-notifications-5min'
              and position('/functions/v1/ro-email-notifications' in lower(command)) > 0
          )::bigint as qtd_jobs_concorrentes
        from cron.job
      $consulta$,
      false,
      true,
      ''
    )
    else query_to_xml(
      'select 0::bigint as qtd_job_nome_esperado,
              0::bigint as qtd_jobs_endpoint,
              0::bigint as qtd_jobs_concorrentes',
      false,
      true,
      ''
    )
  end as documento
  from capacidades
),
cron_metricas as (
  select
    ((xpath('/table/row/qtd_job_nome_esperado/text()', documento))[1]::text)::bigint
      as qtd_job_nome_esperado,
    ((xpath('/table/row/qtd_jobs_endpoint/text()', documento))[1]::text)::bigint
      as qtd_jobs_endpoint,
    ((xpath('/table/row/qtd_jobs_concorrentes/text()', documento))[1]::text)::bigint
      as qtd_jobs_concorrentes
  from cron_xml
),
vault_xml as (
  select case
    when vault_secrets_presente then query_to_xml(
      $consulta$
        select
          count(*) filter (where name = 'portal_passagens_project_url')::bigint
            as qtd_project_url,
          count(*) filter (where name = 'portal_passagens_cron_secret_key')::bigint
            as qtd_cron_secret_key
        from vault.secrets
      $consulta$,
      false,
      true,
      ''
    )
    else query_to_xml(
      'select 0::bigint as qtd_project_url,
              0::bigint as qtd_cron_secret_key',
      false,
      true,
      ''
    )
  end as documento
  from capacidades
),
vault_metricas as (
  select
    ((xpath('/table/row/qtd_project_url/text()', documento))[1]::text)::bigint
      as qtd_project_url,
    ((xpath('/table/row/qtd_cron_secret_key/text()', documento))[1]::text)::bigint
      as qtd_cron_secret_key
  from vault_xml
)
select
  c.pg_cron_instalado,
  c.pg_net_instalado,
  c.vault_instalado,
  c.cron_job_presente,
  c.cron_job_run_details_presente,
  c.net_http_post_presente,
  v.qtd_project_url,
  v.qtd_cron_secret_key,
  j.qtd_job_nome_esperado,
  j.qtd_jobs_endpoint,
  j.qtd_jobs_concorrentes,
  c.pg_cron_instalado
    and c.pg_net_instalado
    and c.vault_instalado
    and c.cron_job_presente
    and c.cron_job_run_details_presente
    and c.net_http_post_presente
    and v.qtd_project_url = 1
    and v.qtd_cron_secret_key = 1
    and j.qtd_job_nome_esperado <= 1
    and j.qtd_jobs_endpoint = j.qtd_job_nome_esperado
    and j.qtd_jobs_concorrentes = 0
    as pronto_para_instalar
from capacidades c
cross join cron_metricas j
cross join vault_metricas v;
