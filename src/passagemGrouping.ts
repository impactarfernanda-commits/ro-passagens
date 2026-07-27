import {
  classifyDocumentValueSource,
  normalizePassagemKey,
  type DocumentType,
} from "./pdfPassagemHeuristics";

export type PassagemDocument = {
  id: string;
  nome_arquivo: string;
  valor: string | number;
  partida_em?: string;
  passageiro?: string;
  documento?: string;
  origem?: string;
  destino?: string;
  poltrona?: string;
  localizador?: string;
  numero_bilhete?: string;
  tipo_documento?: DocumentType;
  valores_financeiros_divergentes?: boolean;
};

export type PassagemGroup = {
  key: string;
  documents: PassagemDocument[];
  value: number;
  conflictingValues: boolean;
  needsReview: boolean;
  documentMismatch: boolean;
  financialDocumentId: string;
  valueSource: "voucher" | "bilhete_oficial" | "desconhecido" | "nenhum";
  informationalTicketValues: number[];
  valueHierarchyNotice: boolean;
};

const normalized = (value?: string) => normalizePassagemKey(value || "");
const digits = (value?: string) => (value || "").replace(/\D/g, "");
const normalizedDate = (value?: string) =>
  value ? value.slice(0, 16).replace(/\D/g, "") : "";
const normalizedPlace = (value?: string) =>
  normalized(value).replace(/\bSAO LUIZ\b/g, "SAO LUIS");

function samePassage(left: PassagemDocument, right: PassagemDocument) {
  const leftLocator = normalized(left.localizador);
  const rightLocator = normalized(right.localizador);
  if (leftLocator && rightLocator) return leftLocator === rightLocator;
  const leftTicket = normalized(left.numero_bilhete);
  const rightTicket = normalized(right.numero_bilhete);
  if (leftTicket && rightTicket) return leftTicket === rightTicket;
  const sameDate =
    Boolean(normalizedDate(left.partida_em)) &&
    normalizedDate(left.partida_em) === normalizedDate(right.partida_em);
  if (!sameDate) return false;
  const leftSeat = normalized(left.poltrona);
  const rightSeat = normalized(right.poltrona);
  if (leftSeat && rightSeat && leftSeat !== rightSeat) return false;
  const sameDocument =
    Boolean(digits(left.documento)) &&
    digits(left.documento) === digits(right.documento);
  const leftName = normalized(left.passageiro);
  const rightName = normalized(right.passageiro);
  const sameName =
    Boolean(leftName && rightName) &&
    (leftName === rightName ||
      leftName.includes(rightName) ||
      rightName.includes(leftName));
  const compatiblePlace = (first: string, second: string) =>
    Boolean(first && second) &&
    (first === second || first.includes(second) || second.includes(first));
  const sameRoute =
    compatiblePlace(normalizedPlace(left.origem), normalizedPlace(right.origem)) &&
    compatiblePlace(normalizedPlace(left.destino), normalizedPlace(right.destino));
  const sameSeat = Boolean(leftSeat && rightSeat);
  if (sameSeat) return sameDocument || sameName || sameRoute;
  const complementaryTypes =
    (left.tipo_documento === "voucher" &&
      right.tipo_documento === "bilhete_embarque") ||
    (right.tipo_documento === "voucher" &&
      left.tipo_documento === "bilhete_embarque");
  return complementaryTypes && sameName && sameRoute;
}

export function extractPassagemSignature(document: PassagemDocument) {
  const locator = normalized(document.localizador);
  if (locator) return `LOC:${locator}`;
  const ticket = normalized(document.numero_bilhete);
  if (ticket) return `BIL:${ticket}`;
  return [
    normalized(document.passageiro),
    digits(document.documento),
    normalized(document.origem),
    normalized(document.destino),
    normalizedDate(document.partida_em),
    normalized(document.poltrona),
  ].join("|");
}

export function groupPdfDocumentsByPassagem(
  documents: PassagemDocument[],
): PassagemGroup[] {
  const groups: PassagemDocument[][] = [];
  for (const document of documents) {
    const group = groups.find((candidate) =>
      candidate.some((item) => samePassage(item, document)),
    );
    if (group) group.push(document);
    else groups.push([document]);
  }
  return groups.map((group, index) => {
    const validDocuments = group.filter((item) => {
      const value = Number(item.valor);
      return Number.isFinite(value) && value > 0;
    });
    const voucherDocuments = validDocuments.filter(
      (item) => classifyDocumentValueSource(item.tipo_documento) === "voucher",
    );
    const officialDocuments = validDocuments.filter(
      (item) =>
        classifyDocumentValueSource(item.tipo_documento) === "bilhete_oficial",
    );
    const unknownDocuments = validDocuments.filter(
      (item) =>
        classifyDocumentValueSource(item.tipo_documento) === "desconhecido",
    );
    const selectedDocuments = voucherDocuments.length
      ? voucherDocuments
      : officialDocuments.length
        ? officialDocuments
        : unknownDocuments;
    const selectedValues = [
      ...new Set(
        selectedDocuments
          .map((item) => Number(item.valor))
          .map((value) => value.toFixed(2)),
      ),
    ].map(Number);
    const informationalTicketValues = [
      ...new Set(officialDocuments.map((item) => Number(item.valor).toFixed(2))),
    ]
      .map(Number)
      .filter((value) => !selectedValues.includes(value));
    const selectedSource = selectedDocuments[0]
      ? classifyDocumentValueSource(selectedDocuments[0].tipo_documento)
      : "nenhum";
    const conflictingValues =
      selectedValues.length > 1 ||
      selectedDocuments.some(
        (document) => document.valores_financeiros_divergentes,
      );
    return {
      key: extractPassagemSignature(group[0]) || `PENDENTE:${index}`,
      documents: group,
      value: selectedValues[0] || 0,
      conflictingValues,
      needsReview: selectedValues.length === 0 || conflictingValues,
      financialDocumentId: selectedDocuments[0]?.id || group[0].id,
      valueSource: selectedSource,
      informationalTicketValues,
      valueHierarchyNotice:
        voucherDocuments.length > 0 && informationalTicketValues.length > 0,
      documentMismatch: group.some((left, leftIndex) =>
        group.slice(leftIndex + 1).some((right) => {
          const leftDocument = digits(left.documento);
          const rightDocument = digits(right.documento);
          return Boolean(
            leftDocument &&
            rightDocument &&
            leftDocument !== rightDocument,
          );
        }),
      ),
    };
  });
}

export function calcularCustosSemDuplicidade(documents: PassagemDocument[]) {
  return groupPdfDocumentsByPassagem(documents);
}
