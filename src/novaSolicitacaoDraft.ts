import type { DesligamentoSubtipo, Motivo } from "./types";

export const NOVA_SOLICITACAO_DRAFT_VERSION = 2;
export const NOVA_SOLICITACAO_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type NovaSolicitacaoForm = {
  funcionario_id: string;
  aprovador_id: string;
  obra_id: string;
  origem: string;
  destino: string;
  motivo: Motivo | "";
  desligamento_subtipo: DesligamentoSubtipo | "";
  data_ida: string;
  data_retorno: string;
  destino_retorno: string;
  centro_custo_retorno_id: string;
  retorno_indefinido: boolean;
  centro_custo_destino_id: string;
  justificativa_excecao_prazo: string;
  observacoes_solicitante: string;
  solicitacao_origem_id: string;
  folga_antecipacao_justificativa: string;
  pix_viajante: string;
  necessita_hospedagem: boolean;
  hospedagem_checkin: string;
  hospedagem_checkout: string;
  ida_a_partir_horario: string;
};

export type NovaSolicitacaoDraftData = {
  form: NovaSolicitacaoForm;
  solicitarExcecao: boolean;
  destinoDiferente: boolean;
  justificativaDestino: string;
  privateRef?: string;
  documento?: NovaSolicitacaoDraftDocument | null;
};

export type NovaSolicitacaoDraftDocument = {
  nome: string;
  tamanho: number;
  mime: string;
  categoria: string;
};

type StoredDraft = NovaSolicitacaoDraftData & { version: number; updatedAt: string };

export const emptyNovaSolicitacaoForm = (): NovaSolicitacaoForm => ({
  funcionario_id: "", aprovador_id: "", obra_id: "", origem: "", destino: "", motivo: "",
  desligamento_subtipo: "", data_ida: "", data_retorno: "", destino_retorno: "",
  centro_custo_retorno_id: "", retorno_indefinido: false,
  centro_custo_destino_id: "", justificativa_excecao_prazo: "",
  observacoes_solicitante: "", solicitacao_origem_id: "",
  folga_antecipacao_justificativa: "",
  pix_viajante: "", necessita_hospedagem: false, hospedagem_checkin: "",
  hospedagem_checkout: "", ida_a_partir_horario: "",
});

export const novaSolicitacaoDraftKey = (userId: string) => `ro:nova-solicitacao:draft:${userId}`;

export function hasDraftContent(data: NovaSolicitacaoDraftData) {
  return Object.values(data.form).some((value) => typeof value === "boolean" ? value : Boolean(value.trim())) ||
    data.solicitarExcecao || data.destinoDiferente || Boolean(data.justificativaDestino.trim());
}

export function serializeDraft(data: NovaSolicitacaoDraftData, now = new Date()) {
  const safeForm: Partial<NovaSolicitacaoForm> = { ...data.form };
  delete safeForm.pix_viajante;
  return JSON.stringify({ ...data, form: safeForm, version: NOVA_SOLICITACAO_DRAFT_VERSION, updatedAt: now.toISOString() });
}

export function parseDraft(raw: string | null, now = Date.now()): StoredDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredDraft>;
    const updatedAt = Date.parse(value.updatedAt || "");
    if (![1, NOVA_SOLICITACAO_DRAFT_VERSION].includes(value.version || 0) || !value.form ||
      !Number.isFinite(updatedAt) || now - updatedAt > NOVA_SOLICITACAO_DRAFT_MAX_AGE_MS) return null;
    const base = emptyNovaSolicitacaoForm();
    const form = Object.fromEntries(Object.entries(base).map(([key, fallback]) => {
      const candidate = (value.form as Record<string, unknown>)[key];
      if (key === "motivo" && candidate === "nao_se_aplica") return [key, "viagem_administrativa"];
      return [key, typeof candidate === typeof fallback ? candidate : fallback];
    })) as NovaSolicitacaoForm;
    return {
      form, version: NOVA_SOLICITACAO_DRAFT_VERSION, updatedAt: value.updatedAt!,
      solicitarExcecao: value.solicitarExcecao === true,
      destinoDiferente: value.destinoDiferente === true,
      justificativaDestino: typeof value.justificativaDestino === "string" ? value.justificativaDestino : "",
      privateRef: typeof value.privateRef === "string" ? value.privateRef : undefined,
      documento: isDraftDocument(value.documento) ? value.documento : null,
    };
  } catch { return null; }
}

function isDraftDocument(value: unknown): value is NovaSolicitacaoDraftDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return typeof doc.nome === "string" && typeof doc.tamanho === "number" &&
    typeof doc.mime === "string" && typeof doc.categoria === "string";
}

export function draftPrivateRef(raw: string | null) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { privateRef?: unknown };
    return typeof value.privateRef === "string" ? value.privateRef : null;
  } catch { return null; }
}

export function validateDraftCatalogIds(draft: StoredDraft, employeeIds: Set<string>, costCenterIds: Set<string>) {
  return {
    ...draft,
    form: {
      ...draft.form,
      funcionario_id: employeeIds.has(draft.form.funcionario_id) ? draft.form.funcionario_id : "",
      obra_id: costCenterIds.has(draft.form.obra_id) ? draft.form.obra_id : "",
      centro_custo_retorno_id: costCenterIds.has(draft.form.centro_custo_retorno_id) ? draft.form.centro_custo_retorno_id : "",
      centro_custo_destino_id: costCenterIds.has(draft.form.centro_custo_destino_id) ? draft.form.centro_custo_destino_id : "",
    },
  };
}
