import type { Obra } from "./types";

export const normalizeCostCenterSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

export function filterCostCenters(options: Obra[], query: string) {
  const normalized = normalizeCostCenterSearch(query);
  if (!normalized) return options;
  return options.filter((option) => normalizeCostCenterSearch(`${option.codigo || ""} ${option.nome || ""} ${option.descricao || ""}`).includes(normalized))
    .sort((a, b) => Number(normalizeCostCenterSearch(a.codigo || "") !== normalized) - Number(normalizeCostCenterSearch(b.codigo || "") !== normalized));
}
