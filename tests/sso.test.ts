import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
test("card bloqueia clique duplo e navega por redirect_url", () => {
  assert.match(portal, /started\.current/);
  assert.match(portal, /disabled=\{opening\}/);
  assert.match(portal, /globalThis\.location\.assign/);
});
