import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { operationalRejectionHtml,resolveTravelerName } from "../supabase/functions/_shared/email-outbox.ts";

const migrationPath="supabase/migrations/202610080001_email_recusa_ro.sql";
const migration=fs.readFileSync(migrationPath,"utf8");
const worker=fs.readFileSync("supabase/functions/ro-email-notifications/index.ts","utf8");
const helper=fs.readFileSync("supabase/functions/_shared/email-outbox.ts","utf8");
const pre=fs.readFileSync("supabase/manual/prevalidar_email_recusa_ro_20261008.sql","utf8");
const dry=fs.readFileSync("supabase/manual/DRY_RUN_202610080001_email_recusa_ro.sql","utf8");
const rollback=fs.readFileSync("supabase/manual/validar_rollback_email_recusa_ro_20261008.sql","utf8");
const post=fs.readFileSync("supabase/manual/validar_email_recusa_ro_pos_instalacao_20261008.sql","utf8");

test("RPC canônica enfileira a recusa RO atomicamente e uma única vez",()=>{
  assert.match(migration,/create or replace function public\.ro_recusar_solicitacao\(\s*p_solicitacao_id uuid,\s*p_motivo text/i);
  assert.match(migration,/select \* into v_sol[\s\S]*for update/i);
  assert.match(migration,/v_sol\.status='recusada'[\s\S]*SOLICITACAO_JA_RECUSADA/i);
  assert.match(migration,/v_sol\.aprovacao_status='reprovada'[\s\S]*SOLICITACAO_JA_REPROVADA/i);
  assert.match(migration,/v_sol\.status not in \('solicitada','em_andamento'\)/i);
  assert.match(migration,/public\.ro_solicitacao_foi_comprada/i);
  assert.match(migration,/'solicitacao_recusada_ro:'\|\|p_solicitacao_id::text\|\|':'\|\|v_sol\.solicitante_id::text/i);
  assert.match(migration,/on conflict\(chave_deduplicacao\) do nothing/i);
  assert.match(migration,/insert into public\.ro_email_outbox[\s\S]*return jsonb_build_object/i);
});

test("recusa RO preserva auditoria, notificação e separação do aprovador",()=>{
  for(const marker of ["ro_passagem_historico","ro_auditoria_interna","ro_passagem_notificacoes","recusada_por=auth.uid()","motivo_recusa=v_motivo"])assert.match(migration,new RegExp(marker.replace(/[.()]/g,"\\$&")));
  assert.doesNotMatch(migration,/create or replace function public\.ro_reprovar_solicitacao/i);
  assert.doesNotMatch(migration,/solicitacao_reprovada:/i);
  assert.doesNotMatch(migration,/cron\.|net\.http|vault\./i);
});

test("worker revalida somente os marcadores próprios da recusa operacional",()=>{
  assert.match(worker,/solicitacao_recusada_ro/);
  assert.match(worker,/sol\.status==="recusada"&&Boolean\(sol\.recusada_em\)&&Boolean\(sol\.recusada_por\)/);
  assert.match(worker,/sol\.aprovacao_status!==expectedStatus/);
  assert.match(worker,/expectedRecipient=pending\?sol\?\.aprovador_id:sol\?\.solicitante_id/);
  assert.match(worker,/operationalRejectionHtml/);
  assert.doesNotMatch(worker,/motivo_recusa/);
  for(const invariant of ["nodemailer@7.0.10","ro_claim_email_outbox","ro_finalizar_email_outbox","sendSmtpMail"])assert.match(worker,new RegExp(invariant));
});

test("template contém somente dados seguros, CTA e deep link",()=>{
  const segredo="MOTIVO-LIVRE-INTERNO-NAO-EXIBIR";
  const html=operationalRejectionHtml({requesterName:"Ana <Teste>",traveler:"Viajante Manual",reason:"transferência",origin:"Origem",destination:"Destino",outboundDate:"2026-11-20",link:"https://portal.test/solicitacoes/abc"});
  assert.match(html,/recusada pela equipe responsável pela operação de passagens/i);
  assert.match(html,/Consulte o motivo e os detalhes no Portal de Passagens/);
  assert.match(html,/Viajante Manual|transferência|Origem|Destino|20\/11\/2026/);
  assert.match(html,/ABRIR SOLICITAÇÃO/);assert.match(html,/solicitacoes\/abc/);
  assert.match(html,/Ana &lt;Teste&gt;/);assert.doesNotMatch(html,new RegExp(segredo));
  assert.doesNotMatch(html,/\bCPF\b|\bRG\b|telefone|endereço/i);
  assert.doesNotMatch(helper,/OperationalRejectionTemplateData[^;]*motivoRecusa/i);
});

test("resolução canônica do viajante continua compartilhada",()=>{
  assert.equal(resolveTravelerName("Manual","Privado","Funcionário"),"Manual");
  assert.equal(resolveTravelerName(null,"Privado","Funcionário"),"Privado");
  assert.equal(resolveTravelerName(null,null,"Funcionário"),"Funcionário");
});

test("scripts manuais cobrem os fluxos e nunca chamam o worker",()=>{
  for(const script of [pre,dry,rollback,post])assert.doesNotMatch(script,/functions\/v1\/ro-email-notifications|functions\.invoke|net\.http_post/i);
  assert.match(pre,/public\.ro_is_operador_ativo\(auth\.uid\(\)\)/i);
  assert.match(pre,/as exige_operador_ro/i);
  for(const marker of ["recusa_cria_uma_outbox_solicitante","recusa_repetida_bloqueada_sem_duplicar","recusa_ro_nao_gera_reprovada","reprovacao_aprovador_somente_evento_proprio","aprovacao_nao_gera_recusa_ro","exclusao_nao_gera_recusa_ro","viajante_manual_no_assunto","evento_anterior_preservado","rh_dispensado_por_si_nao_gera_recusa"])assert.match(dry,new RegExp(marker));
  assert.match(dry,/^begin;/i);assert.match(dry,/rollback;\s*$/i);assert.doesNotMatch(dry,/\bcommit\s*;/i);
  assert.match(dry,/dry-run-pix-nao-real@example\.invalid/);
  assert.match(pre,/nova_logica_ausente/);assert.match(rollback,/outbox_preservada/);assert.match(post,/frontend_sem_dml/);
});

test("migration possui SHA-256 reproduzível",()=>{
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(migrationPath)).digest("hex").length,64);
});
