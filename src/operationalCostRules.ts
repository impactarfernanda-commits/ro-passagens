import type { Custo } from "./types";

export type EditableOperationalCostType = Custo["tipo"];

export const EDITABLE_OPERATIONAL_COST_TYPES: readonly EditableOperationalCostType[] = [
  "hospedagem",
  "uber",
  "refeicao",
  "outros",
];

export const DENISE_EMAIL = "denise.pires@tanksbr.com.br";

export function isPassageCost(tipo: Custo["tipo"]) {
  return tipo === "passagem";
}

export function isEditableOperationalCost(tipo: Custo["tipo"]): tipo is EditableOperationalCostType {
  return EDITABLE_OPERATIONAL_COST_TYPES.includes(tipo as EditableOperationalCostType);
}

export function parseOperationalCostValue(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
