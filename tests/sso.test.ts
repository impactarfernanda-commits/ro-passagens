import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configuredObrasOrigin, finalObrasUrl, validObrasCallbackUrl } from "../src/obrasBootstrap.ts";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const migration=read("supabase/migrations/202608100002_sso_portal_obras_control.sql");
const start=read("supabase/functions/obras-sso-start/index.ts");
const exchange=read("supabase/functions/obras-sso-exchange/index.ts");
const http=read("supabase/functions/_shared/sso-http.ts");
const portal=read("src/Portal.tsx");
const code="a".repeat(43), obrasOrigin="https://obras-control-demo.vercel.app";

test("handoff e opaco, hasheado, curto e de uso unico",()=>{
  assert.match(http,/Uint8Array\(32\)/);assert.match(http,/SHA-256/);assert.match(http,/60_000/);
  assert.match(migration,/consumed_at is null[\s\S]*expires_at > now\(\)/);
  assert.doesNotMatch(start,/access_token|refresh_token/);
});
test("start valida usuario, acesso, target e return_path",()=>{
  assert.match(start,/auth\.getUser/);assert.match(start,/user_roles/);assert.match(http,/target_app/);assert.match(http,/RETURN_PATHS\.has/);
});
test("exchange gera somente token hash backend para o usuario do handoff",()=>{
  assert.match(exchange,/getUserById/);assert.match(exchange,/generateLink\(\{ type: "magiclink", email \}\)/);assert.doesNotMatch(exchange,/access_token|refresh_token/);
});
test("clique mantem Portal enquanto prepara URL e mostra loading",()=>{
  assert.match(portal,/await Promise\.race/);assert.match(portal,/Abrindo Obras Control\.\.\./);assert.match(portal,/setOpening\(true\)/);
  assert.ok(portal.indexOf("startObrasSso(returnPath)")<portal.indexOf("location.assign(redirectUrl)"));
});
test("clique duplicado e timeout sao bloqueados e retry permanece",()=>{
  assert.match(portal,/if\(opening\)return/);assert.match(portal,/disabled=\{opening\}/);assert.match(portal,/15_000/);assert.match(portal,/onClick=\{openObras\}>Tentar novamente/);
});
test("falha permanece no Portal sem navegacao tardia",()=>{
  assert.match(portal,/currentAttempt!==attempt\.current/);assert.match(portal,/reset\(\);setError\(true\)/);
});
test("Portal navega top-level para callback absoluto validado do Obras",()=>{
  const callback=`${obrasOrigin}/sso/callback?code=${code}`;
  assert.equal(validObrasCallbackUrl(callback,obrasOrigin),true);assert.match(portal,/location\.assign\(redirectUrl\)/);
});
test("callback relativo, arbitrario ou com parametros extras e rejeitado",()=>{
  for(const value of [`/sso/callback?code=${code}`,`https://evil.example/sso/callback?code=${code}`,`${obrasOrigin}/sso/callback?code=${code}&portal_bootstrap=1`]) assert.equal(validObrasCallbackUrl(value,obrasOrigin),false);
});
test("Portal nao cria iframe, postMessage, prefetch ou consumo antecipado",()=>{
  assert.doesNotMatch(portal,/<iframe|postMessage|prefetch|portal_bootstrap|obras-sso-exchange|verifyOtp/);
});
test("return_path seguro continua produzindo URL absoluta sem open redirect",()=>{
  assert.equal(finalObrasUrl(obrasOrigin,"/alocacoes"),obrasOrigin+"/alocacoes");
  for(const unsafe of ["https://evil.example","//evil.example","javascript:alert(1)"])assert.equal(finalObrasUrl(obrasOrigin,unsafe),null);
});
test("defaults de producao permanecem Vercel e local continua configuravel",()=>{
  assert.equal(configuredObrasOrigin(),obrasOrigin);assert.equal(configuredObrasOrigin("http://localhost:3000/path"),"http://localhost:3000");
  assert.doesNotMatch(read(".env.example"),/tanksbr\.com\.br/);
});
test("retorno sem sessao mostra erro e nao inicia SSO automaticamente",()=>{
  assert.match(portal,/obras_auth_failed/);assert.match(portal,/Não foi possível concluir a autenticação no Obras Control/);
  assert.equal((portal.match(/startObrasSso\(returnPath\)/g)??[]).length,1);
});
