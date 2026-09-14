import type { ApprovalFilter } from "./approvalVisibility";
import { solicitacaoStatusOptions, todosStatusSolicitacao, type SolicitacaoStatusFilter } from "./solicitacoesFilters.ts";
import type { Motivo } from "./types";

export type SolicitacoesFilters = {
  busca: string;
  status: SolicitacaoStatusFilter[];
  motivo: Motivo | "";
  aprovacao: ApprovalFilter;
  obra: string;
};

type FilterStorage = Pick<Storage, "getItem" | "setItem">;

const VERSION = 1;
const KEY_PREFIX = "ro-passagens:solicitacoes-filtros:v1:";
const validStatuses = new Set<string>(solicitacaoStatusOptions.map(({ value }) => value));
const validMotivos = new Set<string>([
  "ferias", "folga_campo", "desligamento", "transferencia_obra", "admissao",
  "inicio_obra", "retorno_obra", "recesso", "viagem_diretoria", "viagem_administrativa",
]);
const validApprovals = new Set<string>(["", "pendente", "aprovada", "reprovada", "dispensada"]);

export function defaultSolicitacoesFilters(): SolicitacoesFilters {
  return { busca: "", status: todosStatusSolicitacao.slice(), motivo: "", aprovacao: "", obra: "" };
}

export function solicitacoesFiltersKey(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

export function normalizeSolicitacoesFilters(value: unknown, validObraIds?: ReadonlySet<string>): SolicitacoesFilters {
  const defaults = defaultSolicitacoesFilters();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const candidate = value as Record<string, unknown>;
  const status = Array.isArray(candidate.status)
    ? [...new Set(candidate.status.filter((item): item is SolicitacaoStatusFilter => typeof item === "string" && validStatuses.has(item)))]
    : defaults.status;
  const motivo = typeof candidate.motivo === "string" && (candidate.motivo === "" || validMotivos.has(candidate.motivo))
    ? candidate.motivo as Motivo | ""
    : defaults.motivo;
  const aprovacao = typeof candidate.aprovacao === "string" && validApprovals.has(candidate.aprovacao)
    ? candidate.aprovacao as ApprovalFilter
    : defaults.aprovacao;
  const obra = typeof candidate.obra === "string" && (!candidate.obra || !validObraIds || validObraIds.has(candidate.obra))
    ? candidate.obra
    : defaults.obra;
  return {
    busca: typeof candidate.busca === "string" ? candidate.busca.slice(0, 500) : defaults.busca,
    status,
    motivo,
    aprovacao,
    obra,
  };
}

export function readSolicitacoesFilters(userId: string, storage: FilterStorage = localStorage): SolicitacoesFilters {
  try {
    const raw = storage.getItem(solicitacoesFiltersKey(userId));
    if (!raw) return defaultSolicitacoesFilters();
    const saved = JSON.parse(raw) as { version?: unknown; filters?: unknown };
    if (saved?.version !== VERSION) return defaultSolicitacoesFilters();
    return normalizeSolicitacoesFilters(saved.filters);
  } catch {
    return defaultSolicitacoesFilters();
  }
}

export function writeSolicitacoesFilters(userId: string, filters: SolicitacoesFilters, storage: FilterStorage = localStorage) {
  try {
    storage.setItem(solicitacoesFiltersKey(userId), JSON.stringify({ version: VERSION, filters: normalizeSolicitacoesFilters(filters) }));
  } catch {
    // A tela continua funcional quando o armazenamento está indisponível ou sem espaço.
  }
}
