import assert from "node:assert/strict";
import test from "node:test";
import { buildPurchaseAttachmentInsert } from "../src/purchaseAttachmentPayload.ts";
import { buildPurchaseCosts } from "../src/purchaseCosts.ts";

test("NMZGIE mantém identidade financeira sem enviá-la ao anexo", () => {
  const attachment = buildPurchaseAttachmentInsert("solicitacao", "usuario", {
    nome_arquivo: "reserva_NMZGIE.pdf",
    storage_path: "solicitacao/uuid-reserva_NMZGIE.pdf",
    mime_type: "application/pdf",
    tamanho_bytes: 1234,
    partida_em: null,
    valor: 3080.14,
    observacao: "Grupo 1",
  });
  assert.equal("compra_chave" in attachment, false);

  const costs = buildPurchaseCosts("solicitacao", [{
    id: "pdf-nmzgie",
    nome_arquivo: "reserva_NMZGIE.pdf",
    valor: 3080.14,
    localizador: "NMZGIE",
    tipo_documento: "voucher",
  }], { uber: "", refeicao: "", outros: "" }, "centro-custo");

  assert.equal(costs.length, 1);
  assert.equal(costs[0].tipo, "passagem");
  assert.equal(costs[0].valor, 3080.14);
  assert.equal(costs[0].compra_chave, "LOC:NMZGIE");
});
