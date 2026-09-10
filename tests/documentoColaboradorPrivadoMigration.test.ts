import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const path = "supabase/migrations/202609100001_corrige_documentos_colaborador_privado.sql";
const sql = fs.readFileSync(path, "utf8");

test("migration versiona somente a função privada pré-operacional", () => {
  assert.match(sql, /create or replace function public\.ro_criar_solicitacao_colaborador_validada_pre_operacional\s*\(/i);
  assert.doesNotMatch(sql, /create or replace function public\.ro_criar_solicitacao_validada_pre_operacional\s*\(/i);
  assert.doesNotMatch(sql, /DOCUMENTO_EXTERNO_NAO_SUPORTADO/);
});

test("documento privado valida objeto, proprietário, caminho, PDF e tamanho", () => {
  assert.match(sql, /from storage\.objects/);
  assert.match(sql, /bucket_id='ro-documentos-internos'/);
  assert.match(sql, /owner_id::text=auth\.uid\(\)::text/);
  assert.match(sql, /not like v_id::text\|\|'\/'\|\|\(v_doc->>'categoria'\)\|\|'\/%'/);
  assert.match(sql, /storage\.extension\(v_obj\.name\).*'pdf'/s);
  assert.match(sql, />10485760/);
});

test("metadados entram antes da solicitação e preservam vínculo privado", () => {
  const documento = sql.indexOf("insert into public.ro_passagem_documentos_internos");
  const solicitacao = sql.indexOf("insert into public.ro_passagem_solicitacoes");
  assert.ok(documento >= 0 && documento < solicitacao);
  assert.match(sql, /id,colaborador_id,funcionario_id,obra_id/);
  assert.match(sql, /v_id,v_colaborador,v_funcionario/);
});

test("migration mantém as duas auditorias exigidas", () => {
  assert.match(sql, /solicitacao_colaborador_privado_criada/);
  assert.match(sql, /documento_interno_anexado/);
});

test("função permanece security definer e executável somente por service_role", () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path=public,storage,pg_temp/);
  assert.match(sql, /revoke all on function[\s\S]*from public,anon,authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/i);
});
