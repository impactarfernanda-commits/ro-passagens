export function approvalDecisionErrorMessage(message: string) {
  const messages: Array<[string, string]> = [
    ["AUTENTICACAO_OBRIGATORIA", "Sua sessão expirou. Entre novamente para analisar a solicitação."],
    ["MOTIVO_REPROVACAO_MINIMO_10_CARACTERES", "Informe o motivo da reprovação com pelo menos 10 caracteres."],
    ["SOLICITACAO_NAO_ENCONTRADA", "A solicitação não foi encontrada ou não está mais disponível."],
    ["SOLICITACAO_NAO_DESTINADA_A_ESTE_APROVADOR", "Esta solicitação está destinada a outro aprovador."],
    ["APROVADOR_NAO_ELEGIVEL", "Seu perfil não está habilitado para decidir esta solicitação."],
    ["APROVACAO_NAO_PENDENTE", "Esta solicitação já foi analisada ou não está mais pendente."],
    ["RECUSA_SOMENTE_PELA_RPC", "Não foi possível registrar a reprovação. Atualize a página e tente novamente."],
  ];
  return messages.find(([code]) => message.includes(code))?.[1]
    || "Não foi possível concluir a análise da solicitação. Tente novamente.";
}
