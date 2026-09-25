import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { operationalRejectionErrorMessage } from "../src/recusaErrorMessages.ts";
import { motivoRecusaValido, podeRecusarSolicitacao } from "../src/recusaRules.ts";
import type { Solicitacao } from "../src/types.ts";

const migration = fs.readFileSync("supabase/migrations/202609250001_permite_recusa_ro_com_aprovacao_pendente.sql", "utf8");
const rejectionFunction = fs.readFileSync("supabase/migrations/202609100003_corrige_folga_ativa_e_recusa_antecipada_ro.sql", "utf8");
const approvalFunction = fs.readFileSync("supabase/migrations/20260917134432_reprovacao_aprovador_recusada.sql", "utf8");
const page = fs.readFileSync("src/pages.tsx", "utf8");
const row = (status: Solicitacao["status"]) => ({ status, comprado_em:null, comprado_por:null, custos:[], anexos:[] }) as Solicitacao;

test("recusa RO pendente aceita somente as origens operacionais previstas", () => {
  assert.match(migration, /old\.status in \('solicitada','em_andamento'\)/);
  assert.equal(podeRecusarSolicitacao(true, row("solicitada")), true);
  assert.equal(podeRecusarSolicitacao(true, row("em_andamento")), true);
});

test("contexto de recusa libera exclusivamente a transição terminal", () => {
  assert.match(migration, /current_setting\('ro\.recusa_rpc',true\)[\s\S]*new\.status='recusada'/);
  assert.match(migration, /new\.recusada_por=auth\.uid\(\)/);
  assert.doesNotMatch(migration, /new\.status='passagem_comprada'/);
});

test("allowlist congela toda coluna atual ou futura que não pertença à recusa", () => {
  const allowlist = "array['status','recusada_em','recusada_por','motivo_recusa']::text[]";
  assert.match(migration, new RegExp(`to_jsonb\\(new\\)-${allowlist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(migration, new RegExp(`to_jsonb\\(old\\)-${allowlist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(migration, /to_jsonb\(new\)[\s\S]*=\([\s\S]*to_jsonb\(old\)/);
});

test("campos de aprovação, compra, exclusão e operação não entram na allowlist", () => {
  const allowlistMatch = migration.match(/array\[([^\]]+)\]::text\[\]/);
  assert.ok(allowlistMatch);
  const allowlist = allowlistMatch[1].match(/'([^']+)'/g)?.map((field) => field.slice(1,-1));
  assert.deepEqual(allowlist, ["status", "recusada_em", "recusada_por", "motivo_recusa"]);
  for (const blocked of [
    "aprovador_id", "aprovacao_status", "aprovado_em", "reprovado_em", "motivo_reprovacao_aprovador",
    "comprado_em", "comprado_por", "tipo_transporte", "companhia", "localizador", "origem_comprada",
    "destino_comprado", "partida_em", "chegada_em", "excluida_em", "excluida_por", "motivo_exclusao",
    "responsavel_ro_id", "observacoes_ro", "updated_at", "coluna_futura_de_negocio",
  ]) assert.equal(allowlist?.includes(blocked), false);
});

test("update comum e recusa inválida continuam bloqueados", () => {
  assert.match(migration, /and not v_aprovacao_rpc[\s\S]*and not v_recusa_terminal_ro[\s\S]*raise exception 'SOLICITACAO_AGUARDANDO_APROVACAO'/);
  assert.match(migration, /new\.comprado_em is distinct from old\.comprado_em/);
  assert.match(migration, /new\.responsavel_ro_id is distinct from old\.responsavel_ro_id/);
  assert.match(migration, /new\.excluida_em is distinct from old\.excluida_em/);
});

test("reprovação do aprovador permanece em seu contexto e campos próprios", () => {
  assert.match(approvalFunction, /current_setting\('ro\.aprovacao_rpc',true\)/);
  assert.match(approvalFunction, /v\.aprovador_id is distinct from auth\.uid\(\)/);
  assert.match(approvalFunction, /v\.aprovacao_status<>'pendente'/);
  assert.match(approvalFunction, /status='recusada', aprovacao_status='reprovada'/);
});

test("RPC mantém autenticação, RO ativo, ausência de compra e motivo válido", () => {
  assert.match(rejectionFunction, /auth\.uid\(\) is null[\s\S]*ro_is_operador_ativo\(auth\.uid\(\)\)[\s\S]*length\(v_motivo\)<10/);
  assert.match(rejectionFunction, /ro_solicitacao_foi_comprada\(p_solicitacao_id\)/);
  assert.match(rejectionFunction, /v_sol\.status not in \('solicitada','em_andamento'\)/);
  assert.equal(motivoRecusaValido("curto"), false);
});

test("usuário fora da RO e estado legado não recebem a ação no frontend", () => {
  assert.equal(podeRecusarSolicitacao(false, row("solicitada")), false);
  assert.equal(podeRecusarSolicitacao(true, row("em_analise")), false);
});

test("frontend traduz erros conhecidos da recusa", () => {
  assert.match(operationalRejectionErrorMessage({message:"SOLICITACAO_AGUARDANDO_APROVACAO"}), /aprovação está pendente/);
  assert.match(operationalRejectionErrorMessage({message:"", code:"NAO_AUTENTICADO"}), /sessão expirou/);
  assert.match(operationalRejectionErrorMessage({message:"RECUSA_SOMENTE_PELA_RPC"}), /com segurança/);
  assert.equal(operationalRejectionErrorMessage({message:"ERRO_DESCONHECIDO"}), "Não foi possível recusar a solicitação.");
  assert.match(page, /import\.meta\.env\.DEV[\s\S]*operationalRejectionErrorDetails\(error\)/);
});
