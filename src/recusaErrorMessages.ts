type RejectionError = {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

const rejectionMessages: Array<[string, string]> = [
  ["NAO_AUTENTICADO", "Sua sessão expirou. Entre novamente para recusar a solicitação."],
  ["NAO_PERTENCE_EQUIPE_RO", "Somente integrantes ativos da equipe RO podem recusar."],
  ["SOLICITACAO_NAO_ENCONTRADA", "Solicitação não encontrada."],
  ["SOLICITACAO_JA_RECUSADA", "Esta solicitação já foi recusada."],
  ["SOLICITACAO_JA_REPROVADA", "Esta solicitação já foi reprovada pelo aprovador."],
  ["PASSAGEM_JA_COMPRADA", "A passagem já foi comprada e não pode mais ser recusada."],
  ["STATUS_NAO_PERMITE_RECUSA", "O status atual não permite recusa."],
  ["MOTIVO_RECUSA_OBRIGATORIO", "Informe ao menos 10 caracteres úteis."],
  ["SOLICITACAO_AGUARDANDO_APROVACAO", "Não foi possível registrar a recusa enquanto a aprovação está pendente. Atualize a página e tente novamente."],
  ["RECUSA_SOMENTE_PELA_RPC", "Não foi possível registrar a recusa com segurança. Atualize a página e tente novamente."],
];

export function operationalRejectionErrorMessage(error: RejectionError) {
  const diagnosticText = [error.message, error.code, error.details, error.hint].filter(Boolean).join(" ");
  return rejectionMessages.find(([code]) => diagnosticText.includes(code))?.[1]
    || "Não foi possível recusar a solicitação.";
}

export function operationalRejectionErrorDetails(error: RejectionError) {
  return { message: error.message, code: error.code, details: error.details, hint: error.hint };
}
