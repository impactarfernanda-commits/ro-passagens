import test from "node:test";
import assert from "node:assert/strict";
import { handleSsoExchange, handleSsoStart, type ExchangeDependencies, type StartDependencies } from "../supabase/functions/_shared/sso-http.ts";

const portalOrigin = "https://portal-tks-br.vercel.app";
const obrasOrigin = "https://obras-control-demo.vercel.app";
const validCode = "A".repeat(43);
const startDeps = (overrides: Partial<StartDependencies> = {}): StartDependencies => ({
  authenticate: async () => "user-1", canAccessObras: async () => true,
  persistHandoff: async () => undefined, obrasOrigin, ...overrides,
});
const exchangeDeps = (overrides: Partial<ExchangeDependencies> = {}): ExchangeDependencies => ({
  consumeHandoff: async () => ({ user_id: "user-1", return_path: "/alocacoes" }),
  getUserEmail: async () => "user@example.com",
  generateTokenHash: async () => "hashed-token-only-in-body", ...overrides,
});
const request = (url: string, method: string, origin: string, body?: unknown, authorization?: string) =>
  new Request(url, { method, headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(authorization ? { authorization } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const assertCors = (response: Response, origin: string) => {
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "authorization, x-client-info, apikey, content-type");
};

test("START OPTIONS retorna 204 antes de autenticação, body ou dependências", async () => {
  let called = false;
  const response = await handleSsoStart(request("https://edge.test/start", "OPTIONS", portalOrigin), startDeps({ authenticate: async () => { called = true; throw new Error("não deveria executar"); } }));
  assert.equal(response.status, 204); assert.equal(await response.text(), ""); assert.equal(called, false); assertCors(response, portalOrigin);
});
test("START sem JWT retorna 401 controlado com CORS", async () => {
  const response = await handleSsoStart(request("https://edge.test/start", "POST", portalOrigin, { target_app: "obras-control", return_path: "/alocacoes" }), startDeps());
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "AUTH_REQUIRED" }); assertCors(response, portalOrigin);
});
test("EXCHANGE OPTIONS retorna 204 sem body, JWT ou dependências", async () => {
  let called = false;
  const response = await handleSsoExchange(request("https://edge.test/exchange", "OPTIONS", obrasOrigin), exchangeDeps({ consumeHandoff: async () => { called = true; throw new Error("não deveria executar"); } }));
  assert.equal(response.status, 204); assert.equal(await response.text(), ""); assert.equal(called, false); assertCors(response, obrasOrigin);
});
test("EXCHANGE não exige Authorization e código malformado retorna 400 com CORS", async () => {
  const response = await handleSsoExchange(request("https://edge.test/exchange", "POST", obrasOrigin, { code: "curto" }), exchangeDeps());
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "SSO_CODE_INVALID" }); assertCors(response, obrasOrigin);
});
for (const condition of ["inexistente", "expirado", "consumido"]) {
  test(`EXCHANGE código ${condition} retorna 400 estável, nunca 500`, async () => {
    const response = await handleSsoExchange(request("https://edge.test/exchange", "POST", obrasOrigin, { code: validCode }), exchangeDeps({ consumeHandoff: async () => null }));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "SSO_CODE_INVALID" }); assertCors(response, obrasOrigin);
  });
}
test("erro administrativo verdadeiro retorna 500 genérico e CORS", async () => {
  const response = await handleSsoExchange(request("https://edge.test/exchange", "POST", obrasOrigin, { code: validCode }), exchangeDeps({ consumeHandoff: async () => { throw new Error("database unavailable"); } }));
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: "SSO_EXCHANGE_FAILED" }); assertCors(response, obrasOrigin);
});
test("respostas e logs de erro não expõem nonce, hashes, JWT ou tokens", async () => {
  const logs: unknown[] = [], jwt = "eyJ" + "x".repeat(60), secret = "S".repeat(43);
  const response = await handleSsoExchange(request("https://edge.test/exchange", "POST", obrasOrigin, { code: validCode }), exchangeDeps({
    consumeHandoff: async () => { throw Object.assign(new Error(`token_hash=${secret} authorization=${jwt}`), { code: "DB_ERROR", status: 503 }); },
    log: (entry) => logs.push(entry),
  }));
  const publicBody = await response.text(), logBody = JSON.stringify(logs);
  for (const forbidden of [validCode, secret, jwt, "token_hash", "authorization="]) {
    assert.doesNotMatch(publicBody, new RegExp(forbidden)); assert.doesNotMatch(logBody, new RegExp(forbidden));
  }
  assert.match(logBody, /sso_exchange/); assert.match(logBody, /DB_ERROR/); assert.match(logBody, /503/);
});
