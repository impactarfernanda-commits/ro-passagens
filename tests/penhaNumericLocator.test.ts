import test from "node:test";
import assert from "node:assert/strict";
import { extractTicketDataFromText } from "../src/pdfPassagemHeuristics.ts";
import {
  extractPassagemSignature,
  groupPdfDocumentsByPassagem,
} from "../src/passagemGrouping.ts";
import { buildPurchaseCosts } from "../src/purchaseCosts.ts";

const passenger = "LARISSA COELHO DA SILVEIRA";
const cases = [
  {
    locator: "010339108487",
    date: "02/10/2026",
    origin: "Matinhos",
    destination: "Florianópolis",
    order: "689348",
    receipt: "21089028",
    ticket: "869855",
    bpe: "5657239",
    voucherValue: "100,37",
    ticketValue: "75,98",
  },
  {
    locator: "010339108664",
    date: "06/10/2026",
    origin: "Florianópolis",
    destination: "Matinhos",
    order: "689351",
    receipt: "21089050",
    ticket: "562968",
    bpe: "495335",
    voucherValue: "183,67",
    ticketValue: "145,98",
  },
] as const;

function documents() {
  return cases.flatMap((item, index) => {
    const voucher = extractTicketDataFromText([
      "Pedido concluído",
      `Pedido ${item.order}`,
      `Passageiro ${passenger}`,
      `Localizador ${item.locator}`,
      `Origem ${item.origin}`,
      `Destino ${item.destination}`,
      `Data ${item.date}`,
      `Valor Total R$ ${item.voucherValue}`,
    ].join("\n"), `voucher-${index + 1}.pdf`);
    const ticket = extractTicketDataFromText([
      "DOCUMENTO AUXILIAR DO BILHETE DE PASSAGEM ELETRONICO",
      `Passageiro ${passenger}`,
      `BP-e ${item.bpe}`,
      `Nº bilhete ${item.ticket}`,
      `Comprovante ${item.receipt}`,
      `Origem ${item.origin}/PR`,
      `Destino ${item.destination}/SC`,
      `Data ${item.date}`,
      item.locator,
      `Valor a pagar R$ ${item.ticketValue}`,
    ].join("\n"), `bpe-${index + 1}.pdf`);
    return [
      {
        id: `voucher-${index + 1}`,
        nome_arquivo: `voucher-${index + 1}.pdf`,
        valor: voucher.valor_passagem || "",
        ...voucher,
      },
      {
        id: `bpe-${index + 1}`,
        nome_arquivo: `bpe-${index + 1}.pdf`,
        valor: ticket.valor_passagem || "",
        ...ticket,
      },
    ];
  });
}

test("Penha/Rodon: localizadores numéricos distinguem ida e volta e consolidam cada compra", () => {
  const parsed = documents();
  assert.deepEqual(
    parsed.map((document) => document.localizador),
    ["010339108487", "010339108487", "010339108664", "010339108664"],
  );
  assert.deepEqual(
    parsed.map(extractPassagemSignature),
    [
      "LOC:010339108487",
      "LOC:010339108487",
      "LOC:010339108664",
      "LOC:010339108664",
    ],
  );

  const groups = groupPdfDocumentsByPassagem(parsed);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.documents.length), [2, 2]);
  assert.deepEqual(groups.map((group) => group.key), [
    "LOC:010339108487",
    "LOC:010339108664",
  ]);
  assert.deepEqual(groups.map((group) => group.value), [100.37, 183.67]);

  const costs = buildPurchaseCosts(
    "solicitacao",
    parsed,
    { uber: "", refeicao: "", outros: "" },
    "centro-custo",
  );
  assert.equal(costs.length, 2);
  assert.equal(new Set(costs.map((cost) => cost.compra_chave)).size, 2);
  assert.equal(
    Number(costs.reduce((total, cost) => total + cost.valor, 0).toFixed(2)),
    284.04,
  );
});
