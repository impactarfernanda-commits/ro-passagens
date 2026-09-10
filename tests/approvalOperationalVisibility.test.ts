import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { approvalStatusLabel, approvalWaitingLabel, isApprovalOperationallyReleased, matchesApprovalFilter } from "../src/approvalVisibility.ts";

const migration = fs.readFileSync("supabase/migrations/202608250001_visibilidade_operacional_aprovacoes_pendentes.sql", "utf8");
const page = fs.readFileSync("src/pages.tsx", "utf8");

test("RLS dá visibilidade ampla sem concedê-la genericamente a autenticados", () => {
  assert.match(migration, /or public\.ro_can_view_all\(\)/);
  assert.doesNotMatch(migration, /ro_can_view_all\(\)[\s\S]*aprovacao_status is distinct from 'pendente'/);
  assert.match(migration, /solicitante_id=\(select auth\.uid\(\)\)/);
  assert.match(migration, /aprovador_id=\(select auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)/i);
});

test("migration altera somente a policy de SELECT", () => {
  assert.doesNotMatch(migration, /\b(insert|update|delete|alter table|create trigger|create or replace function)\b/i);
  assert.match(migration, /create policy ro_sol_select[\s\S]*for select[\s\S]*to authenticated/i);
});

test("filtro trata legado sem estado como dispensado", () => {
  assert.equal(approvalStatusLabel(undefined), "Dispensada");
  assert.equal(matchesApprovalFilter(undefined, "dispensada"), true);
  assert.equal(matchesApprovalFilter("pendente", "aprovada"), false);
});

test("indicador de espera usa horas e dias", () => {
  const now = Date.parse("2026-08-25T12:00:00Z");
  assert.equal(approvalWaitingLabel("2026-08-25T06:00:00Z", now), "Pendente há 6h");
  assert.equal(approvalWaitingLabel("2026-08-24T12:00:00Z", now), "Pendente há 1 dia");
  assert.equal(approvalWaitingLabel("2026-08-22T12:00:00Z", now), "Pendente há 3 dias");
});

test("pendente e reprovada continuam não operáveis", () => {
  assert.equal(isApprovalOperationallyReleased("pendente"), false);
  assert.equal(isApprovalOperationallyReleased("reprovada"), false);
  assert.equal(isApprovalOperationallyReleased("aprovada"), true);
  assert.equal(isApprovalOperationallyReleased("dispensada"), true);
  assert.equal(isApprovalOperationallyReleased(undefined), true);
});

test("pendente mantém ações visíveis, desabilitadas e identifica o aprovador", () => {
  assert.match(page, /function AcoesOperacionaisBloqueadas/);
  assert.match(page, /Aguardando aprovação de \$\{aprovador \|\| "Aprovador sem identificação"\}/);
  assert.match(page, /As ações operacionais serão liberadas após a aprovação\./);
  assert.match(page, /Assumir solicitação<\/button>/);
  assert.match(page, /Registrar\/comprar passagem<\/button>/);
  assert.match(page, /className="btn primary" disabled>Assumir solicitação/);
});

test("pendência do coordenador exige status operacional solicitado", () => {
  assert.match(page, /q\.eq\("aprovacao_status", "pendente"\)\.eq\("status", "solicitada"\)/);
  assert.match(page, /const aprovacaoPendenteAtiva = row\.status === "solicitada" && row\.aprovacao_status === "pendente"/);
  assert.match(page, /row\.status === "solicitada" && row\.aprovador_id === userId && row\.aprovacao_status === "pendente"/);
});

test("recusa operacional não parece continuar aguardando aprovação", () => {
  assert.match(page, /Interrompida por recusa RO/);
  assert.match(page, /Solicitação encerrada por recusa operacional\./);
  assert.match(page, /\{aprovacaoPendenteAtiva && <DT t="Tempo aguardando"/);
});

test("reprovada mantém ações operacionais desabilitadas e motivo visível", () => {
  assert.match(page, /Solicitação reprovada na etapa de aprovação\./);
  assert.match(page, /Motivo: \{row\.motivo_reprovacao_aprovador\}/);
  assert.match(page, /row\.aprovacao_status !== "reprovada"/);
  assert.match(page, /disabled>Lançar passagem complementar/);
});

test("aprovada e dispensada usam as ações normais conforme permissões", () => {
  assert.equal(isApprovalOperationallyReleased("aprovada"), true);
  assert.equal(isApprovalOperationallyReleased("dispensada"), true);
  assert.match(page, /access\.canOperateRO && operacaoLiberada/);
  assert.match(page, /<Assumir row=\{row\} onDone=\{load\}/);
  assert.match(page, /<Compra row=\{row\} onDone=\{load\}/);
});

test("backend mantém bloqueio direto e decisão exclusiva do aprovador", () => {
  const pacote1 = fs.readFileSync("supabase/migrations/202608210001_pacote_1_aprovadores_individuais_denise.sql", "utf8");
  assert.match(pacote1, /SOLICITACAO_AGUARDANDO_APROVACAO/);
  assert.match(pacote1, /s\.aprovacao_status in\('pendente','reprovada'\)/);
  assert.match(pacote1, /v\.aprovador_id is distinct from auth\.uid\(\)/);
  assert.doesNotMatch(migration, /create policy[\s\S]*for update/i);
});

test("RO e outro coordenador não recebem poder de aprovação pela UX", () => {
  assert.match(page, /row\.status === "solicitada" && row\.aprovador_id === userId && row\.aprovacao_status === "pendente"/);
  assert.doesNotMatch(page, /access\.(?:canOperateRO|canViewAll)[^\n]*<AprovacaoIndividual/);
});

test("grade resolve aprovador, filtra e destaca pendências", () => {
  assert.match(page, /flatMap\(\(r\) => \[r\.solicitante_id, responsavelId\(r\), r\.aprovador_id\]\)/);
  assert.match(page, /Todas as aprovações/);
  assert.match(page, /Aguardando aprovação de/);
  assert.match(page, /approval-awaiting/);
  assert.match(page, /operacaoLiberada/);
});
