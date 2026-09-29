import type { Custo } from "./types";

export const VISIBLE_OPERATIONAL_COST_TYPES = ["refeicao", "uber", "outros"] as const;

export type VisibleOperationalCost = Pick<Custo, "id" | "tipo" | "valor" | "descricao">;

export function visibleOperationalCosts(costs: VisibleOperationalCost[]) {
  return costs.filter((cost) =>
    VISIBLE_OPERATIONAL_COST_TYPES.includes(cost.tipo as (typeof VISIBLE_OPERATIONAL_COST_TYPES)[number])
      && Number(cost.valor) > 0,
  );
}

export function visibleOperationalCostsTotal(costs: VisibleOperationalCost[]) {
  return visibleOperationalCosts(costs)
    .reduce((total, cost) => total + Number(cost.valor), 0);
}

export function visibleOperationalCostLabel(tipo: VisibleOperationalCost["tipo"]) {
  return tipo === "refeicao" ? "Refeição" : tipo === "uber" ? "Uber" : "Outros";
}
