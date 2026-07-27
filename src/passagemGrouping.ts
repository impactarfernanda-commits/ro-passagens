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
  consolidatedPassenger: string;
  consolidatedOrigin: string;
  consolidatedDestination: string;
  consolidatedDeparture: string;
  consolidatedSeat: string;
  consolidatedLocator: string;
};

const normalized = (value?: string) => normalizePassagemKey(value || "");
const digits = (value?: string) => (value || "").replace(/\D/g, "");
const normalizedDate = (value?: string) =>
  value ? value.slice(0, 16).replace(/\D/g, "") : "";
const normalizedPlace = (value?: string) =>
  normalized(value).replace(/\bSAO LUIZ\b/g, "SAO LUIS");

const compatibleText = (first: string, second: string) =>
  first === second || first.includes(second) || second.includes(first);

function complementaryTypes(
  left: PassagemDocument,
  right: PassagemDocument,
) {
  return (
    (left.tipo_documento === "voucher" &&
      right.tipo_documento === "bilhete_embarque") ||
    (right.tipo_documento === "voucher" &&
      left.tipo_documento === "bilhete_embarque")
  );
}

function passageEvidence(left: PassagemDocument, right: PassagemDocument) {
  const leftLocator = normalized(left.localizador);
  const rightLocator = normalized(right.localizador);
  const leftTicket = normalized(left.numero_bilhete);
  const rightTicket = normalized(right.numero_bilhete);
  const leftDate = normalizedDate(left.partida_em);
  const rightDate = normalizedDate(right.partida_em);
  const leftSeat = normalized(left.poltrona);
  const rightSeat = normalized(right.poltrona);
  const leftName = normalized(left.passageiro);
  const rightName = normalized(right.passageiro);
  const leftOrigin = normalizedPlace(left.origem);
  const rightOrigin = normalizedPlace(right.origem);
  const leftDestination = normalizedPlace(left.destino);
  const rightDestination = normalizedPlace(right.destino);
  const conflicts =
    Boolean(leftLocator && rightLocator && leftLocator !== rightLocator) ||
    Boolean(leftDate && rightDate && leftDate !== rightDate) ||
    Boolean(leftSeat && rightSeat && leftSeat !== rightSeat) ||
    Boolean(leftName && rightName && !compatibleText(leftName, rightName)) ||
    Boolean(leftOrigin && rightOrigin && !compatibleText(leftOrigin, rightOrigin)) ||
    Boolean(
      leftDestination &&
        rightDestination &&
        !compatibleText(leftDestination, rightDestination),
    );
  const matches = [
    Boolean(leftLocator && rightLocator && leftLocator === rightLocator),
    Boolean(leftTicket && rightTicket && leftTicket === rightTicket),
    Boolean(leftDate && rightDate && leftDate === rightDate),
    Boolean(leftSeat && rightSeat && leftSeat === rightSeat),
    Boolean(leftName && rightName && compatibleText(leftName, rightName)),
    Boolean(
      leftOrigin &&
        rightOrigin &&
        leftDestination &&
        rightDestination &&
        compatibleText(leftOrigin, rightOrigin) &&
        compatibleText(leftDestination, rightDestination),
    ),
  ].filter(Boolean).length;
  return { conflicts, matches };
}

function samePassage(left: PassagemDocument, right: PassagemDocument) {
  const evidence = passageEvidence(left, right);
  if (evidence.conflicts) return false;
  return complementaryTypes(left, right)
    ? evidence.matches >= 1
    : evidence.matches >= 2;
}

function complementaryCoverage(
  left: PassagemDocument,
  right: PassagemDocument,
) {
  if (!complementaryTypes(left, right) || passageEvidence(left, right).conflicts)
    return false;
  const voucher = left.tipo_documento === "voucher" ? left : right;
  const official = left.tipo_documento === "bilhete_embarque" ? left : right;
  const voucherIdentityAndTrip = Boolean(
    voucher.passageiro &&
      voucher.partida_em &&
      (voucher.poltrona || voucher.localizador),
  );
  const officialRoute = Boolean(official.origem && official.destino);
  return voucherIdentityAndTrip && officialRoute;
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
      candidate.every(
        (item) => !passageEvidence(item, document).conflicts,
      ) && candidate.some((item) => samePassage(item, document)),
    );
    if (group) group.push(document);
    else groups.push([document]);
  }
  const voucherOnlyGroups = groups.filter((group) =>
    group.every((item) => item.tipo_documento === "voucher"),
  );
  const officialOnlyGroups = groups.filter((group) =>
    group.every((item) => item.tipo_documento === "bilhete_embarque"),
  );
  if (voucherOnlyGroups.length === 1 && officialOnlyGroups.length === 1) {
    const voucherGroup = voucherOnlyGroups[0];
    const officialGroup = officialOnlyGroups[0];
    if (
      voucherGroup.every((voucher) =>
        officialGroup.every(
          (official) => !passageEvidence(voucher, official).conflicts,
        ),
      ) &&
      voucherGroup.some((voucher) =>
        officialGroup.some((official) =>
          complementaryCoverage(voucher, official),
        ),
      )
    ) {
      voucherGroup.push(...officialGroup);
      groups.splice(groups.indexOf(officialGroup), 1);
    }
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
      consolidatedPassenger:
        group.find((item) => item.passageiro)?.passageiro || "",
      consolidatedOrigin: group.find((item) => item.origem)?.origem || "",
      consolidatedDestination:
        group.find((item) => item.destino)?.destino || "",
      consolidatedDeparture:
        group.find((item) => item.partida_em)?.partida_em || "",
      consolidatedSeat: group.find((item) => item.poltrona)?.poltrona || "",
      consolidatedLocator:
        group.find((item) => item.localizador)?.localizador || "",
      documentMismatch: group.some((left, leftIndex) =>
        group.slice(leftIndex + 1).some((right) => {
          const leftDocument = digits(left.documento);
          const rightDocument = digits(right.documento);
          return Boolean(
            leftDocument &&
            rightDocument &&
            leftDocument.length === rightDocument.length &&
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
