import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const privateStore = fs.readFileSync("src/novaSolicitacaoDraftPrivate.ts", "utf8");
const page = fs.readFileSync("src/pages.tsx", "utf8");

test("IndexedDB privado isola registro por referência e usuário", () => {
  assert.match(privateStore, /indexedDB\.open/);
  assert.match(privateStore, /record\?\.userId === userId/);
  assert.doesNotMatch(privateStore, /localStorage|console\./);
});

test("PDF só entra no IndexedDB depois das validações atuais", () => {
  assert.match(page, /validatePdfFile\(file\) \|\| await validatePdfSignature\(file\)[\s\S]*if \(validacao\)[\s\S]*saveDraftDocument/);
  assert.match(page, /validatePdfFile\(documento\) \|\| await validatePdfSignature\(documento\)/);
});

test("arquivo restaurado recompõe File e referência ausente não quebra", () => {
  assert.match(page, /privateData\?\.documento && parsed\.documento/);
  assert.match(page, /new File\(\[privateData\.documento\], parsed\.documento\.nome/);
  assert.match(page, /readDraftPrivate\(ref, userId\)\.catch\(\(\) => null\)/);
});

test("falhas de upload ou RPC preservam o IndexedDB", () => {
  const submit = page.slice(page.indexOf("async function submit"), page.indexOf("function cancel"));
  const cleanup = submit.indexOf("deleteDraftPrivate(privateRef)");
  assert.ok(cleanup > submit.indexOf("if (error)"));
  assert.doesNotMatch(submit.slice(0, cleanup), /deleteDraftPrivate\(privateRef\)/);
});

test("desmontagem faz flush do estado textual mais recente", () => {
  assert.match(page, /latestDraftRef\.current[\s\S]*return \(\) =>[\s\S]*localStorage\.setItem\(draftKey, serializeDraft\(latest\)\)/);
});

test("limpeza por expiração usa cursor limitado ao store privado", () => {
  assert.match(privateStore, /openCursor\(\)/);
  assert.match(privateStore, /now - updatedAt > maxAgeMs/);
  assert.match(page, /cleanupExpiredDraftPrivate\(NOVA_SOLICITACAO_DRAFT_MAX_AGE_MS\)/);
});
