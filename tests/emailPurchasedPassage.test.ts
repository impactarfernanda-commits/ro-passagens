import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { purchasedPassageHtml,resolveTravelerName } from "../supabase/functions/_shared/email-outbox.ts";

const migration=fs.readFileSync("supabase/migrations/202610080002_email_passagem_comprada.sql","utf8");
const worker=fs.readFileSync("supabase/functions/ro-email-notifications/index.ts","utf8");
const helper=fs.readFileSync("supabase/functions/_shared/email-outbox.ts","utf8");
const pre=fs.readFileSync("supabase/manual/prevalidar_email_passagem_comprada_20261008.sql","utf8");
const dry=fs.readFileSync("supabase/manual/DRY_RUN_202610080002_email_passagem_comprada.sql","utf8");
const rollback=fs.readFileSync("supabase/manual/validar_rollback_email_passagem_comprada_20261008.sql","utf8");
const post=fs.readFileSync("supabase/manual/validar_email_passagem_comprada_pos_instalacao_20261008.sql","utf8");

test("evento nasce uma vez na transição canônica de compra concluída",()=>{
  assert.match(migration,/after update of status,comprado_em,comprado_por/i);
  assert.match(migration,/old\.status is not distinct from 'passagem_comprada'/i);
  assert.match(migration,/new\.status is distinct from 'passagem_comprada'/i);
  assert.match(migration,/new\.comprado_em is null[\s\S]*new\.comprado_por is null/i);
  assert.match(migration,/new\.excluida_em is not null/i);
  assert.match(migration,/'passagem_comprada:'\|\|new\.id::text\|\|':'\|\|new\.solicitante_id::text/i);
  assert.match(migration,/on conflict\(chave_deduplicacao\) do nothing/i);
});

test("granularidade é por solicitação e fluxos posteriores não disparam",()=>{
  assert.doesNotMatch(migration,/ro_passagem_anexos|ro_passagem_custos|compra_chave|storage_path|nome_arquivo/i);
  assert.doesNotMatch(migration,/ro_registrar_passagem_complementar|ro_registrar_documentos_pos_compra/i);
  assert.match(dry,/pos_compra_canonico_nao_duplica/);
  assert.match(dry,/edicao_custo_operacional_nao_duplica/);
  assert.match(dry,/complementar_canonica_nao_duplica/);
  assert.match(dry,/reprocessamento_nao_duplica/);
});

test("worker revalida compra, exclusão e solicitante",()=>{
  assert.match(worker,/passagem_comprada/);
  assert.match(worker,/\["passagem_comprada","finalizada"\]\.includes\(sol\.status\)/);
  assert.match(worker,/!sol\.comprado_em\|\|!sol\.comprado_por/);
  assert.match(worker,/sol\.excluida_em/);
  assert.match(worker,/expectedRecipient=pending\?sol\?\.aprovador_id:sol\?\.solicitante_id/);
  assert.match(worker,/purchasedPassageHtml/);
  assert.doesNotMatch(worker,/storage_path|passagem_pdf|attachment/i);
});

test("aprovação, reprovação e recusa RO preservam templates próprios",()=>{
  for(const event of ["aprovacao_pendente","solicitacao_aprovada","solicitacao_reprovada","solicitacao_recusada_ro","passagem_comprada"])assert.match(worker,new RegExp(event));
  assert.match(worker,/operationalRejectionHtml/);
  assert.match(worker,/approvalResultHtml/);
  assert.match(worker,/purchasedPassageHtml/);
  assert.doesNotMatch(worker,/motivo_recusa/);
});

test("template usa dados canônicos seguros, sem anexos nem valores",()=>{
  const html=purchasedPassageHtml({requesterName:"Ana <Teste>",traveler:"Viajante Manual",origin:"Origem",destination:"Destino",outboundDate:"2026-11-20",company:"Companhia",locator:"ABC123",link:"https://portal.test/solicitacoes/abc"});
  assert.match(html,/Sua passagem foi comprada/);
  for(const marker of ["Viajante Manual","Origem","Destino","20/11/2026","Companhia","ABC123","ABRIR SOLICITAÇÃO","solicitacoes/abc"])assert.match(html,new RegExp(marker));
  assert.match(html,/Ana &lt;Teste&gt;/);
  assert.doesNotMatch(html,/\bCPF\b|\bRG\b|nascimento|telefone|PIX|endereço|valor|custo|attachment|\.pdf/i);
  assert.doesNotMatch(helper,/PurchasedPassageTemplateData[^;]*(?:cpf|rg|pix|valor|attachment)/i);
});

test("resolução canônica cobre viajante manual e cadastros históricos",()=>{
  assert.equal(resolveTravelerName("Manual","Privado","Funcionário"),"Manual");
  assert.equal(resolveTravelerName(null,"Privado","Funcionário"),"Privado");
  assert.equal(resolveTravelerName(null,null,"Funcionário"),"Funcionário");
});

test("dry run é autossuficiente e cobre separação e rollback",()=>{
  for(const marker of ["compra_real_cria_uma_outbox_solicitante","viajante_manual_no_assunto","exclusao_canonica_nao_gera_compra","recusa_ro_independente_nao_gera_compra","reprovacao_independente_nao_gera_compra","fixture_comprada_permanece_ativa","eventos_anteriores_preservados"])assert.match(dry,new RegExp(marker));
  assert.match(dry,/public\.ro_registrar_compra_v2/i);
  assert.match(dry,/dry-run-pix-nao-real@example\.invalid/i);
  assert.match(dry,/^begin;/i);assert.match(dry,/rollback;\s*$/i);assert.doesNotMatch(dry,/\bcommit\s*;/i);
  for(const script of [pre,dry,rollback,post])assert.doesNotMatch(script,/functions\/v1\/ro-email-notifications|functions\.invoke|net\.http_post/i);
});

test("pre, rollback e pós-validador cobrem o contrato real",()=>{
  assert.match(pre,/ro_registrar_compra_v2/);assert.match(pre,/ro_registrar_compra_pre_operacional/);
  assert.match(pre,/ro_registrar_documentos_pos_compra/);assert.match(pre,/ro_registrar_passagem_complementar/);
  assert.match(rollback,/trigger_compra_revertido/);
  assert.match(post,/somente_transicao_inicial/);assert.match(post,/frontend_sem_dml/);
});
