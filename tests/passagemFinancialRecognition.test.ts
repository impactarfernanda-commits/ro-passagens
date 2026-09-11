import test from "node:test";
import assert from "node:assert/strict";
import { extractTicketDataFromText } from "../src/pdfPassagemHeuristics.ts";
import { groupPdfDocumentsByPassagem } from "../src/passagemGrouping.ts";
import { buildPurchaseCosts, totalTicketValues } from "../src/purchaseCosts.ts";

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

test("eticket tabular localiza Total semanticamente em quantidade variável de colunas", () => {
  for (const [text, expected] of [
    ["Tarifamento\nTarifa Taxas Total\nR$ 739,72 R$ 580,00 R$ 1.319,72", "1319.72"],
    ["Tarifamento Tarifa Taxas RAV Total 1.000,00 20,00 30,00 1.050,00", "1050.00"],
    ["Tarifamento\nTarifa Taxas RAV Fee Total\nR$ 2.994,97 R$ 55,17 R$ 30,00 -- R$ 3.080,14", "3080.14"],
    ["Tarifamento\tTarifa\tTaxas\tRAV\tFee\tTotal\t2.994,97\t55,17\t30,00\t--\t3.080,14", "3080.14"],
  ] as const) {
    const result = extractTicketDataFromText(text, "eticket-sanitizado.pdf");
    assert.equal(result.valor_passagem, expected);
  }
});

test("fixture GOL preserva Fee vazio e usa Total do Tarifamento", () => {
  const result = extractTicketDataFromText(
    [
      "Tarifamento",
      "Tarifa Taxas RAV Fee Total",
      "R$ 2.994,97 R$ 55,17 R$ 30,00 -- R$ 3.080,14",
      "Pagamento Faturado: Tarifa 2.994,97 Taxas 55,17 Total 3.050,14",
      "RAV 30,00 Total 30,00",
    ].join("\n"),
    "eticket-gol-sanitizado.pdf",
  );
  assert.equal(result.valor_passagem, "3080.14");
  assert.notEqual(result.valor_passagem, "2994.97");
});

test("tabela financeira incompleta falha fechado", () => {
  const result = extractTicketDataFromText(
    "Tarifamento Tarifa Taxas Total R$ 739,72 R$ 580,00",
    "eticket-incompleto.pdf",
  );
  assert.equal(result.valor_passagem, undefined);
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

test("fixture da tela associa localizador solto do BP-e ao voucher", () => {
  const rawBpe = [
    "PASSAGEIRO DOCUMENTO AUXILIAR DO BILHETE DE PASSAGEM ELETRONICO",
    "DOCUMENTO 712588 DESTINO PARTIDA LINHA TIPO DE VIAGEM HORARIO ORDINARIO",
    "KAIQUE VINICIUS CAVALCANTE DOS SANTOS SALVADOR PETROLANDIA",
    "22/08/2026 13:30 POLTRONA 1 1NRM0Q",
    "TARIFA R$ 274,00 TAXA DE EMBARQUE R$ 9,08 VALOR TOTAL R$ 283,08",
    "DESCONTO R$ 173,78 VALOR A PAGAR R$ 109,30 VALOR PAGO R$ 109,30",
  ].join(" ");
  const bpe = extractTicketDataFromText(
    rawBpe,
    "BILHETE GUANABARA KAIQUE SALVADOR_PETROLANDIA.pdf",
  );
  const voucher = extractTicketDataFromText(
    "Pedido concluído Passageiro KAIQUE VINICIUS CAVALCANTE DOS SANTOS Localizador 1NRM0Q Data 22/08/2026 Partida 13:30 Valor Total R$ 164,67",
    "VOUCHER KAIQUE SALVADOR_PETROLANDIA.pdf",
  );
  assert.equal(bpe.valor_passagem, "109.30");
  assert.equal(bpe.localizador, undefined);
  assert.ok(bpe.identificadores_texto?.includes("1NRM0Q"));
  assert.notEqual(bpe.passageiro, "DOCUMENTO AUXILIAR DO");
  assert.notEqual(bpe.origem, "DESTINO");
  assert.notEqual(bpe.destino, "PARTIDA LINHA TIPO DE VIAGEM");

  const documents = [
    { id: "bpe-real", nome_arquivo: "bpe.pdf", valor: bpe.valor_passagem || "", tipo_documento: bpe.tipo_documento, partida_em: bpe.partida_em, passageiro: bpe.passageiro, origem: bpe.origem, destino: bpe.destino, poltrona: bpe.poltrona, localizador: bpe.localizador, numero_bilhete: bpe.numero_bilhete, identificadores_texto: bpe.identificadores_texto },
    { id: "voucher-real", nome_arquivo: "voucher.pdf", valor: voucher.valor_passagem || "", tipo_documento: voucher.tipo_documento, partida_em: voucher.partida_em, passageiro: voucher.passageiro, localizador: voucher.localizador, identificadores_texto: voucher.identificadores_texto },
  ];
  const groups = groupPdfDocumentsByPassagem(documents);
  const costs = buildPurchaseCosts("e3fbe4f0-815a-42da-b4fc-3c53c2f885cc", documents, { uber: "", refeicao: "", outros: "" }, "centro-custo");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].documents.length, 2);
  assert.equal(groups[0].key, "LOC:1NRM0Q");
  assert.equal(groups[0].value, 164.67);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].valor, 164.67);
  assert.notEqual(totalTicketValues(documents), 273.97);
});
