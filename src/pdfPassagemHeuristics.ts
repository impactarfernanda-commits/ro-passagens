export type DocumentType =
  | "voucher"
  | "bilhete_embarque"
  | "documento_sem_valor"
  | "documento";

export type PurchaseData = {
  partida_em: string;
  valor_passagem: string;
  passageiro: string;
  documento: string;
  origem: string;
  destino: string;
  poltrona: string;
  localizador: string;
  numero_bilhete: string;
  tipo_documento: DocumentType;
  valores_financeiros_divergentes: boolean;
};

const meses: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

export function normalizePassagemKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function captures(text: string, labels: string[], stopLabels: string[]) {
  const matches = text.matchAll(new RegExp(
    `\\b(?:${labels.join("|")})\\b\\s*[:#-]?\\s*(.{1,140}?)(?=\\s+\\b(?:${stopLabels.join("|")})\\b\\s*[:#-]?|$)`,
    "gi",
  ));
  return [...matches].map((match) => match[1]?.trim() || "").filter(Boolean);
}

function capture(text: string, labels: string[], stops: string[]) {
  return captures(text, labels, stops).at(-1) || "";
}

function parseMoney(value: string) {
  const prepared = value.replace(/R\s*\$/gi, "R$")
    .replace(/(\d)\s*([.,])\s*(\d{2})\b/g, "$1$2$3");
  const token = prepared.match(
    /(?:R\$|BRL)?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/i,
  )?.[1];
  if (!token) return "";
  const normalized = token.includes(",")
    ? token.replace(/\./g, "").replace(",", ".")
    : token;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : "";
}

function parseDateTime(value: string) {
  const clean = normalizePassagemKey(value).toLowerCase();
  const numeric = clean.match(
    /(\d{1,2})[ /.-](\d{1,2})[ /.-](\d{2,4})(?:\D{0,20}(\d{1,2})[ :h](\d{2}))?/i,
  );
  const textual = clean.match(
    /(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?(?:\D{0,20}(\d{1,2})[ :h](\d{2}))?/i,
  );
  const source = numeric ?? textual;
  if (!source) return "";
  const day = Number(source[1]);
  const month = numeric ? Number(source[2]) : meses[source[2]];
  let year = Number(source[3] || new Date().getFullYear());
  if (year < 100) year += 2000;
  const hour = Number(source[4] ?? 0);
  const minute = Number(source[5] ?? 0);
  const validDate = new Date(year, (month || 1) - 1, day);
  if (!month || validDate.getFullYear() !== year ||
      validDate.getMonth() !== month - 1 || validDate.getDate() !== day ||
      hour > 23 || minute > 59) return "";
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

const invalidPassengerTerms =
  /\b(?:JA TENHA IMPRESSO|BILHETE ELETRONICO|RETIRADA GUICHE|ORIENTACOES GERAIS|CANCELAMENTOS?|ALTERACOES|APRESENTE SEU DOCUMENTO|TUDO CERTO|DETALHES DAS PASSAGENS|NOME DO PASSAGEIRO|SEU PEDIDO|DOCUMENTO DE IDENTIFICACAO)\b/i;

function passengerCandidate(value: string) {
  const candidate = value.replace(/\s+/g, " ")
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "").trim();
  const normalized = normalizePassagemKey(candidate);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 7 ||
      invalidPassengerTerms.test(normalized) ||
      (normalized.match(/\d/g)?.length || 0) > 1 ||
      words.some((word) => word.length === 1 && word !== "E")) return "";
  return candidate;
}

function extractPassenger(text: string, stops: string[]) {
  return captures(text, ["Nome\\s+do\\s+Passageiro", "Passageiro"], stops)
    .map(passengerCandidate).filter(Boolean)
    .sort((left, right) =>
      normalizePassagemKey(right).split(" ").length -
      normalizePassagemKey(left).split(" ").length)[0] || "";
}

function extractFinancialValues(text: string, stops: string[]) {
  const labelled = captures(text, [
    "Valor\\s+Total", "Valor\\s+por\\s+poltrona",
    "Valor\\s+da\\s+passagem", "Total\\s+pago", "Total", "Tarifa",
  ], stops).map(parseMoney).filter(Boolean).map(Number);
  const currency = [...text.matchAll(/R\s*\$\s*\d[\d.\s]*[.,]\s*\d{2}/gi)]
    .map((match) => parseMoney(match[0])).filter(Boolean).map(Number);
  const candidates = labelled.length ? labelled : currency;
  const unique = [...new Set(candidates.map((value) => value.toFixed(2)))].map(Number);
  return {
    value: unique.length ? Math.max(...unique).toFixed(2) : "",
    divergent: unique.length > 1,
  };
}

function formatRoutePlace(value: string) {
  const clean = normalizePassagemKey(value)
    .replace(/\bSAO LUIZ\b/g, "SAO LUIS")
    .replace(/\s+/g, " ")
    .trim();
  const match = clean.match(/^(.+?)\s+([A-Z]{2})$/);
  return match ? `${match[1]}/${match[2]}` : clean;
}

