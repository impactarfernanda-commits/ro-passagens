import {
  calcularCustosSemDuplicidade,
  type PassagemDocument,
} from "./passagemGrouping";

export type TicketCostInput = PassagemDocument;
export type ManualCostInput = {
  uber: string | number;
  refeicao: string | number;
  outros: string | number;
};

export function buildPurchaseCosts(
  solicitacaoId: string,
  pdfs: TicketCostInput[],
  manual: ManualCostInput,
  centroCustoId: string,
) {
  return [
    ...calcularCustosSemDuplicidade(pdfs)
      .filter((group) => group.value > 0 && !group.conflictingValues)
      .map((group) => ({
        solicitacao_id: solicitacaoId,
        tipo: "passagem" as const,
        descricao: `Passagem agrupada (${group.documents.length} documento(s)): ${group.documents.map((pdf) => pdf.nome_arquivo).join(", ")}`,
        valor: group.value,
        centro_custo_id: centroCustoId,
      })),
    ...(["uber", "refeicao", "outros"] as const)
      .filter((tipo) => Number(manual[tipo]) > 0)
      .map((tipo) => ({
        solicitacao_id: solicitacaoId,
        tipo,
        valor: Number(manual[tipo]),
        centro_custo_id: centroCustoId,
      })),
  ];
}

export function totalTicketValues(pdfs: TicketCostInput[]) {
  return calcularCustosSemDuplicidade(pdfs).reduce(
    (total, group) =>
      total + (group.conflictingValues ? 0 : Number(group.value)),
    0,
  );
}
