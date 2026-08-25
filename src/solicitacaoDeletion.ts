type ApprovalStatus = "pendente" | "aprovada" | "reprovada" | "dispensada" | null | undefined;

export function canShowSolicitacaoDeletion(
  canOperateRO: boolean,
  approvalStatus: ApprovalStatus,
  excluidaEm?: string | null,
) {
  return canOperateRO
    && !excluidaEm
    && approvalStatus !== "pendente";
}

export function normalizeDeletionReason(reason: string) {
  return reason.trim().replace(/\s+/g, " ");
}

export function deletionErrorMessage(message: string) {
  const messages: Array<[string, string]> = [
    ["AUTENTICACAO_OBRIGATORIA", "Sua sessão expirou. Entre novamente para excluir a solicitação."],
    ["APENAS_FUNCIONARIO_RO_PODE_EXCLUIR", "Seu perfil não possui permissão para excluir solicitações."],
    ["MOTIVO_EXCLUSAO_OBRIGATORIO", "Informe o motivo da exclusão."],
    ["MOTIVO_EXCLUSAO_MAXIMO_500_CARACTERES", "O motivo da exclusão deve ter no máximo 500 caracteres."],
    ["SOLICITACAO_NAO_ENCONTRADA_OU_JA_EXCLUIDA", "A solicitação não foi encontrada ou já foi excluída."],
  ];
  return messages.find(([code]) => message.includes(code))?.[1]
    || "Não foi possível excluir a solicitação. Atualize a página e tente novamente.";
}
