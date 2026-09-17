import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  defaultSolicitacoesFilters,
  normalizeSolicitacoesFilters,
  readSolicitacoesFilters,
  solicitacoesFiltersKey,
  writeSolicitacoesFilters,
} from "../src/solicitacoesFilterPersistence.ts";
import { matchesApprovalFilter } from "../src/approvalVisibility.ts";
import { statusPertenceAoFiltro } from "../src/solicitacoesFilters.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const customized = {
  busca: "Recife",
  status: ["solicitada", "em_andamento", "cancelada", "recusada"] as const,
  motivo: "ferias" as const,
  aprovacao: "aprovada" as const,
  obra: "obra-1",
};

test("usuário sem estado salvo recebe todos os defaults", () => {
  assert.deepEqual(readSolicitacoesFilters("novo", new MemoryStorage()), defaultSolicitacoesFilters());
});

test("restaura status sem reintroduzir Finalizada", () => {
  const storage = new MemoryStorage();
  writeSolicitacoesFilters("u1", { ...customized, status: [...customized.status] }, storage);
  const restored = readSolicitacoesFilters("u1", storage);
  assert.deepEqual(restored.status, customized.status);
  assert.equal(restored.status.includes("finalizada"), false);
});

test("restaura busca, Motivo, Aprovação e Obra", () => {
  const storage = new MemoryStorage();
  writeSolicitacoesFilters("u1", { ...customized, status: [...customized.status] }, storage);
  const restored = readSolicitacoesFilters("u1", storage);
  assert.equal(restored.busca, "Recife");
  assert.equal(restored.motivo, "ferias");
  assert.equal(restored.aprovacao, "aprovada");
  assert.equal(restored.obra, "obra-1");
});

test("Afastamento persiste como filtro e JSON antigo continua válido", () => {
  const storage = new MemoryStorage();
  writeSolicitacoesFilters("u-afastamento", { ...defaultSolicitacoesFilters(), motivo: "afastamento" }, storage);
  assert.equal(readSolicitacoesFilters("u-afastamento", storage).motivo, "afastamento");
  storage.setItem(solicitacoesFiltersKey("u-antigo"), JSON.stringify({ version: 1, filters: { ...customized } }));
  assert.equal(readSolicitacoesFilters("u-antigo", storage).motivo, "ferias");
});

test("chave e conteúdo são isolados por usuário", () => {
  const storage = new MemoryStorage();
  writeSolicitacoesFilters("u1", { ...customized, status: [...customized.status] }, storage);
  writeSolicitacoesFilters("u2", { ...defaultSolicitacoesFilters(), busca: "São Paulo" }, storage);
  assert.notEqual(solicitacoesFiltersKey("u1"), solicitacoesFiltersKey("u2"));
  assert.equal(readSolicitacoesFilters("u1", storage).busca, "Recife");
  assert.equal(readSolicitacoesFilters("u2", storage).busca, "São Paulo");
});

test("JSON inválido e versão desconhecida voltam aos defaults", () => {
  const storage = new MemoryStorage();
  storage.setItem(solicitacoesFiltersKey("json"), "{inválido");
  storage.setItem(solicitacoesFiltersKey("versao"), JSON.stringify({ version: 99, filters: customized }));
  assert.deepEqual(readSolicitacoesFilters("json", storage), defaultSolicitacoesFilters());
  assert.deepEqual(readSolicitacoesFilters("versao", storage), defaultSolicitacoesFilters());
});

test("valores removidos ou inválidos são ignorados sem perder valores válidos", () => {
  const normalized = normalizeSolicitacoesFilters({
    busca: "João",
    status: ["em_andamento", "passagem_comprada", "legado"],
    motivo: "motivo_antigo",
    aprovacao: "aguardando",
    obra: "obra-removida",
  }, new Set(["obra-atual"]));
  assert.deepEqual(normalized.status, ["em_andamento"]);
  assert.equal(normalized.motivo, "");
  assert.equal(normalized.aprovacao, "");
  assert.equal(normalized.obra, "");
  assert.equal(normalized.busca, "João");
});

test("filtros restaurados continuam combinando e Em andamento inclui passagem comprada", () => {
  const filters = normalizeSolicitacoesFilters({ ...customized, status: ["em_andamento"] });
  assert.equal(statusPertenceAoFiltro("passagem_comprada", filters.status), true);
  assert.equal(matchesApprovalFilter("aprovada", filters.aprovacao), true);
  assert.equal(matchesApprovalFilter("pendente", filters.aprovacao), false);
  const row = { status: "passagem_comprada" as const, motivo: "ferias", aprovacao: "aprovada", obra: "obra-1", busca: "Recife" };
  const combines = statusPertenceAoFiltro(row.status, filters.status)
    && (!filters.motivo || row.motivo === filters.motivo)
    && matchesApprovalFilter(row.aprovacao, filters.aprovacao)
    && (!filters.obra || row.obra === filters.obra)
    && row.busca.includes(filters.busca);
  assert.equal(combines, true);
});

test("integração restaura no mount, persiste com debounce e remonta na troca de usuário", () => {
  const page = fs.readFileSync("src/pages.tsx", "utf8");
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(page, /readSolicitacoesFilters\(userId\)/);
  assert.match(page, /setTimeout\(\(\) => writeSolicitacoesFilters\(userId, filters\), 200\)/);
  assert.match(app, /<Solicitacoes key=\{session\.user\.id\}/);
});
