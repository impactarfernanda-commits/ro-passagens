import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/App.tsx", "utf8");
const access = readFileSync("src/accessCache.ts", "utf8");
const pages = readFileSync("src/pages.tsx", "utf8");
const catalogs = readFileSync("src/catalogCache.ts", "utf8");

test("refresh do token da mesma sessão não invalida as permissões", () => {
  assert.doesNotMatch(app, /TOKEN_REFRESHED[\s\S]{0,100}invalidateAccess/);
  assert.match(app, /loadAccess\(session\)/);
  assert.equal((access.match(/supabase\.(?:from|rpc)\(/g) || []).length, 8);
});

test("mudança de usuário isola catálogos e logout limpa os caches", () => {
  assert.match(catalogs, /activeUserId!==userId\)\{cache\.invalidate\(\);notify\(\)\}/);
  assert.match(app, /event === "SIGNED_OUT"\) invalidateAccess\(\)/);
  assert.match(app, /setCatalogCacheUser\(s\?\.user\.id \|\| null\)/);
});

test("hook usa carregamento compartilhado e mutações invalidam catálogos", () => {
  assert.match(pages, /loadCatalogs\(\)\.then/);
  assert.ok((pages.match(/invalidateCatalogs\(\)/g) || []).length >= 3);
  assert.match(catalogs, /cache\.get\(userId/);
});

test("TTLs, retorno à aba e componentes montados estão conectados", () => {
  assert.match(access, /ACCESS_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(catalogs, /CATALOG_CACHE_TTL_MS=15\*60\*1000/);
  assert.match(app, /subscribeAccessInvalidation/);
  assert.match(app, /subscribeVisible\(document/);
  assert.match(pages, /subscribeCatalogInvalidation/);
  assert.match(pages, /subscribeVisible\(document/);
  assert.match(pages, /editorMessage\?\.kind==="success"\)invalidateCatalogs\(\)/);
});
