import test from "node:test";
import assert from "node:assert/strict";
import { extractTicketDataFromText } from "../src/pdfPassagemHeuristics.ts";
import { extractPassagemSignature, groupPdfDocumentsByPassagem } from "../src/passagemGrouping.ts";
import { buildPurchaseCosts } from "../src/purchaseCosts.ts";

const cases = [
  { locator: "IN95VG", ticket: "5770009771500", date: "02/10/2026", origin: "Cuiabá", destination: "Manaus", tariff: "1.223,04", taxes: "48,75", total: "1.301,79", subtotal: "1.271,79", amount: 1301.79 },
  { locator: "VMGPFJ", ticket: "5770009771544", date: "11/10/2026", origin: "Manaus", destination: "Cuiabá", tariff: "1.289,01", taxes: "55,17", total: "1.374,18", subtotal: "1.344,18", amount: 1374.18 },
] as const;

function etourText(item: typeof cases[number]) {
  return [
    "Passageiro: PESSOA EXEMPLO",
    `Localizador da Reserva ${item.locator}`,
    `Bilhete: ${item.ticket}`,
    `Data: ${item.date}`,
    `Origem: ${item.origin} Destino: ${item.destination}`,
    `Voo ${item.locator} ${item.origin} ${item.destination}`,
    `Voo ${item.locator} conexão`,
    "Tarifamento",
    "Tarifa Taxas RAV Fee Total",
    `R$ ${item.tariff} R$ ${item.taxes} R$ 30,00 -- R$ ${item.total}`,
    `Pagamento Consolidador R$ ${item.subtotal} Faturado R$ 30,00`,
  ].join("\n");
}

test("E TOUR: reservas independentes preservam localizadores e Total do Tarifamento até o payload", () => {
  const documents = cases.map((item, index) => {
    const name = `reserva_${item.locator}.pdf`;
    const parsed = extractTicketDataFromText(etourText(item), name);
    assert.equal(parsed.localizador, item.locator);
    assert.notEqual(parsed.localizador?.toUpperCase(), "RESERVA");
    assert.equal(parsed.numero_bilhete, item.ticket);
    assert.equal(parsed.valor_passagem, item.amount.toFixed(2));
    assert.equal(parsed.partida_em, `2026-10-${index ? "11" : "02"}T00:00`);
    assert.equal(extractPassagemSignature({ id: name, nome_arquivo: name, valor: parsed.valor_passagem || "", ...parsed }), `LOC:${item.locator}`);
    return { id: name, nome_arquivo: name, valor: parsed.valor_passagem || "", ...parsed };
  });
  const groups = groupPdfDocumentsByPassagem(documents);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.key), ["LOC:IN95VG", "LOC:VMGPFJ"]);
  const costs = buildPurchaseCosts("solicitacao", documents, { uber: "", refeicao: "", outros: "" }, "cc");
  assert.deepEqual(costs.map(({ tipo, valor, compra_chave }) => ({ tipo, valor, compra_chave })), [
    { tipo: "passagem", valor: 1301.79, compra_chave: "LOC:IN95VG" },
    { tipo: "passagem", valor: 1374.18, compra_chave: "LOC:VMGPFJ" },
  ]);
});

test("rótulos, repetição e fallback de arquivo sem sobrescrever conteúdo válido", () => {
  for (const label of ["Localizador da Reserva", "Localizador de Reserva", "Localizador", "Código de reserva", "Reserva"]) {
    assert.equal(extractTicketDataFromText(`${label}: IN95VG`, "outro.pdf").localizador, "IN95VG");
  }
  assert.equal(extractTicketDataFromText("Localizador da Reserva VMGPFJ Localizador: VMGPFJ", "reserva_IN95VG.pdf").localizador, "VMGPFJ");
  assert.equal(extractTicketDataFromText("Localizador: Reserva", "outro.pdf").localizador, undefined);
  assert.equal(extractTicketDataFromText("Localizador da Reserva", "reserva_IN95VG.pdf").localizador, "IN95VG");
  assert.equal(extractTicketDataFromText("Localizador da Reserva", "arquivo-IN95VG.pdf").localizador, undefined);
});

test("voucher e bilhete da mesma reserva mantêm custo único; sem localizador usa bilhete", () => {
  const voucher = extractTicketDataFromText("Passageiro: PESSOA EXEMPLO Localizador da Reserva IN95VG Valor Total R$ 1.301,79", "voucher.pdf");
  const ticket = extractTicketDataFromText("Passageiro: PESSOA EXEMPLO Localizador: IN95VG Bilhete: 5770009771500 Tarifa R$ 1.000,00 Valor a pagar R$ 900,00", "bilhete.pdf");
  const documents = [
    { id: "voucher", nome_arquivo: "voucher.pdf", valor: voucher.valor_passagem || "", ...voucher },
    { id: "ticket", nome_arquivo: "bilhete.pdf", valor: ticket.valor_passagem || "", ...ticket },
  ];
  assert.equal(groupPdfDocumentsByPassagem(documents).length, 1);
  assert.deepEqual(buildPurchaseCosts("s", documents, { uber: "", refeicao: "", outros: "" }, "cc").map((cost) => [cost.compra_chave, cost.valor]), [["LOC:IN95VG", 1301.79]]);
  const ticketOnly = extractTicketDataFromText("Bilhete: 5770009771544 Tarifa R$ 50,00 Valor a pagar R$ 50,00", "outro.pdf");
  assert.equal(ticketOnly.localizador, undefined);
  assert.equal(extractPassagemSignature({ id: "other", nome_arquivo: "outro.pdf", valor: "50.00", ...ticketOnly }), "BIL:5770009771544");
});
