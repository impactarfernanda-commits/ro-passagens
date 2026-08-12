import type { DesligamentoSubtipo, Motivo } from "./types";

export const NOVA_SOLICITACAO_DRAFT_VERSION = 1;
export const NOVA_SOLICITACAO_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type NovaSolicitacaoForm = {
  funcionario_id: string;
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
};

export type NovaSolicitacaoDraftData = {
  form: NovaSolicitacaoForm;
  solicitarExcecao: boolean;
  destinoDiferente: boolean;
  justificativaDestino: string;
};

type StoredDraft = NovaSolicitacaoDraftData & { version: number; updatedAt: string };

export const emptyNovaSolicitacaoForm = (): NovaSolicitacaoForm => ({
  funcionario_id: "", obra_id: "", origem: "", destino: "", motivo: "",
  desligamento_subtipo: "", data_ida: "", data_retorno: "", destino_retorno: "",
  centro_custo_retorno_id: "", retorno_indefinido: false,
  centro_custo_destino_id: "", justificativa_excecao_prazo: "",
  observacoes_solicitante: "", solicitacao_origem_id: "",
  folga_antecipacao_justificativa: "",
});

export const novaSolicitacaoDraftKey = (userId: string) => `ro:nova-solicitacao:draft:${userId}`;

export function hasDraftContent(data: NovaSolicitacaoDraftData) {
  return Object.values(data.form).some((value) => typeof value === "boolean" ? value : Boolean(value.trim())) ||
    data.solicitarExcecao || data.destinoDiferente || Boolean(data.justificativaDestino.trim());
}

export function serializeDraft(data: NovaSolicitacaoDraftData, now = new Date()) {
  return JSON.stringify({ ...data, version: NOVA_SOLICITACAO_DRAFT_VERSION, updatedAt: now.toISOString() });
}

export function parseDraft(raw: string | null, now = Date.now()): StoredDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredDraft>;
    const updatedAt = Date.parse(value.updatedAt || "");
    if (value.version !== NOVA_SOLICITACAO_DRAFT_VERSION || !value.form ||
      !Number.isFinite(updatedAt) || now - updatedAt > NOVA_SOLICITACAO_DRAFT_MAX_AGE_MS) return null;
    const base = emptyNovaSolicitacaoForm();
    const form = Object.fromEntries(Object.entries(base).map(([key, fallback]) => {
      const candidate = (value.form as Record<string, unknown>)[key];
      return [key, typeof candidate === typeof fallback ? candidate : fallback];
    })) as NovaSolicitacaoForm;
    return {
      form, version: value.version, updatedAt: value.updatedAt!,
      solicitarExcecao: value.solicitarExcecao === true,
      destinoDiferente: value.destinoDiferente === true,
      justificativaDestino: typeof value.justificativaDestino === "string" ? value.justificativaDestino : "",
    };
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
