import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isEditableOperationalCost, parseOperationalCostValue } from "../src/operationalCostRules.ts";

const migration = fs.readFileSync("supabase/migrations/20260816173000_permite_editar_custos_operacionais_ro.sql", "utf8");
const dryRun = fs.readFileSync("supabase/manual/DRY_RUN_20260816173000_permite_editar_custos_operacionais_ro.sql", "utf8");
const page = fs.readFileSync("src/pages.tsx", "utf8");

test("RPC substitui o custo sob bloqueio e devolve o total vigente", () => {
  assert.match(migration, /where id=p_custo_id and solicitacao_id=p_solicitacao_id for update/i);
  assert.match(migration, /update public\.ro_passagem_custos[\s\S]*set valor=p_novo_valor/i);
  assert.doesNotMatch(migration, /set valor\s*=\s*valor\s*\+/i);
  assert.match(migration, /select coalesce\(sum\(valor\),0\)[\s\S]*solicitacao_id=p_solicitacao_id/i);
});

test("autorização, autoria e auditoria são server-side e atômicas", () => {
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /public\.ro_can_operate\(\)/);
  assert.match(migration, /criado_por[\s\S]*auth\.uid\(\)/i);
  assert.match(migration, /atualizado de R\$ %s para R\$ %s/);
  assert.match(migration, /begin;[\s\S]*update public\.ro_passagem_custos[\s\S]*insert into public\.ro_passagem_historico[\s\S]*commit;/i);
});

test("UPDATE arbitrário é removido e a RPC não edita passagem", () => {
  assert.match(migration, /drop policy if exists ro_child_cost_write/);
  assert.doesNotMatch(migration, /create policy[^;]+for update/i);
  assert.match(migration, /tipo not in \('hospedagem','uber','refeicao','outros'\)/i);
  assert.match(migration, /CUSTO_NAO_PERTENCE_A_SOLICITACAO/);
});

test("valores inválidos são rejeitados no cliente", () => {
  for (const value of ["0", "-1", "NaN", "Infinity", "texto", "1.234"]) assert.equal(parseOperationalCostValue(value), null);
  assert.equal(parseOperationalCostValue("110,50"), 110.5);
});

test("passagem não é custo operacional genericamente editável", () => {
  assert.equal(isEditableOperationalCost("passagem"), false);
  for (const tipo of ["uber", "hospedagem", "refeicao", "outros"] as const) assert.equal(isEditableOperationalCost(tipo), true);
});

