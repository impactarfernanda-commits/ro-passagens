import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { finalObrasUrl, isTrustedObrasMessage, OBRAS_ERROR_MESSAGE, OBRAS_READY_MESSAGE, obrasBootstrapUrl } from "../src/obrasBootstrap.ts";
const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const migration = read("supabase/migrations/202608100002_sso_portal_obras_control.sql");
const dry = read("supabase/manual/DRY_RUN_202608100002_sso_portal_obras_control.sql");
const start = read("supabase/functions/obras-sso-start/index.ts");
const exchange = read("supabase/functions/obras-sso-exchange/index.ts");
const http = read("supabase/functions/_shared/sso-http.ts");
const portal = read("src/Portal.tsx");
test("migration e dry run contêm a infraestrutura SSO e rollback", () => {
  for (const marker of ["portal_sso_handoffs", "portal_consumir_sso_handoff", "enable row level security", "revoke all"])
    assert.match(migration, new RegExp(marker, "i"));
  assert.match(dry, /^begin;/i);
  assert.match(dry, /rollback;\s*$/i);
  assert.doesNotMatch(dry, /\bcommit\b/i);
});
test("handoff é opaco, curto, hasheado e de uso único", () => {
  assert.match(http, /Uint8Array\(32\)/);
  assert.match(http, /SHA-256/);
  assert.match(http, /60_000/);
  assert.doesNotMatch(start, /access_token|refresh_token/);
  assert.match(migration, /consumed_at is null[\s\S]*expires_at > now\(\)/);
});
test("start valida identidade, autorização, target e retorno", () => {
  assert.match(start, /auth\.getUser/);
  assert.match(start, /user_roles/);
  assert.match(http, /target_app/);
  assert.match(http, /RETURN_PATHS\.has/);
});
test("exchange usa usuário backend, generateLink e retorna só token hash", () => {
  assert.match(exchange, /getUserById/);
  assert.match(exchange, /generateLink\(\{ type: "magiclink", email \}/);
  assert.match(exchange, /properties\?\.hashed_token/);
  assert.doesNotMatch(exchange, /access_token|refresh_token/);
});
test("card bloqueia clique duplo e aguarda o ready antes de navegar", () => {
  assert.match(portal, /started\.current/);
  assert.match(portal, /disabled=\{opening\}/);
  assert.match(portal, /<iframe/);
  assert.match(portal, /event\.source!==iframe\.current\?\.contentWindow/);
  assert.match(portal, /event\.data\.type!==OBRAS_READY_MESSAGE/);
  assert.match(portal, /globalThis\.location\.assign/);
  assert.ok(portal.indexOf("event.data.type!==OBRAS_READY_MESSAGE") < portal.indexOf("globalThis.location.assign"));
});
test("Portal nunca inicia o SSO automaticamente por query string, login ou refresh", () => {
  assert.equal((portal.match(/startObrasSso\(returnPath\)/g) ?? []).length, 1);
  assert.doesNotMatch(portal, /params\.get\(['"]app['"]\)/);
  assert.doesNotMatch(portal, /app['"]?\s*===?\s*['"]obras-control/);
});
test("somente o clique no card de Alocacao inicia o SSO uma vez", () => {
  assert.match(portal, /onClick=\{openObras\}/);
  assert.match(portal, /if\(started\.current\)return/);
  assert.equal((portal.match(/startObrasSso\(returnPath\)/g) ?? []).length, 1);
});
test("card de Passagens permanece interno e nao chama SSO", () => {
  assert.match(portal, /<Link[^>]+to="\/solicitacoes"/);
  const passagesCard = portal.match(/<Link[\s\S]*?<\/Link>/)?.[0] ?? "";
  assert.doesNotMatch(passagesCard, /openObras|startObrasSso/);
});
test("return_path seguro fica preservado para o clique posterior", () => {
  assert.match(portal, /safeObrasReturnPath\(params\.get\(['"]return_path['"]\)\)/);
  assert.match(portal, /startObrasSso\(returnPath\)/);
});
test("bootstrap marca o callback sem expor tokens", () => {
  const url=obrasBootstrapUrl("https://obras-control-demo.vercel.app/sso/callback?code="+"a".repeat(43));
  assert.equal(new URL(url).searchParams.get("portal_bootstrap"),"1");
  assert.doesNotMatch(url,/access_token|refresh_token/);
});
test("mensagem exige origin do Obras e tipo conhecido", () => {
  const origin="https://obras-control-demo.vercel.app";
  assert.equal(isTrustedObrasMessage({origin:"https://evil.test",data:{type:OBRAS_READY_MESSAGE}},origin),false);
  assert.equal(isTrustedObrasMessage({origin,data:{type:"other"}},origin),false);
  assert.equal(isTrustedObrasMessage({origin,data:{type:OBRAS_READY_MESSAGE}},origin),true);
  assert.equal(isTrustedObrasMessage({origin,data:{type:OBRAS_ERROR_MESSAGE}},origin),true);
});
test("destino final continua canonico e com return_path permitido", () => {
  assert.equal(finalObrasUrl("https://obras-control-demo.vercel.app","/obras"),"https://obras-control-demo.vercel.app/obras");
});
test("timeout, erro e retry devolvem o fluxo ao estado reutilizavel", () => {
  assert.match(portal,/15_000/);
  assert.match(portal,/reset\(\);setError\(true\)/);
  assert.match(portal,/onClick=\{openObras\}>Tentar novamente/);
  assert.match(portal,/setBootstrapUrl\(null\)/);
});
