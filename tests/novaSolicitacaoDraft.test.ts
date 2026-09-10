import assert from "node:assert/strict";
import test from "node:test";
import { emptyNovaSolicitacaoForm, hasDraftContent, novaSolicitacaoDraftKey, parseDraft, serializeDraft, validateDraftCatalogIds } from "../src/novaSolicitacaoDraft.ts";

const data = () => ({ form: emptyNovaSolicitacaoForm(), solicitarExcecao: false, destinoDiferente: false, justificativaDestino: "" });

test("chave de rascunho é isolada pelo usuário autenticado", () => {
  assert.equal(novaSolicitacaoDraftKey("user-a"), "ro:nova-solicitacao:draft:user-a");
  assert.notEqual(novaSolicitacaoDraftKey("user-a"), novaSolicitacaoDraftKey("user-b"));
});

test("serializa e restaura todos os campos editáveis", () => {
  const draft = data();
  draft.form = { ...draft.form, funcionario_id: "f1", obra_id: "o1", origem: "Belém / PA", destino: "São Luís / MA", motivo: "ferias", data_ida: "2026-09-01", data_retorno: "2026-09-15", observacoes_solicitante: "Janela da manhã" };
  draft.solicitarExcecao = true;
  draft.destinoDiferente = true;
  draft.justificativaDestino = "Destino excepcional autorizado";
  assert.deepEqual(parseDraft(serializeDraft(draft, new Date("2026-08-12T12:00:00Z")), Date.parse("2026-08-13T12:00:00Z"))?.form, draft.form);
});

test("rascunho mantém viagem administrativa", () => {
  const draft = data();
  draft.form.motivo = "viagem_administrativa";
  assert.equal(parseDraft(serializeDraft(draft))?.form.motivo, "viagem_administrativa");
});

test("rascunho legado inequívoco converte nao_se_aplica", () => {
  const raw = JSON.parse(serializeDraft(data())) as { form: Record<string, unknown> };
  raw.form.motivo = "nao_se_aplica";
  assert.equal(parseDraft(JSON.stringify(raw))?.form.motivo, "viagem_administrativa");
});

test("ignora formato incompatível, inválido ou expirado", () => {
  assert.equal(parseDraft("não-json"), null);
  assert.equal(parseDraft(JSON.stringify({ version: 999, updatedAt: new Date().toISOString(), form: {} })), null);
  assert.equal(parseDraft(serializeDraft(data(), new Date("2026-01-01T00:00:00Z")), Date.parse("2026-08-12T00:00:00Z")), null);
});

test("mantém campos válidos e remove somente IDs ausentes dos catálogos", () => {
  const draft = parseDraft(serializeDraft({ ...data(), form: { ...emptyNovaSolicitacaoForm(), funcionario_id: "removido", obra_id: "obra-ok", centro_custo_retorno_id: "removido", origem: "Recife / PE" } }))!;
  const validado = validateDraftCatalogIds(draft, new Set(["outro"]), new Set(["obra-ok"]));
  assert.equal(validado.form.funcionario_id, "");
  assert.equal(validado.form.obra_id, "obra-ok");
  assert.equal(validado.form.centro_custo_retorno_id, "");
  assert.equal(validado.form.origem, "Recife / PE");
});

test("detecta conteúdo inclusive nos campos condicionais", () => {
  assert.equal(hasDraftContent(data()), false);
  assert.equal(hasDraftContent({ ...data(), justificativaDestino: "necessário" }), true);
});

test("versão 2 mantém somente referência e metadados mínimos do documento", () => {
  const draft = { ...data(), privateRef: "ref-opaca", documento: { nome: "termo.pdf", tamanho: 123, mime: "application/pdf", categoria: "termo_justa_causa" } };
  const raw = serializeDraft(draft);
  assert.doesNotMatch(raw, /%PDF|arrayBuffer|conteudo/);
  const restored = parseDraft(raw)!;
  assert.equal(restored.privateRef, "ref-opaca");
  assert.deepEqual(restored.documento, draft.documento);
});

test("rascunho versão 1 continua compatível sem inventar dados privados", () => {
  const legacy = JSON.parse(serializeDraft(data())) as Record<string, unknown>;
  legacy.version = 1;
  delete legacy.privateRef;
  delete legacy.documento;
  const restored = parseDraft(JSON.stringify(legacy))!;
  assert.equal(restored.privateRef, undefined);
  assert.equal(restored.documento, null);
  assert.equal(restored.form.pix_viajante, "");
});
