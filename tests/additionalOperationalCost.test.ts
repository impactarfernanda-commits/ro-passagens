import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  additionalOperationalCostPayload,
  OPERATIONAL_COST_MAX_VALUE,
  validateAdditionalOperationalCost,
} from "../src/additionalOperationalCost.ts";
import type { Obra } from "../src/types.ts";

const migration = fs.readFileSync(
  "supabase/migrations/202609290001_adiciona_custo_operacional_outros.sql",
  "utf8",
);
const page = fs.readFileSync("src/pages.tsx", "utf8");
const centers: Obra[] = [
  { id: "obra", nome: "Obra", visivel_passagens: true, escopo_passagens: "comum" },
];

test("RPC é exclusiva de outros e mantém múltiplas linhas independentes", () => {
  assert.match(migration, /create or replace function public\.ro_adicionar_custo_operacional\s*\(\s*p_solicitacao_id uuid,\s*p_valor numeric,\s*p_descricao text,\s*p_centro_custo_id uuid/i);
  assert.match(migration, /insert into public\.ro_passagem_custos[\s\S]*p_solicitacao_id,'outros',v_descricao,v_valor,p_centro_custo_id,auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /on conflict|update public\.ro_passagem_custos/i);
});

test("RPC replica autorização, estados efetivos e limite financeiro atuais", () => {
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /public\.ro_can_operate\(\)/);
  assert.match(migration, /v_sol\.excluida_em is not null or v_sol\.status in\('cancelada','recusada'\)/i);
  assert.match(migration, /v_sol\.aprovacao_status in\('pendente','reprovada'\)/i);
  assert.match(migration, /v_valor<0\.01 or v_valor>9999999999\.99/i);
});

test("RPC exige descrição e valida vínculo e elegibilidade do centro", () => {
  assert.match(migration, /nullif\(btrim\(coalesce\(p_descricao,''\)\),''\)/i);
  for (const field of ["obra_id", "centro_custo_destino_id", "centro_custo_retorno_id"])
    assert.match(migration, new RegExp(`v_sol\\.${field}`, "i"));
  assert.match(migration, /o\.visivel_passagens[\s\S]*o\.escopo_passagens in\('comum','restrito_ro'\)/i);
});

test("custo e auditoria pertencem à mesma RPC e o retorno identifica a linha", () => {
  assert.match(migration, /begin;[\s\S]*insert into public\.ro_passagem_custos[\s\S]*insert into public\.ro_passagem_historico[\s\S]*commit;/i);
  assert.match(migration, /Custo operacional Outros incluído[\s\S]*v_custo_id[\s\S]*p_centro_custo_id[\s\S]*v_descricao/i);
  for (const key of ["custo_id", "tipo", "valor", "descricao", "centro_custo_id", "total"])
    assert.match(migration, new RegExp(`'${key}'`));
  assert.match(migration, /revoke all on function public\.ro_adicionar_custo_operacional\(uuid,numeric,text,uuid\) from public,anon/i);
  assert.match(migration, /grant execute on function public\.ro_adicionar_custo_operacional\(uuid,numeric,text,uuid\) to authenticated/i);
});

test("validação do formulário impede chamadas incompletas e fora do limite", () => {
  assert.match(validateAdditionalOperationalCost({ centroCustoId: "", valor: "10", descricao: "Táxi" }, centers) || "", /centro de custo/i);
  assert.match(validateAdditionalOperationalCost({ centroCustoId: "obra", valor: "", descricao: "Táxi" }, centers) || "", /valor/i);
  assert.match(validateAdditionalOperationalCost({ centroCustoId: "obra", valor: "0", descricao: "Táxi" }, centers) || "", /valor/i);
  assert.match(validateAdditionalOperationalCost({ centroCustoId: "obra", valor: String(OPERATIONAL_COST_MAX_VALUE + 1), descricao: "Táxi" }, centers) || "", /limite/i);
  assert.match(validateAdditionalOperationalCost({ centroCustoId: "obra", valor: "10", descricao: "   " }, centers) || "", /descrição/i);
  assert.equal(validateAdditionalOperationalCost({ centroCustoId: "obra", valor: "10,50", descricao: " Táxi " }, centers), null);
});

test("payload normaliza valor e descrição sem enviar tipo arbitrário", () => {
  assert.deepEqual(additionalOperationalCostPayload("sol", { centroCustoId: "obra", valor: "10,50", descricao: " Táxi " }), {
    p_solicitacao_id: "sol",
    p_valor: 10.5,
    p_descricao: "Táxi",
    p_centro_custo_id: "obra",
  });
});

test("UI oferece inclusão e preserva a RPC de edição dos custos existentes", () => {
  assert.match(page, /Adicionar outro custo/);
  assert.match(page, /ro_adicionar_custo_operacional/);
  assert.match(page, /ro_atualizar_custo_operacional/);
  assert.match(page, /Ex\.: Locação de veículo para deslocamento/);
});
