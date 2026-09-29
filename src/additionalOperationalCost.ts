import type { Obra } from "./types";

export const OPERATIONAL_COST_MAX_VALUE = 9_999_999_999.99;

export type AdditionalOperationalCostDraft = {
  centroCustoId: string;
  valor: string;
  descricao: string;
};

export function validateAdditionalOperationalCost(
  draft: AdditionalOperationalCostDraft,
  availableCostCenters: Obra[],
) {
  if (
    !draft.centroCustoId ||
    !availableCostCenters.some(({ id }) => id === draft.centroCustoId)
  )
    return "Selecione um centro de custo disponível para esta solicitação.";

  const normalizedValue = draft.valor.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedValue))
    return "Informe um valor maior que zero, com até duas casas decimais.";
  const value = Number(normalizedValue);
  if (
    !Number.isFinite(value) ||
    value < 0.01 ||
    value > OPERATIONAL_COST_MAX_VALUE
  )
    return "Informe um valor maior que zero dentro do limite financeiro permitido.";

  if (!draft.descricao.trim()) return "Informe a descrição do custo.";
  return null;
}

export function additionalOperationalCostPayload(
  solicitacaoId: string,
  draft: AdditionalOperationalCostDraft,
) {
  return {
    p_solicitacao_id: solicitacaoId,
    p_valor: Number(draft.valor.trim().replace(",", ".")),
    p_descricao: draft.descricao.trim(),
    p_centro_custo_id: draft.centroCustoId,
  };
}
