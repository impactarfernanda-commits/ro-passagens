export const HOSPEDAGEM_ATTACHMENT_TYPE = "hospedagem_pdf" as const;

export function justificativaHospedagemValida(value: string) {
  return value.trim().length >= 10;
}

export function parseHospedagemValor(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isHospedagemAttachment(tipo: string) {
  return tipo === HOSPEDAGEM_ATTACHMENT_TYPE;
}
