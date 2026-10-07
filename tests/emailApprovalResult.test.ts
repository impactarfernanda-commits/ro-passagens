import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { approvalResultHtml,resolveTravelerName } from "../supabase/functions/_shared/email-outbox.ts";

const migration=fs.readFileSync("supabase/migrations/202610070002_email_resultado_aprovacao.sql","utf8");
const worker=fs.readFileSync("supabase/functions/ro-email-notifications/index.ts","utf8");
const auth=fs.readFileSync("supabase/functions/_shared/service-auth.ts","utf8");
const smtp=fs.readFileSync("supabase/functions/_shared/smtp-email.ts","utf8");
const cron=fs.readFileSync("supabase/migrations/202610070001_agenda_worker_email_passagens.sql","utf8");
const pre=fs.readFileSync("supabase/manual/prevalidar_email_resultado_aprovacao_20261007.sql","utf8");
const dry=fs.readFileSync("supabase/manual/DRY_RUN_202610070002_email_resultado_aprovacao.sql","utf8");
const rollback=fs.readFileSync("supabase/manual/validar_rollback_email_resultado_aprovacao_20261007.sql","utf8");
const post=fs.readFileSync("supabase/manual/validar_email_resultado_aprovacao_pos_instalacao_20261007.sql","utf8");
const normalize=(value:string)=>value.replace(/\r\n/g,"\n").trim();

test("trigger cria somente resultados reais e permanentemente deduplicados",()=>{
  assert.match(migration,/old\.aprovacao_status is distinct from 'pendente'/i);
  assert.match(migration,/new\.aprovacao_status not in \('aprovada','reprovada'\)/i);
  for(const event of ["solicitacao_aprovada","solicitacao_reprovada","aprovacao_pendente"])assert.match(migration,new RegExp(event));
  assert.match(migration,/new\.solicitante_id[\s\S]*v_evento\|\|':'\|\|new\.id::text\|\|':'\|\|new\.solicitante_id::text/i);
  assert.match(migration,/on conflict\(chave_deduplicacao\) do nothing/i);
  assert.doesNotMatch(migration,/ro_recusar_solicitacao|motivo_recusa|cron\.|net\.http|vault\./i);
});

test("aprovação e reprovação usam o solicitante e não duplicam",()=>{
  for(const marker of [
    "aprovacao_outbox_unica_solicitante","aprovacao_repetida_nao_duplica",
    "reprovacao_outbox_unica_solicitante","reprovacao_repetida_nao_duplica",
    "recusa_ro_nao_gera_resultado_aprovador","rh_dispensado_nao_gera_resultado",
  ])assert.match(dry,new RegExp(marker));
  assert.match(dry,/public\.ro_aprovar_solicitacao\(a\.solicitacao_id\)/i);
  assert.match(dry,/public\.ro_reprovar_solicitacao/i);
  assert.match(dry,/public\.ro_recusar_solicitacao/i);
  assert.match(dry,/public\.ro_criar_solicitacao_com_aprovador\(v_payload,'\[\]'::jsonb\)/i);
  assert.match(dry,/v_pix_fixture constant text:='dry-run-pix-nao-real@example\.invalid'/i);
  assert.equal((dry.match(/'pix_viajante',v_pix_fixture/g)??[]).length,2);
  assert.doesNotMatch(dry,/from public\.ro_passagem_solicitacoes s[\s\S]*aprovacao_status='pendente'[\s\S]*limit 3/i);
  assert.match(dry,/cron\/worker em outra sessão não pode enxergá-los/i);
  assert.doesNotMatch(dry,/\bcommit\s*;/i);
  assert.match(dry,/rollback;\s*$/i);
});

test("dry run contém literalmente o corpo da migration",()=>{
  const migrationBody=migration.replace(/^begin;\s*/i,"").replace(/\s*commit;\s*$/i,"");
  const match=dry.match(/-- MIGRATION_202610070002_BEGIN[^\n]*\n([\s\S]*?)-- MIGRATION_202610070002_END/);
  assert.ok(match);
  assert.equal(normalize(match[1]),normalize(migrationBody));
});

