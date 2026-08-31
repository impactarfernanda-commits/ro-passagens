import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("src/pages.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260831123435_amplia_leitura_e_historico_aprovacoes.sql", "utf8");

test("orientações da compra usam o campo persistido e preservam quebras", () => {
  assert.match(page, /orientacoesRo=\{row\.observacoes_ro\}/);
  assert.match(page, /Orientações da equipe RO/);
  assert.match(fs.readFileSync("src/styles.css", "utf8"), /purchase-guidance[\s\S]*white-space:pre-wrap/);
});

test("listagem geral não restringe leitura ao solicitante no frontend", () => {
  assert.doesNotMatch(page, /q\.eq\("solicitante_id", userId\)/);
  assert.match(migration, /for select\s+to authenticated[\s\S]*ro_is_active_internal_user\(\)/i);
});

test("ampliação de banco não concede escrita", () => {
  assert.doesNotMatch(migration, /for\s+(insert|update|delete|all)/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete|all)/i);
});

test("usuário inativo, banido ou anônimo falha fechado", () => {
  assert.match(migration, /u\.deleted_at is null/);
  assert.match(migration, /u\.banned_until is null or u\.banned_until<=now\(\)/);
  assert.match(migration, /is_anonymous/);
});

test("fila e histórico separam pendentes das decisões próprias", () => {
  assert.match(page, /Pendentes da minha aprovação/);
  assert.match(page, /Minhas aprovações/);
  assert.match(page, /\.eq\("aprovador_id", userId\)/);
  assert.match(page, /\.in\("aprovacao_status", \["aprovada", "reprovada"\]\)/);
  assert.match(page, /r\.aprovacao_status === "aprovada" \? r\.aprovado_em : r\.reprovado_em/);
});

test("recusa operacional não entra no histórico de aprovação", () => {
  assert.doesNotMatch(page, /\.in\("aprovacao_status", \[[^\]]*recusada/);
  assert.match(page, /\["aprovada", "reprovada"\]/);
});

test("anexos e Storage continuam condicionados à solicitação visível", () => {
  const attachments = fs.readFileSync("supabase/migrations/202607170003_ro_passagem_anexos.sql", "utf8");
  assert.match(attachments, /create policy ro_anexos_select[\s\S]*exists \([\s\S]*from public\.ro_passagem_solicitacoes/i);
  assert.match(attachments, /create policy ro_storage_select[\s\S]*bucket_id = 'ro-passagem-anexos'[\s\S]*from public\.ro_passagem_solicitacoes/i);
});