function extractRouteFromFilename(fileName: string, passenger: string) {
  const marked = fileName
    .replace(/\.pdf$/i, "")
    .replace(/\s+(?:-|→)\s+/g, " ROUTESEP ")
    .replace(/_/g, " ROUTESEP ");
  let clean = normalizePassagemKey(marked)
    .replace(/\bLOC\s+[A-Z0-9-]+\b.*$/g, "")
    .replace(/\b(?:BILHETE DE EMBARQUE|BILHETE|VOUCHER)\b/g, " ")
    .replace(/\bVIACAO\b/g, " ")
    .replace(/\b(?:GUANABARA|EXPRESSO GUANABARA)\b/g, " ");
  const normalizedPassenger = normalizePassagemKey(passenger);
  if (normalizedPassenger) clean = clean.replace(normalizedPassenger, " ");
  const parts = clean.split(/\bROUTESEP\b/).map((part) =>
    part.replace(/\s+/g, " ").trim(),
  );
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return { origem: "", destino: "" };
  return {
    origem: formatRoutePlace(parts[0]),
    destino: formatRoutePlace(parts[1]),
  };
}

export function extractTicketDataFromText(
  rawText: string,
  fileName = "",
): Partial<PurchaseData> {
  try {
    const text = rawText.replace(/\s+/g, " ").trim();
    const stops = [
      "Nome\\s+do\\s+Passageiro", "Passageiro", "Nome", "Documento", "CPF",
      "Seguro", "Localizador", "Comprovante", "Classe", "Poltrona", "Assento",
      "Via[cç][aã]o", "Origem", "Destino", "Trecho", "Embarque", "Sa[ií]da",
      "Partida", "Data", "Hora", "Bilhete", "Valor\\s+Total",
      "Valor\\s+por\\s+poltrona", "Valor\\s+da\\s+passagem", "Total\\s+pago",
      "Total", "Valor", "Tarifa",
    ];
    const labelled = (labels: string[]) => capture(text, labels, stops);
    const partida = parseDateTime(labelled([
      "Data\\s+e\\s+hora\\s+de\\s+sa[ií]da", "Data\\s+de\\s+partida",
      "Embarque", "Sa[ií]da", "Partida", "Data",
    ])) || parseDateTime(text);
    const financial = extractFinancialValues(text, stops);
    const passageiro = extractPassenger(text, stops);
    const documento = labelled(["Documento", "CPF"]).replace(/\D/g, "");
    const fileRoute = extractRouteFromFilename(fileName, passageiro);
    const origemTextual = labelled([
      "Origem(?:\\s*-\\s*endere[cç]o)?", "Embarque\\s+em",
    ]);
    const destinoTextual = labelled([
      "Destino(?:\\s*-\\s*endere[cç]o)?", "Desembarque\\s+em",
    ]);
    const origem = origemTextual
      ? formatRoutePlace(origemTextual)
      : fileRoute.origem;
    const destino = destinoTextual
      ? formatRoutePlace(destinoTextual)
      : fileRoute.destino;
    const poltrona = captures(text, ["Poltrona", "Assento"], stops)
      .map((value) => value.match(/\b\d{1,3}[A-Z]?\b/i)?.[0] || "")
      .find(Boolean) || "";
    const localizador = labelled([
      "Localizador", "C[oó]digo\\s+de\\s+reserva", "Reserva",
    ]).match(/[A-Z0-9-]{4,}/i)?.[0] || "";
    const numeroBilheteCandidate = labelled([
      "N[uú]mero\\s+do\\s+comprovante", "Comprovante",
      "N[uú]mero\\s+do\\s+bilhete", "Bilhete",
    ]).match(/[A-Z0-9-]{5,}/i)?.[0] || "";
    const numeroBilhete = /\d/.test(numeroBilheteCandidate)
      ? numeroBilheteCandidate
      : "";
    const hasBoardingTerms = /\b(QR|embarque|poltrona|assento)\b/i.test(text);
    const tipoDocumento: DocumentType =
      financial.value || localizador || numeroBilhete ? "voucher" :
      hasBoardingTerms ? "bilhete_embarque" : "documento_sem_valor";
    return {
      ...(partida && { partida_em: partida }),
      ...(financial.value && { valor_passagem: financial.value }),
      ...(passageiro && { passageiro }),
      ...(documento && { documento }),
      ...(origem && { origem }),
      ...(destino && { destino }),
      ...(poltrona && { poltrona }),
      ...(localizador && { localizador }),
      ...(numeroBilhete && { numero_bilhete: numeroBilhete }),
      tipo_documento: tipoDocumento,
      valores_financeiros_divergentes: financial.divergent,
    };
  } catch {
    return {};
  }
}
