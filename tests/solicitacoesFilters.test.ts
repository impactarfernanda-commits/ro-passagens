import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resumoStatusSolicitacao, solicitacaoStatusOptions, statusPertenceAoFiltro, todosStatusSolicitacao } from "../src/solicitacoesFilters.ts";
import { solicitacaoCorrespondeBuscaPessoa } from "../src/solicitacaoColaborador.ts";

const page = fs.readFileSync("src/pages.tsx", "utf8");
const styles = fs.readFileSync("src/styles.css", "utf8");

test("status começa com todas as opções e resume a seleção", () => {
  assert.equal(resumoStatusSolicitacao(todosStatusSolicitacao), "Todos os status");
  assert.equal(resumoStatusSolicitacao(["finalizada"]), "Finalizada");
  assert.equal(resumoStatusSolicitacao(["solicitada", "cancelada"]), "2 status");
});

test("multisseleção permite excluir Finalizada e manter os demais status", () => {
  const semFinalizada = todosStatusSolicitacao.filter((status) => status !== "finalizada");
  assert.equal(statusPertenceAoFiltro("finalizada", semFinalizada), false);
  for (const status of ["solicitada", "em_andamento", "cancelada", "recusada"] as const) {
    assert.equal(statusPertenceAoFiltro(status, semFinalizada), true);
  }
});

test("Passagem comprada pertence a Em andamento sem ser opção própria", () => {
  assert.equal(statusPertenceAoFiltro("passagem_comprada", ["em_andamento"]), true);
  assert.equal(statusPertenceAoFiltro("em_analise", ["em_andamento"]), true);
  assert.equal(solicitacaoStatusOptions.some(({ value }) => (value as string) === "passagem_comprada"), false);
});

test("barra remove Registros e Funcionários e preserva Motivo, Aprovação e Obra", () => {
  assert.doesNotMatch(page, /Todos os registros/);
  assert.doesNotMatch(page, /Todos os funcionários/);
  assert.match(page, /Todos os motivos/);
  assert.match(page, /Todas as aprovações/);
  assert.match(page, /Todas as obras/);
});

test("busca continua localizando funcionário e combina com os demais filtros", () => {
  const solicitacao = { funcionario_id: "1", colaborador_id: null, funcionario: { id: "1", nome: "José da Silva" }, colaborador: null };
  assert.equal(solicitacaoCorrespondeBuscaPessoa(solicitacao, "jose"), true);
  assert.match(page, /solicitacaoCorrespondeBuscaPessoa\(r, filters\.busca\)/);
  assert.match(page, /statusPertenceAoFiltro\(r\.status, filters\.status\)[\s\S]*filters\.motivo[\s\S]*matchesApprovalFilter[\s\S]*filters\.obra[\s\S]*filters\.busca/);
});

test("busca maior e seletor com ações de multisseleção estão presentes", () => {
  assert.match(page, /placeholder="Buscar solicitações\.\.\."/);
  assert.match(page, /Selecionar todos/);
  assert.match(page, />Limpar<\/button>/);
  assert.match(styles, /filter-search\{flex:1 1 320px;min-width:280px\}/);
});
