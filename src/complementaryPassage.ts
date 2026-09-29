import type { Obra, Solicitacao } from "./types";

export const COMPLEMENTARY_COST_CENTER_REQUIRED =
  "Selecione o centro de custo da passagem complementar.";
export const COMPLEMENTARY_COST_CENTER_UNAVAILABLE =
  "Nenhum centro de custo desta solicitação está disponível para lançamento de passagem complementar.";

type ComplementaryRequestCostCenters = Pick<
  Solicitacao,
  "obra_id" | "centro_custo_destino_id" | "centro_custo_retorno_id"
>;

export function complementaryCostCenters(
  request: ComplementaryRequestCostCenters,
  catalog: Obra[],
) {
  const linkedIds = new Set(
    [
      request.obra_id,
      request.centro_custo_destino_id,
      request.centro_custo_retorno_id,
    ].filter((id): id is string => Boolean(id)),
  );

  const includedIds = new Set<string>();
  return catalog.filter((costCenter) => {
    const eligible =
      linkedIds.has(costCenter.id) &&
      costCenter.visivel_passagens === true &&
      ["comum", "restrito_ro"].includes(costCenter.escopo_passagens || "") &&
      !includedIds.has(costCenter.id);
    if (eligible) includedIds.add(costCenter.id);
    return eligible;
  });
}

export function complementaryCostCenterValidationMessage(
  selectedId: string,
  availableCostCenters: Obra[],
) {
  if (!availableCostCenters.length) return COMPLEMENTARY_COST_CENTER_UNAVAILABLE;
  if (!selectedId || !availableCostCenters.some(({ id }) => id === selectedId))
    return COMPLEMENTARY_COST_CENTER_REQUIRED;
  return null;
}

export function complementaryPassageErrorMessage(message: string) {
  if (message.includes("CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO"))
    return "O centro de custo selecionado não está disponível para esta solicitação.";
  return message;
}
