import type { Solicitacao } from "./types";

export type ApprovalStatus = NonNullable<Solicitacao["aprovacao_status"]>;
export type ApprovalFilter = "" | ApprovalStatus;

export const approvalStatusLabels: Record<ApprovalStatus, string> = {
  pendente: "Pendente",
  aprovada: "Aprovada",
  reprovada: "Reprovada",
  dispensada: "Dispensada",
};

export function normalizedApprovalStatus(
  status: Solicitacao["aprovacao_status"],
): ApprovalStatus {
  // Registros anteriores ao Pacote 1 não têm aprovação e equivalem ao fluxo dispensado.
  return status ?? "dispensada";
}

export function approvalStatusLabel(status: Solicitacao["aprovacao_status"]) {
  return approvalStatusLabels[normalizedApprovalStatus(status)];
}

export function approvalBadgePresentation(
  requestStatus: Solicitacao["status"],
  approvalStatus: Solicitacao["aprovacao_status"],
) {
  if (requestStatus === "recusada" && approvalStatus !== "reprovada") {
    return {
      className: "approval-recusada-ro",
      label: "Interrompida por recusa RO",
    };
  }
  if (requestStatus === "solicitada" && approvalStatus === "pendente") {
    return { className: "approval-pendente", label: "Aguardando aprovação" };
  }
  if (approvalStatus === "reprovada") {
    return { className: "approval-reprovada", label: "Reprovada pelo aprovador" };
  }
  return {
    className: `approval-${approvalStatus || "dispensada"}`,
    label: approvalStatusLabel(approvalStatus),
  };
}

export function matchesApprovalFilter(
  status: Solicitacao["aprovacao_status"],
  filter: ApprovalFilter,
) {
  return !filter || normalizedApprovalStatus(status) === filter;
}

export function approvalWaitingLabel(createdAt: string, now = Date.now()) {
  const elapsedMs = Math.max(0, now - new Date(createdAt).getTime());
  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 24) return `Pendente há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Pendente há ${days} ${days === 1 ? "dia" : "dias"}`;
}

export function isApprovalOperationallyReleased(
  status: Solicitacao["aprovacao_status"],
) {
  return !status || status === "aprovada" || status === "dispensada";
}