test("templates mostram resultado, dados seguros e deep link",()=>{
  const base={requesterName:"Maria <Teste>",traveler:"João",reason:"ferias",origin:"Cuiabá",destination:"Porto Velho",outboundDate:"2026-10-20",link:"https://portal.test/solicitacoes/abc"};
  const approved=approvalResultHtml({...base,result:"aprovada"});
  assert.match(approved,/solicitação de passagem foi aprovada/i);
  assert.match(approved,/Motivo/);assert.match(approved,/ferias/);
  assert.match(approved,/ABRIR SOLICITAÇÃO/);assert.match(approved,/solicitacoes\/abc/);
  assert.match(approved,/Maria &lt;Teste&gt;/);
  const rejected=approvalResultHtml({...base,result:"reprovada"});
  assert.match(rejected,/não foi aprovada/i);
  assert.match(rejected,/Consulte o motivo e os detalhes no Portal de Passagens/);
  assert.doesNotMatch(rejected,/ferias|Motivo/);
  assert.doesNotMatch(approved+rejected,/\bCPF\b|\bRG\b|telefone|endereço/i);
});

test("resolução canônica cobre manual, colaborador histórico e funcionário",()=>{
  assert.equal(resolveTravelerName("Manual","Privado","Funcionário"),"Manual");
  assert.equal(resolveTravelerName(null,"Privado","Funcionário"),"Privado");
  assert.equal(resolveTravelerName(null,null,"Funcionário"),"Funcionário");
  assert.equal(resolveTravelerName(" "," ",undefined),null);
});

test("worker revalida cada evento e preserva infraestrutura existente",()=>{
  for(const event of ["aprovacao_pendente","solicitacao_aprovada","solicitacao_reprovada"])assert.match(worker,new RegExp(event));
  assert.match(worker,/pending\?sol\?\.aprovador_id:sol\?\.solicitante_id/);
  assert.match(worker,/sol\.aprovacao_status!==expectedStatus/);
  assert.match(worker,/approvalPendingHtml/);assert.match(worker,/approvalResultHtml/);
  assert.doesNotMatch(worker,/motivo_reprovacao_aprovador|motivo_recusa|request\.json\(/i);
  for(const invariant of ["nodemailer@7.0.10","ro_claim_email_outbox","ro_finalizar_email_outbox","sendSmtpMail","smtpMessageId"])assert.match(worker+smtp,new RegExp(invariant));
  assert.match(auth,/SUPABASE_SECRET_KEYS/);
  assert.match(cron,/ro-email-notifications-5min/);
});

test("scripts manuais são completos e nunca chamam o worker",()=>{
  for(const script of [pre,dry,rollback,post])assert.doesNotMatch(script,/functions\/v1\/ro-email-notifications|functions\.invoke|net\.http_post/i);
  assert.match(pre,/eventos_novos_ausentes/);
  assert.match(pre,/regexp_replace\(lower\(f\.aprovar\),'\\s\+','','g'\)/);
  assert.match(pre,/status<>''solicitada''/);
  assert.match(pre,/aprovacao_nao_pendente/);
  assert.match(post,/destinatario_solicitante/);
  assert.match(post,/from pg_index i/i);
  assert.match(post,/i\.indisunique[\s\S]*i\.indnkeyatts=1[\s\S]*i\.indkey\[0\]=a\.attnum/i);
  assert.doesNotMatch(post,/conname='ro_email_outbox_chave_deduplicacao_key'/i);
  assert.match(post,/onconflict\(chave_deduplicacao\)donothing/i);
  assert.ok(post.includes("'v_evento||'':''||new.id::text||'':''||new.solicitante_id::text'"));
  assert.match(rollback,/outbox_preservada/);
});
