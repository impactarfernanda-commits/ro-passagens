import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { visibleOperationalCostLabel, visibleOperationalCosts, visibleOperationalCostsTotal } from "../src/requesterOperationalCosts.ts";

const internalUsersMigration = readFileSync("supabase/migrations/20260831123435_amplia_leitura_e_historico_aprovacoes.sql", "utf8");

const costs = [
  { id: "meal", tipo: "refeicao" as const, valor: 180, descricao: null },
  { id: "uber", tipo: "uber" as const, valor: 70, descricao: null },
  { id: "other-1", tipo: "outros" as const, valor: 250, descricao: "Locação de veículo" },
  { id: "other-2", tipo: "outros" as const, valor: 40, descricao: "Pedágio" },
  { id: "ticket", tipo: "passagem" as const, valor: 900, descricao: null },
  { id: "hotel", tipo: "hospedagem" as const, valor: 500, descricao: null },
  { id: "zero", tipo: "uber" as const, valor: 0, descricao: null },
  { id: "negative", tipo: "refeicao" as const, valor: -1, descricao: null },
];

test("usuário interno vê somente custos operacionais positivos e preserva múltiplos Outros", () => {
  const visible = visibleOperationalCosts(costs);
  assert.deepEqual(visible.map((cost) => cost.id), ["meal", "uber", "other-1", "other-2"]);
  assert.deepEqual(visible.filter((cost) => cost.tipo === "outros").map((cost) => cost.descricao), ["Locação de veículo", "Pedágio"]);
  assert.equal(visibleOperationalCostsTotal(costs), 540);
  assert.equal(visibleOperationalCostLabel("refeicao"), "Refeição");
  assert.equal(visibleOperationalCostLabel("uber"), "Uber");
  assert.equal(visibleOperationalCostLabel("outros"), "Outros");
});

test("RPC exige usuário interno ativo, solicitação visível e projeção mínima", () => {
  const sql = readFileSync("supabase/migrations/202609290002_expoe_custos_operacionais_ao_solicitante.sql", "utf8");
  assert.match(sql, /returns table\(\s*id uuid,\s*tipo text,\s*valor numeric,\s*descricao text\s*\)/i);
  assert.match(sql, /ro_custos_operacionais_visiveis/i);
  assert.match(sql, /auth\.uid\(\) is not null/i);
  assert.match(sql, /public\.ro_is_active_internal_user\(\)/i);
  assert.doesNotMatch(sql, /s\.solicitante_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /s\.excluida_em is null/i);
  assert.match(sql, /c\.tipo in\('refeicao','uber','outros'\)/i);
  assert.match(sql, /c\.valor>0/i);
  assert.doesNotMatch(sql, /grant select on .*ro_passagem_custos/i);
  assert.doesNotMatch(sql, /centro_custo_id|created_by/i);
  assert.match(internalUsersMigration, /auth\.uid\(\) is not null/i);
  assert.match(internalUsersMigration, /is_anonymous/i);
  assert.match(internalUsersMigration, /u\.deleted_at is null/i);
  assert.match(internalUsersMigration, /u\.banned_until is null or u\.banned_until<=now\(\)/i);
  assert.match(internalUsersMigration, /public\.ro_is_active_internal_user\(\)[\s\S]*excluida_em is null/i);
});

test("interface do solicitante é neutra e somente leitura", () => {
  const page = readFileSync("src/pages.tsx", "utf8");
  const block = page.slice(page.indexOf("requester-operational-costs\""), page.indexOf("<h3 className=\"documents-heading\""));
  assert.match(block, /Custos operacionais/);
  assert.match(block, /Total de custos operacionais/);
  assert.match(block, /cost\.descricao/);
  assert.doesNotMatch(block, /Repasse|Valor a receber|Editar valor|Adicionar outro custo|centroCusto/i);
});

test("usuário interno comum consulta custos de qualquer solicitação visível e canViewAll não duplica o bloco", () => {
  const page = readFileSync("src/pages.tsx", "utf8");
  assert.match(page, /const visibleCostsPromise = !access\.canViewAll[\s\S]*ro_custos_operacionais_visiveis/);
  assert.match(page, /canViewOperationalCosts=\{!access\.canViewAll\}/);
  assert.doesNotMatch(page, /solicitante_id === userId[\s\S]{0,120}ro_custos_operacionais_visiveis/);
  assert.match(page, /canViewCosts=\{canViewFinancialCosts\(access\)\}/);
});
