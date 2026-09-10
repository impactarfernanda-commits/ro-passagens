import test from "node:test";
import assert from "node:assert/strict";
import { extractTicketDataFromText } from "../src/pdfPassagemHeuristics.ts";
import { buildPurchaseCosts } from "../src/purchaseCosts.ts";

test("Subtotal + RAC + Total escolhe o total final", () => {
  const result = extractTicketDataFromText(
    "SubTotal: R$ 1.865,56 RAC: R$ 35,50 Total: R$ 1.901,06",
    "passagem-aerea.pdf",
  );
  assert.equal(result.valor_passagem, "1901.06");
});

test("Subtotal isolado não é classificado como Total", () => {
  const result = extractTicketDataFromText(
    "SubTotal: R$ 1.865,56 RAC: R$ 35,50",
    "passagem-aerea.pdf",
  );
  assert.notEqual(result.valor_passagem, "1865.56");
});

test("PDF sem texto ou sem valor falha fechado", () => {
  for (const text of ["", "Imagem digitalizada sem camada textual"]) {
    const result = extractTicketDataFromText(text, "IDA2.pdf");
    assert.equal(result.valor_passagem, undefined);
    assert.equal(result.tipo_documento, "documento_sem_valor");
  }
  const costs = buildPurchaseCosts("solicitacao", [{
    id: "ida2", nome_arquivo: "IDA2.pdf", valor: "",
    tipo_documento: "documento_sem_valor",
  }], { uber: "", refeicao: "", outros: "" }, "centro-custo");
  assert.equal(costs.length, 0);
});

test("documento financeiro ambíguo exige confirmação manual", () => {
  const ambiguous = {
    id: "ambiguous", nome_arquivo: "documento.pdf", valor: 250,
    tipo_documento: "documento" as const,
  };
  assert.equal(buildPurchaseCosts("s", [ambiguous], { uber: "", refeicao: "", outros: "" }, "cc").length, 0);
  assert.equal(buildPurchaseCosts("s", [{ ...ambiguous, valor_confirmado_manualmente: true }], { uber: "", refeicao: "", outros: "" }, "cc").length, 1);
});

test("voucher de hotel não gera automaticamente custo de passagem", () => {
  const result = extractTicketDataFromText(
    "HOTEL E POUSADA SAO GERONIMO Hospedagem Diárias Valor Total R$ 440,00 Hóspede NATHALIA NUNES DA SILVA",
    "Voucher 11258 HOTEL E POUSADA SAO GERONIMO - NATHALIA NUNES DA SILVA.pdf",
  );
  assert.equal(result.tipo_documento, "hospedagem");
  const costs = buildPurchaseCosts("solicitacao", [{
    id: "hotel", nome_arquivo: "Voucher 11258 HOTEL E POUSADA SAO GERONIMO - NATHALIA NUNES DA SILVA.pdf",
    valor: result.valor_passagem || "", tipo_documento: result.tipo_documento,
  }], { uber: "", refeicao: "", outros: "" }, "centro-custo");
  assert.equal(costs.filter((cost) => cost.tipo === "passagem").length, 0);
});

test("BP-e usa valor a pagar, não tarifa ou total bruto", () => {
  const result = extractTicketDataFromText(
    "BP-e Tarifa: R$ 274,00 Taxa de embarque: R$ 9,08 Valor total: R$ 283,08 Desconto: R$ 173,78 Valor a pagar: R$ 109,30 Valor pago: R$ 109,30",
    "bpe.pdf",
  );
  assert.equal(result.valor_passagem, "109.30");
});

test("Rodon e BP-e da mesma passagem geram um custo canônico", () => {
  const common = {
    partida_em: "2026-08-22T13:30",
    passageiro: "KAIQUE VINICIUS CAVALCANTE DOS SANTOS",
    origem: "Salvador/BA",
    destino: "Petrolândia/PE",
    localizador: "1NRM0Q",
  };
  const costs = buildPurchaseCosts("solicitacao", [
    { ...common, id: "rodon", nome_arquivo: "pedido-463755.pdf", valor: 164.67, tipo_documento: "voucher" },
    { ...common, id: "bpe", nome_arquivo: "bpe.pdf", valor: 109.30, tipo_documento: "bilhete_embarque" },
  ], { uber: "", refeicao: "", outros: "" }, "centro-custo");
  assert.equal(costs.length, 1);
  assert.equal(costs[0].valor, 164.67);
  assert.equal(costs[0].compra_chave, "LOC:1NRM0Q");
  assert.notEqual(costs[0].valor, 273.97);
});

test("fixture histórica exata de Kaique agrupa voucher e BP-e tarifário", () => {
  const voucher = extractTicketDataFromText(
    "Pedido concluído Passageiro KAIQUE VINICIUS CAVALCANTE DOS SANTOS Localizador 1NRM0Q Origem Salvador/BA Destino Petrolândia/PE Data 22/08/2026 Partida 13:30 Valor Total R$ 164,67",
    "VOUCHER SALVADOR_PETROLANDIA.pdf",
  );
  const bpe = extractTicketDataFromText(
    "BP-e Passageiro KAIQUE VINICIUS CAVALCANTE DOS SANTOS Localizador 1NRM0Q Origem Salvador/BA Destino Petrolândia/PE Data 22/08/2026 Partida 13:30 Tarifa R$ 274,00 Taxa de embarque R$ 9,08 Valor total R$ 283,08 Desconto R$ 173,78 Valor a pagar R$ 109,30 Valor pago R$ 109,30",
    "BILHETE GUANABARA SALVADOR_PETROLANDIA.pdf",
  );
  assert.equal(bpe.valor_passagem, "109.30");
  const documents = [
    { id: "voucher", nome_arquivo: "voucher.pdf", valor: voucher.valor_passagem || "", tipo_documento: voucher.tipo_documento, passageiro: voucher.passageiro, localizador: voucher.localizador, origem: voucher.origem, destino: voucher.destino, partida_em: voucher.partida_em },
    { id: "bpe", nome_arquivo: "bpe.pdf", valor: bpe.valor_passagem || "", tipo_documento: bpe.tipo_documento, passageiro: bpe.passageiro, localizador: bpe.localizador, origem: bpe.origem, destino: bpe.destino, partida_em: bpe.partida_em },
  ];
  const costs = buildPurchaseCosts("e3fbe4f0-815a-42da-b4fc-3c53c2f885cc", documents, { uber: "", refeicao: "", outros: "" }, "centro-custo");
  assert.equal(costs.length, 1);
  assert.equal(costs[0].valor, 164.67);
  assert.notEqual(costs[0].valor, 438.67);
});
