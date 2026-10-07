import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const migrationPath="supabase/migrations/202610070001_agenda_worker_email_passagens.sql";
const prePath="supabase/manual/prevalidar_agendamento_email_20261007.sql";
const postPath="supabase/manual/validar_agendamento_email_pos_instalacao_20261007.sql";
const rollbackPath="supabase/manual/rollback_agendamento_email_20261007.sql";
const migration=fs.readFileSync(migrationPath,"utf8");
const pre=fs.readFileSync(prePath,"utf8");
const post=fs.readFileSync(postPath,"utf8");
const rollback=fs.readFileSync(rollbackPath,"utf8");
const withoutComments=(value:string)=>value.replace(/--.*$/gm,"");

test("migration aplicada permanece byte a byte inalterada",()=>{
  assert.equal(
    createHash("sha256").update(migration.replace(/\r\n/g,"\n")).digest("hex"),
    "be810f088f03997a0fdfbc58fd98cd71d1ad5f0a68b4d518e51e7a55f19eb612",
  );
});

test("prevalidador é defensivo e retorna uma linha consolidada",()=>{
  for(const field of [
    "pg_cron_instalado","pg_net_instalado","vault_instalado","cron_job_presente",
    "cron_job_run_details_presente","net_http_post_presente","qtd_project_url",
    "qtd_cron_secret_key","qtd_job_nome_esperado","qtd_jobs_endpoint",
    "qtd_jobs_concorrentes","pronto_para_instalar",
  ])assert.match(pre,new RegExp(`\\b${field}\\b`));
  assert.match(pre,/when cron_job_presente then query_to_xml/i);
  assert.match(pre,/else query_to_xml[\s\S]*0::bigint as qtd_job_nome_esperado/i);
  assert.doesNotMatch(pre,/decrypted_secret/i);
  assert.equal((withoutComments(pre).match(/;/g)||[]).length,1);
});

test("pós-validador consolida configuração, execução e HTTP sem expor dados",()=>{
  for(const field of [
    "job_exatamente_um","schedule_correto","job_ativo","endpoint_correto",
    "usa_vault_project_url","usa_vault_secret_key","nao_expoe_secret_literal",
    "sem_job_concorrente","possui_execucao_automatica","ultima_resposta_http_200",
    "agendamento_valido",
  ])assert.match(post,new RegExp(`\\b${field}\\b`));
  assert.doesNotMatch(post,/decrypted_secret/i);
  assert.doesNotMatch(withoutComments(post),/\b(headers|apikey|payload)\b/i);
  assert.equal((withoutComments(post).match(/;/g)||[]).length,1);
});

test("rollback afeta somente o job esperado",()=>{
  assert.match(rollback,/cron\.unschedule\('ro-email-notifications-5min'\)/i);
  assert.doesNotMatch(rollback,/\b(drop extension|drop schema|delete from vault|truncate)\b/i);
  const jobNames=[...rollback.matchAll(/ro-email-notifications-[a-z0-9-]+/gi)].map(match=>match[0]);
  assert.deepEqual([...new Set(jobNames)],["ro-email-notifications-5min"]);
});
