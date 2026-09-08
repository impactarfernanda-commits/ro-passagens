import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { registerHooks } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";

// Match Vite's extensionless resolution for the shared validator.
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "./pdfFileValidation" ? "./pdfFileValidation.ts" : specifier, context);
} });
const { appendAttachment, canAddAttachment } = await import("../src/attachmentUpload.ts");
hook.deregister();

const row = { status: "passagem_comprada" as const, excluida_em: null, aprovacao_status: "aprovada" as const, folga_antecipacao_status: null };
test("anexos posteriores exigem operação RO e respeitam todos os bloqueios", () => {
  assert.equal(canAddAttachment(true, row), true);
  assert.equal(canAddAttachment(true, { ...row, status: "finalizada" }), true);
  assert.equal(canAddAttachment(false, row), false);
  for (const status of ["solicitada", "em_andamento", "cancelada", "recusada"] as const)
    assert.equal(canAddAttachment(true, { ...row, status }), false);
  for (const aprovacao_status of ["pendente", "reprovada"] as const)
    assert.equal(canAddAttachment(true, { ...row, aprovacao_status }), false);
  assert.equal(canAddAttachment(true, { ...row, excluida_em: "2026-09-08" }), false);
  assert.equal(canAddAttachment(true, { ...row, folga_antecipacao_status: "pendente" }), false);
  assert.equal(canAddAttachment(true, { ...row, aprovacao_status: undefined }), true);
});

function fakeClient(failure: "upload" | "insert" | "cleanup" | null = null) {
  const records: Record<string, unknown>[] = [{ storage_path: "existing.pdf" }];
  const uploads: string[] = [];
  const removed: string[] = [];
  const client = {
    storage: { from(bucket: string) {
      assert.equal(bucket, "ro-passagem-anexos");
      return {
        async upload(path: string, _file: File, options: unknown) {
          assert.deepEqual(options, { contentType: "application/pdf", upsert: false });
          uploads.push(path);
          return { error: failure === "upload" ? {} : null };
        },
        async remove(paths: string[]) { removed.push(...paths); return { error: failure === "cleanup" ? {} : null }; },
      };
    } },
    from(table: string) {
      assert.equal(table, "ro_passagem_anexos");
      return { async insert(record: Record<string, unknown>) {
        if (failure === "insert" || failure === "cleanup") return { error: {} };
        records.push(record); return { error: null };
      } };
    },
  } as unknown as SupabaseClient;
  return { client, records, uploads, removed };
}
const pdf = () => new File(["%PDF-1.7"], "bilhete.pdf", { type: "application/pdf" });

test("múltiplos PDFs com mesmo nome são acrescentados sem tocar em compra, custos ou anexos existentes", async () => {
  const state = fakeClient();
  await appendAttachment(state.client, "request", "operator", pdf());
  await appendAttachment(state.client, "request", "operator", pdf());
  assert.equal(state.records.length, 3);
  assert.deepEqual(state.records[0], { storage_path: "existing.pdf" });
  assert.equal(new Set(state.uploads).size, 2);
  assert.deepEqual(state.removed, []);
  for (const record of state.records.slice(1)) {
    assert.deepEqual(Object.keys(record).sort(), ["solicitacao_id", "tipo", "nome_arquivo", "storage_path", "mime_type", "tamanho_bytes", "uploaded_by", "criado_por"].sort());
    assert.equal(record.uploaded_by, "operator");
    assert.equal(record.criado_por, "operator");
    assert.equal(record.tipo, "passagem_pdf");
    assert.match(String(record.storage_path), /^request\//);
  }
});

test("validação mantém PDF e limite de 10 MB antes de gravar", async () => {
  const state = fakeClient();
  for (const file of [new File(["x"], "x.png", { type: "image/png" }), new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf")])
    await assert.rejects(appendAttachment(state.client, "request", "operator", file));
  assert.deepEqual(state.uploads, []);
});

test("falhas limpam somente o novo objeto e nunca removem metadados anteriores", async () => {
  for (const failure of ["upload", "insert", "cleanup"] as const) {
    const state = fakeClient(failure);
    await assert.rejects(appendAttachment(state.client, "request", "operator", pdf()), failure === "cleanup" ? /suporte/ : /Não foi possível/);
    assert.deepEqual(state.records, [{ storage_path: "existing.pdf" }]);
    assert.deepEqual(state.removed, failure === "upload" ? [] : state.uploads);
  }
});

test("detalhe recarrega anexos e preserva autoria; UX de compra continua opcional", () => {
  const page = fs.readFileSync("src/pages.tsx", "utf8");
  const component = fs.readFileSync("src/AdicionarAnexo.tsx", "utf8");
  assert.match(page, /canAddAttachments=\{canAddAttachment\(access.canOperateRO, row\)\}/);
  assert.match(page, /AdicionarAnexo solicitacaoId=\{solicitacaoId\} onDone=\{onCostUpdated\}/);
  assert.match(component, /if \(added\) onDone\(\)/);
  assert.match(component, /multiple disabled=\{busy\}/);
  assert.match(page, /anexo.criado_em \|\| anexo.created_at/);
  assert.match(page, /Selecionar PDFs das passagens \(opcional\)/);
  assert.match(page, /PDF\(s\) selecionado\(s\). Confira/);
  assert.doesNotMatch(component, /\.rpc\(|\.update\(|\.delete\(/);
});
