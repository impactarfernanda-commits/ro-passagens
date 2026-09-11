import type { Status } from "./types";

export const solicitacaoStatusOptions = [
  { value: "solicitada", label: "Solicitada" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "finalizada", label: "Finalizada" },
  { value: "cancelada", label: "Cancelada" },
  { value: "recusada", label: "Recusada" },
] as const;

export type SolicitacaoStatusFilter = (typeof solicitacaoStatusOptions)[number]["value"];
export const todosStatusSolicitacao = solicitacaoStatusOptions.map(({ value }) => value);

export function statusPertenceAoFiltro(status: Status, selecionados: readonly SolicitacaoStatusFilter[]) {
  if (selecionados.length === solicitacaoStatusOptions.length) return true;
  if (selecionados.includes("em_andamento") && ["em_analise", "em_andamento", "passagem_comprada"].includes(status)) return true;
  return selecionados.includes(status as SolicitacaoStatusFilter);
}

export function resumoStatusSolicitacao(selecionados: readonly SolicitacaoStatusFilter[]) {
  if (selecionados.length === solicitacaoStatusOptions.length) return "Todos os status";
  if (selecionados.length === 0) return "Nenhum status";
  if (selecionados.length === 1) return solicitacaoStatusOptions.find(({ value }) => value === selecionados[0])?.label || "1 status";
  return `${selecionados.length} status`;
}
