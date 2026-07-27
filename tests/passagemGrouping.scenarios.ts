import { groupPdfDocumentsByPassagem } from "../src/passagemGrouping";
import { extractTicketDataFromText } from "../src/pdfPassagemHeuristics";
import { buildPurchaseCosts } from "../src/purchaseCosts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const base = {
  partida_em: "2026-07-28T12:00",
  origem: "São Carlos/SP",
  destino: "Ribeirão Preto/SP",
  poltrona: "17",
  localizador: "010331153048",
};

function complementaryPair(
  passenger: string,
  voucherValue: number,
  ticketValue: number,
) {
  return [
    {
      ...base,
      id: `${passenger}-voucher`,
      nome_arquivo: `VOUCHER - ${passenger}.pdf`,
      passageiro: passenger,
      valor: voucherValue,
      tipo_documento: "voucher" as const,
    },
    {
      ...base,
      id: `${passenger}-ticket`,
      nome_arquivo: `BILHETE - ${passenger}.pdf`,
      passageiro: passenger,
      valor: ticketValue,
      tipo_documento: "bilhete_embarque" as const,
    },
  ];
}

for (const [passenger, voucherValue, ticketValue] of [
  ["MARCOS ANTONIO BRASILINO", 71.95, 52.1],
  ["JOSÉ DA SILVA BARBOSA", 84.93, 70],
  ["THIAGO DA ROCHA DURATE", 125.26, 110],
] as const) {
  const groups = groupPdfDocumentsByPassagem(
    complementaryPair(passenger, voucherValue, ticketValue),
  );
  assert(groups.length === 1, `${passenger}: deveria formar um grupo`);
  assert(groups[0].documents.length === 2, `${passenger}: deveria manter 2 PDFs`);
  assert(groups[0].value === voucherValue, `${passenger}: deveria usar voucher`);
  assert(!groups[0].conflictingValues, `${passenger}: não deveria bloquear`);
  assert(groups[0].valueHierarchyNotice, `${passenger}: deveria informar tarifa`);
}

const divergentVouchers = groupPdfDocumentsByPassagem([
  ...complementaryPair("MARIA TESTE", 80, 60).slice(0, 1),
  {
    ...complementaryPair("MARIA TESTE", 90, 60)[0],
    id: "voucher-2",
    valor: 90,
  },
])[0];
assert(divergentVouchers.conflictingValues, "dois vouchers divergentes devem bloquear");

const equalPair = groupPdfDocumentsByPassagem(
  complementaryPair("VALORES IGUAIS", 50, 50),
)[0];
assert(equalPair.value === 50 && !equalPair.conflictingValues, "valor igual deve ser único");

const officialOnly = groupPdfDocumentsByPassagem([
  complementaryPair("SÓ BILHETE", 70, 52.1)[1],
])[0];
assert(
  officialOnly.value === 52.1 && officialOnly.valueSource === "bilhete_oficial",
  "bilhete oficial sozinho deve fornecer o custo",
);

const noValue = groupPdfDocumentsByPassagem([
  {
    ...complementaryPair("SEM VALOR", 70, 0)[1],
    valor: "",
  },
])[0];
assert(noValue.value === 0 && noValue.needsReview, "bilhete sem valor não deve inventar custo");

const differentTrips = groupPdfDocumentsByPassagem([
  ...complementaryPair("PASSAGEIRO TESTE", 70, 60).slice(0, 1),
  {
    ...complementaryPair("PASSAGEIRO TESTE", 70, 60)[1],
    id: "other-trip",
    localizador: "OUTRO-LOCALIZADOR",
    partida_em: "2026-07-28T15:00",
    poltrona: "18",
  },
]);
assert(differentTrips.length === 2, "passagens incompatíveis devem permanecer separadas");

const official = extractTicketDataFromText(
  "Documento Auxiliar do Bilhete de Passagem Eletrônico BP-e Valor a Pagar R$ 52,10 Forma Pagamento Poltrona 17",
  "BILHETE PIRACICABANA.pdf",
);
assert(official.tipo_documento === "bilhete_embarque", "BP-e deve ser bilhete oficial");

const voucher = extractTicketDataFromText(
  "Pedido concluído Detalhes do pagamento Valor Total R$ 71,95 Localizador 010331153048",
  "VOUCHER RODOVIARIO.pdf",
);
assert(voucher.tipo_documento === "voucher", "comprovante da plataforma deve ser voucher");

const marcosCosts = buildPurchaseCosts(
  "solicitacao-marcos",
  complementaryPair("MARCOS ANTONIO BRASILINO", 71.95, 52.1),
  { uber: "", refeicao: "", outros: "" },
  "centro-custo",
);
assert(
  marcosCosts.length === 1 && marcosCosts[0].valor === 71.95,
  "Marcos deve gerar um único custo financeiro de R$ 71,95",
);

console.log("Cenários de hierarquia de valores aprovados.");
