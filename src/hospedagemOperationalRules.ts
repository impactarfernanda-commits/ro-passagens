export const HOSPEDAGEM_ATTACHMENT_TYPE = "hospedagem_pdf" as const;

export function justificativaHospedagemValida(value: string) {
  return value.trim().length >= 10;
}

export function hospedagemOperacionalPendente(
  necessitaHospedagem: boolean,
  hospedagemUtilizada: boolean | null | undefined,
) {
  return necessitaHospedagem && hospedagemUtilizada == null;
}

type ResolucaoHospedagemLocal = {
  hospedagem_utilizada: boolean | null;
  hospedagem_justificativa: string | null;
  [key: string]: unknown;
};

export function normalizeResolucaoOperacional<T>(
  value: T | readonly T[] | null | undefined,
): T | null {
  return Array.isArray(value) ? value[0] || null : value ?? null;
}

export function aplicarResolucaoHospedagemLocal<T extends ResolucaoHospedagemLocal>(
  resolucao: T | null | undefined,
  hospedagemUtilizada: boolean,
  hospedagemJustificativa: string | null,
): T {
  return {
    ...(resolucao || {}),
    hospedagem_utilizada: hospedagemUtilizada,
    hospedagem_justificativa: hospedagemJustificativa,
  } as T;
}

export function parseHospedagemValor(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isHospedagemAttachment(tipo: string) {
  return tipo === HOSPEDAGEM_ATTACHMENT_TYPE;
}
