import type { Custo } from "./types.ts";
import { groupPdfDocumentsByPassagem, isValidFinancialPassageIdentity, type PassagemDocument } from "./passagemGrouping.ts";
import { buildPurchaseCosts } from "./purchaseCosts.ts";
import { complementaryCostCenters } from "./complementaryPassage.ts";
import type { Obra, Solicitacao } from "./types.ts";

export type PostPurchaseDocument = PassagemDocument & {
  ref: string;
  file?: File;
  existingAttachmentId?: string;
  storagePath?: string;
  sha256: string;
  mimeType: string;
  size: number;
  observacao?: string;
  historicalOnly?: boolean;
  sourceExisting?: boolean;
};

type NewPostPurchaseAttachment = {
  client_ref: string; id: null; nome_arquivo: string; storage_path: string | null;
  mime_type: string; tamanho_bytes: number; partida_em: string | null;
  valor: number | null; observacao: string | null; conteudo_sha256: string;
};
type ExistingPostPurchaseAttachment = {
  client_ref: string; id: string; conteudo_sha256: string;
};
export type PostPurchaseAttachmentPayload = NewPostPurchaseAttachment | ExistingPostPurchaseAttachment;
export type PostPurchaseDecision = {
  financial: boolean;
  value: number;
  manual: boolean;
  justification: string;
  existingCostId?: string;
  centro_custo_id?: string;
};

export const POST_PURCHASE_COST_CENTER_REQUIRED =
  "Selecione o centro de custo da nova passagem.";

export function postPurchaseCostCenters(
  request: Pick<Solicitacao, "obra_id" | "centro_custo_destino_id" | "centro_custo_retorno_id">,
  catalog: Obra[],
) {
  return complementaryCostCenters(request, catalog);
}

export function postPurchaseErrorMessage(message: string) {
  if (message.includes("CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO"))
    return "O centro de custo selecionado não está disponível para esta solicitação.";
  if (message.includes("COMPRA_CHAVE_CENTRO_CUSTO_DIVERGENTE"))
    return "Esta passagem já foi registrada com outro centro de custo. Revise a seleção antes de continuar.";
  return message;
}

export async function sha256Hex(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export const isExistingDeterministicUpload = (error: { statusCode?: string | number; message?: string } | null) =>
  Boolean(error && (String(error.statusCode || "") === "409" || /already exists|duplicate/i.test(error.message || "")));
export const deterministicPostPurchaseStoragePath = (requestId: string, operationId: string, sha256: string, safeName: string) =>
  `${requestId}/pos-compra/${operationId}-${sha256}-${safeName}`;
export const shouldCleanupPostPurchaseUploads = (rpcStarted: boolean) => !rpcStarted;

type StorageError = { statusCode?: string | number; message?: string } | null;
export async function registerPostPurchaseOperation({
  requestId, operationId, attachments, documents, upload, remove, register,
}: {
  requestId: string;
  operationId: string;
  attachments: PostPurchaseAttachmentPayload[];
  documents: PostPurchaseDocument[];
  upload: (path: string, file: File) => Promise<StorageError>;
  remove: (paths: string[]) => Promise<void>;
  register: (attachments: PostPurchaseAttachmentPayload[]) => Promise<{ data: unknown; error: { message: string } | null }>;
}) {
  const uploadedThisAttempt: string[] = [];
  let rpcStarted = false;
  try {
    for (const attachment of attachments) {
      const document = documents.find((item) => item.ref === attachment.client_ref);
      if (!document) throw new Error("Documento do payload pós-compra não encontrado.");
      if (document.existingAttachmentId) continue;
      const safeName = document.nome_arquivo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = deterministicPostPurchaseStoragePath(requestId, operationId, document.sha256, safeName);
      const uploadError = await upload(path, document.file!);
      if (uploadError && !isExistingDeterministicUpload(uploadError))
        throw new Error(`Não foi possível enviar ${document.nome_arquivo}.`);
      if (!uploadError) uploadedThisAttempt.push(path);
      if ("storage_path" in attachment) attachment.storage_path = path;
    }
    rpcStarted = true;
    const result = await register(attachments);
    if (result.error) throw new Error(result.error.message);
    return result.data;
  } catch (error) {
    if (shouldCleanupPostPurchaseUploads(rpcStarted) && uploadedThisAttempt.length)
      await remove(uploadedThisAttempt);
    throw error;
  }
}

export const normalizePostPurchaseJustification = (value: string | null | undefined) =>
  value?.trim().replace(/\s+/g, " ") || null;

const canonicalMoney = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : String(value);
};

