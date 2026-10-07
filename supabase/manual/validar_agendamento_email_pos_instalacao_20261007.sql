-- READ-ONLY. Retorna exatamente uma linha e não chama a Edge Function.
-- Não lê valores do Vault nem retorna o comando, o payload ou headers do job.

with capacidades as (
  select
    to_regclass('cron.job') is not null as cron_job_presente,
    to_regclass('cron.job_run_details') is not null as cron_job_run_details_presente,
    to_regclass('net._http_response') is not null as net_response_presente
),
job_xml as (
  select case
    when cron_job_presente then query_to_xml(
      $consulta$
        select
          count(*) = 1 as job_exatamente_um,
          count(*) filter (where schedule = '*/5 * * * *') = 1 as schedule_correto,
          count(*) filter (where active) = 1 as job_ativo,
          count(*) filter (
            where position('/functions/v1/ro-email-notifications' in lower(command)) > 0
          ) = 1 as endpoint_correto,
          count(*) filter (
            where position('portal_passagens_project_url' in command) > 0
              and position('vault.' in lower(command)) > 0
          ) = 1 as usa_vault_project_url,
          count(*) filter (
            where position('portal_passagens_cron_secret_key' in command) > 0
              and position('vault.' in lower(command)) > 0
          ) = 1 as usa_vault_secret_key,
          count(*) filter (
            where command ~ '(sb_secret_[a-zA-Z0-9_-]{16,}|eyJ[a-zA-Z0-9_-]{10,}\.)'
          ) = 0 as nao_expoe_secret_literal,
          not exists (
            select 1
            from cron.job concorrente
            where concorrente.jobname <> 'ro-email-notifications-5min'
              and position(
                '/functions/v1/ro-email-notifications' in lower(concorrente.command)
              ) > 0
          ) as sem_job_concorrente
        from cron.job
        where jobname = 'ro-email-notifications-5min'
      $consulta$,
      false,
      true,
      ''
    )
    else query_to_xml(
      'select false as job_exatamente_um,
              false as schedule_correto,
              false as job_ativo,
              false as endpoint_correto,
              false as usa_vault_project_url,
              false as usa_vault_secret_key,
              false as nao_expoe_secret_literal,
              false as sem_job_concorrente',
      false,
      true,
      ''
    )
  end as documento
  from capacidades
),
job_metricas as (
  select
    ((xpath('/table/row/job_exatamente_um/text()', documento))[1]::text)::boolean
      as job_exatamente_um,
    ((xpath('/table/row/schedule_correto/text()', documento))[1]::text)::boolean
      as schedule_correto,
    ((xpath('/table/row/job_ativo/text()', documento))[1]::text)::boolean as job_ativo,
    ((xpath('/table/row/endpoint_correto/text()', documento))[1]::text)::boolean
      as endpoint_correto,
    ((xpath('/table/row/usa_vault_project_url/text()', documento))[1]::text)::boolean
      as usa_vault_project_url,
    ((xpath('/table/row/usa_vault_secret_key/text()', documento))[1]::text)::boolean
      as usa_vault_secret_key,
    ((xpath('/table/row/nao_expoe_secret_literal/text()', documento))[1]::text)::boolean
      as nao_expoe_secret_literal,
    ((xpath('/table/row/sem_job_concorrente/text()', documento))[1]::text)::boolean
      as sem_job_concorrente
  from job_xml
),
execucao_xml as (
  select case
    when cron_job_presente and cron_job_run_details_presente then query_to_xml(
      $consulta$
        select exists (
          select 1
          from cron.job_run_details detalhes
          join cron.job job on job.jobid = detalhes.jobid
          where job.jobname = 'ro-email-notifications-5min'
            and detalhes.status = 'succeeded'
        ) as possui_execucao_automatica
      $consulta$,
      false,
      true,
      ''
    )
    else query_to_xml(
      'select false as possui_execucao_automatica',
      false,
      true,
      ''
    )
  end as documento
  from capacidades
),
execucao_metricas as (
  select
    ((xpath('/table/row/possui_execucao_automatica/text()', documento))[1]::text)::boolean
      as possui_execucao_automatica
  from execucao_xml
),
http_xml as (
  select case
    when net_response_presente then query_to_xml(
      $consulta$
        select coalesce(
          (select status_code = 200
           from net._http_response
           order by created desc
           limit 1),
          false
        ) as ultima_resposta_http_200
      $consulta$,
      false,
      true,
      ''
    )
    else query_to_xml(
      'select false as ultima_resposta_http_200',
      false,
      true,
      ''
    )
  end as documento
  from capacidades
),
http_metricas as (
  select
    ((xpath('/table/row/ultima_resposta_http_200/text()', documento))[1]::text)::boolean
      as ultima_resposta_http_200
  from http_xml
)
select
  j.job_exatamente_um,
  j.schedule_correto,
  j.job_ativo,
  j.endpoint_correto,
  j.usa_vault_project_url,
  j.usa_vault_secret_key,
  j.nao_expoe_secret_literal,
  j.sem_job_concorrente,
  e.possui_execucao_automatica,
  h.ultima_resposta_http_200,
  j.job_exatamente_um
    and j.schedule_correto
    and j.job_ativo
    and j.endpoint_correto
    and j.usa_vault_project_url
    and j.usa_vault_secret_key
    and j.nao_expoe_secret_literal
    and j.sem_job_concorrente
    and e.possui_execucao_automatica
    and h.ultima_resposta_http_200
    as agendamento_valido
from job_metricas j
cross join execucao_metricas e
cross join http_metricas h;

-- Observabilidade opcional: copie e execute separadamente se necessário.
-- Nunca inclua command, headers ou payload nas consultas de observabilidade.
--
-- select d.runid, d.status, d.return_message, d.start_time, d.end_time
-- from cron.job_run_details d
-- join cron.job j on j.jobid = d.jobid
-- where j.jobname = 'ro-email-notifications-5min'
-- order by d.start_time desc
-- limit 20;
--
-- select id, status_code, error_msg, created
-- from net._http_response
-- order by created desc
-- limit 20;
