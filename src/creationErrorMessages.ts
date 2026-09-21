export type CreationRpcError = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

const FALLBACK = "Não foi possível criar a solicitação. Verifique os dados informados e tente novamente.";

const MESSAGES: Array<[RegExp, string]> = [
  [/JUSTIFICATIVA_EXCECAO_OBRIGATORIA/, "Informe uma justificativa de pelo menos 10 caracteres para usar a exceção de prazo."],
  [/FORA_DO_PRAZO(?::|\b)/, "A data não atende ao prazo mínimo e seu perfil não está autorizado a usar a exceção de prazo."],
  [/APROVADOR_INVALIDO/, "O aprovador selecionado não está mais habilitado. Atualize a página e selecione novamente."],
  [/AUTOAPROVACAO_NAO_PERMITIDA/, "Seu perfil atual não permite aprovar a própria solicitação."],
  [/ENDERECO_RESIDENCIAL_NAO_CADASTRADO/, "O viajante não possui endereço residencial cadastrado pelo RH. Informe um destino excepcional, quando permitido."],
  [/JUSTIFICATIVA_DESTINO_EXCEPCIONAL_OBRIGATORIA/, "Informe uma justificativa de pelo menos 10 caracteres para usar um destino excepcional."],
  [/PIX_VIAJANTE_OBRIGATORIO/, "Informe a chave PIX do viajante."],
  [/(FUNCIONARIO_INDISPONIVEL|FUNCIONARIO INDISPONIVEL PARA ESTE SOLICITANTE)/, "O funcionário selecionado não está mais disponível. Atualize a página e selecione novamente."],
  [/(COLABORADOR_INDISPONIVEL|COLABORADOR INDISPONIVEL PARA ESTE SOLICITANTE|COLABORADOR_INATIVO_OU_INEXISTENTE)/, "O colaborador selecionado não está mais disponível. Atualize a página e selecione novamente."],
  [/(CENTRO DE CUSTO ATUAL E OBRIGATORIO|CENTRO_CUSTO_OBRIGATORIO)/, "Selecione o centro de custo atual."],
  [/(CENTRO DE CUSTO INDISPONIVEL PARA ESTE SOLICITANTE|CENTRO_CUSTO_INDISPONIVEL)/, "O centro de custo selecionado não está mais disponível. Atualize a página e selecione novamente."],
  [/CALENDARIO_INCOMPLETO/, "O calendário de dias não úteis ainda não foi validado."],
  [/MOTIVO_(NAO_PERMITIDO|ADMINISTRATIVO_NAO_PERMITIDO)|MOTIVO.*(CHECK CONSTRAINT|OBRIGAT)/, "Motivo da solicitação inválido. Selecione novamente o motivo da viagem."],
];

function normalize(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    : "";
}

function safeBackendCode(error: CreationRpcError) {
  const candidates = [error.message, error.code];
  for (const candidate of candidates) {
    const normalized = normalize(candidate).trim();
    const match = normalized.match(/^([A-Z][A-Z0-9_]{2,64})(?::|$)/);
    if (match && !/^[0-9A-Z]{5}$/.test(match[1])) return match[1];
  }
  return null;
}

export function creationRequestErrorMessage(error: CreationRpcError | null | undefined) {
  const searchable = [error?.message, error?.code, error?.details, error?.hint]
    .map(normalize)
    .filter(Boolean)
    .join(" ");

  for (const [pattern, message] of MESSAGES) {
    if (pattern.test(searchable)) return message;
  }

  const code = error ? safeBackendCode(error) : null;
  return code ? `${FALLBACK} Código: ${code}` : FALLBACK;
}
