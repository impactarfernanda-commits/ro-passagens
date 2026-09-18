import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { approvalDecisionErrorMessage } from "../src/approvalErrorMessages.ts";

const page = fs.readFileSync("src/pages.tsx", "utf8");
const pacote1 = fs.readFileSync("supabase/migrations/202608210001_pacote_1_aprovadores_individuais_denise.sql", "utf8");
const recusa = fs.readFileSync("supabase/migrations/202608050002_recusa_solicitacao_ro.sql", "utf8");
const fix = fs.readFileSync("supabase/migrations/202608250002_corrige_reprovacao_aprovador_sem_recusa_operacional.sql", "utf8");
const definitive = fs.readFileSync("supabase/migrations/20260917134432_reprovacao_aprovador_recusada.sql", "utf8");

test("frontend chama a RPC canônica com a assinatura versionada", () => {
  assert.match(page, /"ro_reprovar_solicitacao"[\s\S]*\{p_solicitacao_id:row\.id,p_motivo:motivo\}/);
  assert.match(pacote1, /create or replace function public\.ro_reprovar_solicitacao\(\s*p_solicitacao_id uuid,\s*p_motivo text\s*\)/);
});

test("diagnóstico registra o conflito histórico sem remover a proteção", () => {
  assert.match(pacote1, /motivo_reprovacao_aprovador=m,\s*status='recusada'/);
  assert.match(recusa, /new\.status='recusada'[\s\S]*raise exception 'RECUSA_SOMENTE_PELA_RPC'/);
  assert.match(recusa, /current_setting\('ro\.recusa_rpc',true\)/);
});

test("migration histórica mantinha status operacional e registra a causa da inconsistência", () => {
  const update = fix.match(/update public\.ro_passagem_solicitacoes[\s\S]*?where id=v\.id;/)?.[0] || "";
  assert.match(update, /aprovacao_status='reprovada'/);
  assert.match(update, /reprovado_em=now\(\)/);
  assert.match(update, /motivo_reprovacao_aprovador=m/);
  assert.doesNotMatch(update, /\bstatus\s*=/);
  assert.doesNotMatch(update, /recusada_em|recusada_por|motivo_recusa/);
  assert.match(fix, /values\(\s*v\.id,\s*v\.status,\s*v\.status,/);
});

test("nova reprovação persiste os dois estados e histórico sem metadados RO", () => {
  const update = definitive.match(/update public\.ro_passagem_solicitacoes[\s\S]*?where id=v\.id;/)?.[0] || "";
  assert.match(update, /status='recusada', aprovacao_status='reprovada'/);
  assert.match(update, /reprovado_em=now\(\), motivo_reprovacao_aprovador=m/);
  assert.doesNotMatch(update, /recusada_em|recusada_por|motivo_recusa/);
  assert.match(definitive, /v\.id,v\.status,'recusada'/);
  assert.match(definitive, /set_config\('ro\.aprovacao_rpc','1',true\)/);
  assert.match(definitive, /for update/);
  assert.match(definitive, /v\.aprovador_id is distinct from auth\.uid\(\)/);
  assert.match(definitive, /ro_is_approval_candidate\(auth\.uid\(\)\)/);
  assert.match(definitive, /v\.aprovacao_status<>'pendente' or v\.status<>'solicitada'/);
});

test("constraint separa origens e trigger mantém proteção terminal", () => {
  assert.match(definitive, /status = 'recusada'[\s\S]*?aprovacao_status is distinct from 'reprovada'[\s\S]*?recusada_em is not null and recusada_por is not null[\s\S]*?motivo_recusa is not null/);
  assert.match(definitive, /status = 'recusada'[\s\S]*?aprovacao_status = 'reprovada'[\s\S]*?aprovador_id is not null and reprovado_em is not null[\s\S]*?motivo_reprovacao_aprovador is not null[\s\S]*?recusada_em is null and recusada_por is null and motivo_recusa is null/);
  assert.match(definitive, /current_setting\('ro\.recusa_rpc',true\)[\s\S]*?or coalesce\(current_setting\('ro\.aprovacao_rpc',true\)/);
  assert.match(definitive, /old\.status='recusada' then raise exception 'SOLICITACAO_RECUSADA_IMUTAVEL'/);
  assert.match(definitive, /if tg_op='INSERT'[\s\S]*?RECUSA_SOMENTE_PELA_RPC/);
  assert.match(definitive, /SOLICITACAO_ORIGEM_INVALIDA/);
  assert.doesNotMatch(definitive, /create trigger|ro\.recusa_rpc','1'|213b7005-007d-4070-96a8-c77d00786843/i);
});

test("interface diferencia reprovação da recusa RO sem quebrar refazer e filtros", async () => {
  const {statusPertenceAoFiltro} = await import("../src/solicitacoesFilters.ts");
  assert.equal(statusPertenceAoFiltro("recusada", ["solicitada"]), false);
  assert.equal(statusPertenceAoFiltro("recusada", ["em_andamento"]), false);
  assert.equal(statusPertenceAoFiltro("recusada", ["recusada"]), true);
  assert.match(page, /row\.aprovacao_status === "reprovada" \? "Reprovada pelo aprovador"/);
  assert.match(page, /row\.status === "recusada" && row\.aprovacao_status !== "reprovada" && <section/);
  assert.match(page, /row\.status === "recusada" && row\.solicitante_id === userId/);
  assert.match(page, /t="Reprovada em" v=\{dataHora\(row\.reprovado_em\)\}/);
});

test("correção preserva vínculo, elegibilidade, pendência e grants mínimos", () => {
  assert.match(fix, /v\.aprovador_id is distinct from auth\.uid\(\)/);
  assert.match(fix, /ro_is_approval_candidate\(auth\.uid\(\)\)/);
  assert.match(fix, /v\.aprovacao_status<>'pendente'/);
  assert.match(fix, /set_config\('ro\.aprovacao_rpc','1',true\)/);
  assert.match(fix, /revoke all[\s\S]*from public,anon/);
  assert.match(fix, /grant execute[\s\S]*to authenticated/);
  assert.doesNotMatch(fix, /drop trigger|disable trigger|create policy|alter policy/);
});

test("erros técnicos de aprovação recebem mensagem segura", () => {
  const technical = approvalDecisionErrorMessage("RECUSA_SOMENTE_PELA_RPC");
  assert.equal(technical, "Não foi possível registrar a reprovação. Atualize a página e tente novamente.");
  assert.doesNotMatch(technical, /RECUSA_SOMENTE_PELA_RPC/);
  assert.equal(approvalDecisionErrorMessage("erro interno desconhecido"), "Não foi possível concluir a análise da solicitação. Tente novamente.");
  assert.match(page, /setErro\(approvalDecisionErrorMessage\(error\.message\)\)/);
});
