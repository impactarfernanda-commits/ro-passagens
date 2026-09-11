import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const purchaseCosts = readFileSync("src/purchaseCosts.ts", "utf8");
const page = readFileSync("src/pages.tsx", "utf8");
const currentBackend = readFileSync(
  "supabase/migrations/20260814120000_corrige_compra_hospedagem_ro.sql",
  "utf8",
);

test("frontend envia identidade estrutural em cada custo de passagem", () => {
  assert.match(purchaseCosts, /compra_chave:\s*group\.key/);
  assert.match(page, /p_custos:\s*custom|p_custos:\s*custos/);
});

test("valor canônico acompanha somente o documento financeiro do agrupamento", () => {
  assert.match(page, /documento\.id === grupo\.financialDocumentId \? grupo\.value : 0/);
});

test("backend atual mantém lock, recriação atômica e aceita campos JSON adicionais", () => {
  assert.match(currentBackend, /for update/);
  assert.match(currentBackend, /ro_registrar_compra_pre_operacional/);
  assert.doesNotMatch(currentBackend, /compra_chave/);
});