export function canonicalizePostPurchasePayload(payload: ReturnType<typeof buildPostPurchasePayload>) {
  return {
    attachments: payload.attachments.map((item) => !("nome_arquivo" in item) ? {
      client_ref: item.client_ref.trim(), id: item.id,
      conteudo_sha256: item.conteudo_sha256.toLowerCase(),
    } : {
      client_ref: item.client_ref.trim(), id: null,
      nome_arquivo: item.nome_arquivo, mime_type: item.mime_type,
      tamanho_bytes: item.tamanho_bytes, partida_em: item.partida_em || null,
      valor: canonicalMoney(item.valor), observacao: item.observacao?.trim() || null,
      conteudo_sha256: item.conteudo_sha256.toLowerCase(),
    }).sort((a, b) => a.client_ref.localeCompare(b.client_ref)),
    groups: payload.groups.map((item) => ({
      compra_chave: item.compra_chave,
      valor_extraido: canonicalMoney(item.valor_extraido),
      valor_confirmado: canonicalMoney(item.valor_confirmado),
      valor_manual: Boolean(item.valor_manual),
      justificativa: normalizePostPurchaseJustification(item.justificativa),
      custo_existente_id: item.custo_existente_id || null,
      associacao_historica_manual: Boolean(item.associacao_historica_manual),
      centro_custo_id: item.centro_custo_id || null,
      anexo_refs: [...item.anexo_refs].sort(),
    })).sort((a, b) => a.compra_chave.localeCompare(b.compra_chave)),
  };
}

export function postPurchaseGroups(documents: PostPurchaseDocument[]) {
  return groupPdfDocumentsByPassagem(documents).map((group) => ({
    ...group,
    documents: group.documents as PostPurchaseDocument[],
  }));
}

export function buildPostPurchasePayload(
  documents: PostPurchaseDocument[],
  decisions: Record<string, PostPurchaseDecision>,
  costs: Custo[],
) {
  const groups = postPurchaseGroups(documents);
  const adjustedDocuments = documents.map((document) => {
    const group = groups.find((candidate) => candidate.documents.some((item) => item.ref === document.ref));
    const decision = group && decisions[group.key];
    return decision?.financial && group?.financialDocumentId === document.id
      ? { ...document, valor: decision.value, valor_confirmado_manualmente: true }
      : document;
  });
  const canonicalCosts = new Map(buildPurchaseCosts("pos-compra", adjustedDocuments, {
    uber: "", refeicao: "", outros: "",
  }, "pos-compra").filter((cost) => cost.tipo === "passagem").map((cost) => [cost.compra_chave, cost]));
  const payloadGroups = groups.flatMap((group) => {
    const decision = decisions[group.key];
    if (!decision?.financial) return [];
    if (!isValidFinancialPassageIdentity(group.key))
      throw new Error("Não foi possível identificar esta passagem com segurança. Revise os dados ou mantenha o documento como apoio sem custo.");
    if (!Number.isFinite(decision.value) || decision.value <= 0) throw new Error("Informe um valor maior que zero para cada nova passagem.");
    const historicalManual = Boolean(decision.existingCostId);
    if (historicalManual && !costs.some((cost) => cost.id === decision.existingCostId && cost.tipo === "passagem"))
      throw new Error("Selecione um custo histórico de passagem válido.");
    if (!historicalManual && !decision.centro_custo_id)
      throw new Error(POST_PURCHASE_COST_CENTER_REQUIRED);
    const justification = normalizePostPurchaseJustification(decision.justification);
    if ((decision.manual || group.needsReview || historicalManual) && (justification?.length || 0) < 10)
      throw new Error("Informe uma justificativa com ao menos 10 caracteres para o valor revisado manualmente.");
    const canonical = canonicalCosts.get(group.key);
    if (!canonical) throw new Error("O grupo financeiro não pôde ser convertido em custo canônico.");
    return [{
      compra_chave: group.key,
      valor_extraido: group.value || null,
      valor_confirmado: canonical.valor,
      valor_manual: decision.manual,
      justificativa: justification,
      custo_existente_id: decision.existingCostId || null,
      associacao_historica_manual: historicalManual,
      centro_custo_id: historicalManual ? null : decision.centro_custo_id,
      anexo_refs: group.documents.filter((document) => !document.historicalOnly || historicalManual).map((document) => document.ref),
    }];
  });
  const financialRefs = new Set(payloadGroups.flatMap((group) => group.anexo_refs));
  return {
    attachments: documents.filter((document) => !document.historicalOnly || financialRefs.has(document.ref)).map((document): PostPurchaseAttachmentPayload =>
      document.existingAttachmentId ? {
        client_ref: document.ref, id: document.existingAttachmentId,
        conteudo_sha256: document.sha256,
      } : {
        client_ref: document.ref, id: null, nome_arquivo: document.nome_arquivo,
        storage_path: null, mime_type: document.mimeType, tamanho_bytes: document.size,
        partida_em: document.partida_em || null,
        valor: Number(document.valor) > 0 ? Number(document.valor) : null,
        observacao: document.observacao || null, conteudo_sha256: document.sha256,
      }),
    groups: payloadGroups,
  };
}