test("UI expõe edição somente ao operador e recarrega custo e total após salvar", () => {
  assert.match(page, /canEditCosts=\{access\.canOperateRO/);
  assert.match(page, /Editar valor/);
  assert.match(page, /ro_atualizar_custo_operacional/);
  assert.match(page, /setEditing\(false\); onDone\(\)/);
});

test("dry-run é transacional, autocontido e mantém paridade integral do DDL", () => {
  assert.match(dryRun, /^begin;/i);
  assert.match(dryRun, /rollback;\s*$/i);
  assert.doesNotMatch(dryRun, /\bcommit\s*;/i);
  assert.doesNotMatch(dryRun, /\\(?:set|i|ir)\b/);
  const ddl = dryRun.match(/-- DDL_PARITY_BEGIN\s*([\s\S]*?)\s*-- DDL_PARITY_END/)?.[1].trim();
  const source = migration.replace(/^begin;\s*/i, "").replace(/\s*commit;\s*$/i, "").trim();
  assert.equal(ddl, source);
});

test("dry-run cobre 80→110, mesmo valor, tipos, pertencimento e status", () => {
  assert.match(dryRun, /'uber','Uber dry-run',80/);
  assert.match(dryRun, /ro_atualizar_custo_operacional\(v_a,v_custo,110\)/);
  assert.match(dryRun, /Uber atualizado de R\$ 80,00 para R\$ 110,00/);
  assert.match(dryRun, /Uber atualizado de R\$ 110,00 para R\$ 110,00/);
  assert.match(dryRun, /TIPO_CUSTO_NAO_EDITAVEL/);
  assert.match(dryRun, /CUSTO_NAO_PERTENCE_A_SOLICITACAO/);
  assert.match(dryRun, /v_cancelada,v_recusada/);
});

test("dry-run audita ACL por proacl/acldefault/aclexplode e bloqueia UPDATE direto", () => {
  assert.doesNotMatch(dryRun, /has_function_privilege\s*\(\s*'PUBLIC'/i);
  assert.match(dryRun, /aclexplode\(coalesce\(p\.proacl,acldefault\('f',p\.proowner\)\)\)/);
  assert.match(dryRun, /x\.grantee=0/);
  assert.match(dryRun, /rolname='anon'/);
  assert.match(dryRun, /rolname='authenticated'/);
  assert.match(dryRun, /set local role authenticated/);
  assert.match(dryRun, /UPDATE_DIRETO_AUTHENTICATED_NAO_FOI_BLOQUEADO/);
});

test("fixture respeita integralmente o ramo não-folga da constraint atual", () => {
  assert.doesNotMatch(dryRun, /jsonb_populate_record|to_jsonb\(v_source\)/);
  assert.match(dryRun, /'viagem_administrativa'/);
  const fixtureColumns = dryRun.match(/insert into public\.ro_passagem_solicitacoes\(([\s\S]*?)\) values/)?.[1] || "";
  const fixtureRows = dryRun.match(/insert into public\.ro_passagem_solicitacoes\([\s\S]*?\) values([\s\S]*?);\s*\n\s*insert into public\.ro_passagem_custos/)?.[1] || "";
  for (const field of [
    "folga_data_prevista_ciclo", "folga_ciclo_anterior_id", "folga_antecipada",
    "folga_antecipacao_justificativa", "folga_antecipacao_status",
    "folga_antecipacao_analisada_por", "folga_antecipacao_analisada_em",
  ]) assert.match(fixtureColumns, new RegExp(`\\b${field}\\b`));
  assert.match(dryRun, /null,null,false,null,null,null,null,null,null,null/);
  assert.doesNotMatch(fixtureRows, /nao_aplicavel|folga_campo/);
  assert.match(dryRun, /conname='ro_folga_campos_coerentes_ck'/);
  for (const condition of [
    "folga_data_prevista_ciclo IS NULL", "folga_ciclo_anterior_id IS NULL", "NOT folga_antecipada",
    "folga_antecipacao_justificativa IS NULL", "folga_antecipacao_status IS NULL",
    "folga_antecipacao_analisada_por IS NULL", "folga_antecipacao_analisada_em IS NULL",
  ]) assert.match(dryRun, new RegExp(condition, "i"));
});

test("fixture financeira usa obra elegível e preserva o trigger de centro de custo", () => {
  assert.match(dryRun, /o\.visivel_passagens and o\.escopo_passagens in \('comum','restrito_ro'\)/);
  assert.match(dryRun, /valor,centro_custo_id,created_by/);
  for (const tipo of ["uber", "hospedagem", "refeicao", "outros", "passagem"])
    assert.match(dryRun, new RegExp(`'${tipo}'[^\\n]+v_obra,v_actor`));
  assert.match(dryRun, /c\.centro_custo_id is distinct from s\.obra_id/);
  assert.match(dryRun, /Centro de custo financeiro é obrigatório para custos com valor/);
  assert.match(dryRun, /TRIGGER_CENTRO_CUSTO_NAO_BLOQUEOU_CUSTO_POSITIVO/);
});

test("verificação relata legado positivo sem centro financeiro sem alterar dados", () => {
  const verification = fs.readFileSync("supabase/manual/verificar_edicao_custos_operacionais_ro.sql", "utf8");
  assert.match(verification, /count\(\*\) as custos_positivos_sem_centro_custo_financeiro/);
  assert.match(verification, /where valor>0 and centro_custo_id is null/);
  assert.doesNotMatch(verification, /\b(insert|update|delete|merge|truncate)\b/i);
});
