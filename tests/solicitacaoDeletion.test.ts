import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { canShowSolicitacaoDeletion, deletionErrorMessage, normalizeDeletionReason } from "../src/solicitacaoDeletion.ts";

const page = fs.readFileSync("src/pages.tsx", "utf8");

test("reprovada mostra exclusão somente para RO operacional autorizado", () => {
  assert.equal(canShowSolicitacaoDeletion(true, "reprovada", null), true);
  assert.equal(canShowSolicitacaoDeletion(false, "reprovada", null), false);
});

test("solicitante, aprovador e outro coordenador sem ro_can_operate não veem exclusão", () => {
  for (const approvalStatus of ["reprovada", "aprovada", "dispensada"] as const) {
    assert.equal(canShowSolicitacaoDeletion(false, approvalStatus, null), false);
  }
  assert.match(page, /canShowSolicitacaoDeletion\(access\.canOperateRO, row\.aprovacao_status, row\.excluida_em\)/);
});

test("motivo vazio é bloqueado e motivo válido é normalizado", () => {
  assert.equal(normalizeDeletionReason("   "), "");
  assert.equal(normalizeDeletionReason("  registro   de teste  "), "registro de teste");
  assert.match(page, /if\(!motivoNormalizado\)\{setErro\("Informe o motivo da exclusão\."\);return;\}/);
});

test("exclusão chama exclusivamente a RPC canônica sem update ou delete físico", () => {
  assert.match(page, /supabase\.rpc\("ro_excluir_solicitacao",\{p_solicitacao_id:row\.id,p_motivo:motivoNormalizado\}\)/);
  const component = page.slice(page.indexOf("function ExcluirSolicitacao"), page.indexOf("function DT("));
  assert.doesNotMatch(component, /\.from\(|\.update\(|\.delete\(/);
});

test("sucesso sai da listagem ativa e erros técnicos recebem mensagem amigável", () => {
  assert.match(page, /nav\("\/solicitacoes\?excluidas=true"\)/);
  assert.equal(deletionErrorMessage("MOTIVO_EXCLUSAO_OBRIGATORIO"), "Informe o motivo da exclusão.");
  assert.equal(deletionErrorMessage("erro interno inesperado"), "Não foi possível excluir a solicitação. Atualize a página e tente novamente.");
});

test("ações operacionais continuam bloqueadas e aprovadas ou dispensadas preservam exclusão existente", () => {
  assert.match(page, /!operacaoLiberada && \(access\.canOperateRO \|\| access\.isDenise\) && <AcoesOperacionaisBloqueadas/);
  assert.equal(canShowSolicitacaoDeletion(true, "aprovada", null), true);
  assert.equal(canShowSolicitacaoDeletion(true, "dispensada", null), true);
  assert.equal(canShowSolicitacaoDeletion(true, "pendente", null), false);
  assert.equal(canShowSolicitacaoDeletion(true, "reprovada", "2026-08-25T12:00:00Z"), false);
});

test("diálogo administrativo apresenta confirmação, motivo obrigatório e cancelamento", () => {
  assert.match(page, /<h2>Ações administrativas<\/h2>/);
  assert.match(page, /Esta ação removerá a solicitação das listagens operacionais, mas manterá o histórico e os registros vinculados\./);
  assert.match(page, /Motivo da exclusão<textarea/);
  assert.match(page, />Cancelar<\/button>/);
});
