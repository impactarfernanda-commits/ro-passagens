import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync("src/App.tsx", "utf8");
const logout = fs.readFileSync("src/Logout.tsx", "utf8");

test("rota /logout é pública e não renderiza conteúdo autenticado", () => {
  const logoutRoute = app.indexOf('location.pathname === "/logout"');
  const authenticatedContent = app.indexOf("if (!session) return <Login />");
  assert.ok(logoutRoute > 0);
  assert.ok(logoutRoute < authenticatedContent);
  assert.match(app, /<Logout clearLocalAuthState=\{clearLocalAuthState\}/);
});

test("logout encerra apenas a sessão local e limpa o estado autenticado", () => {
  assert.match(logout, /signOut\(\{ scope: "local" \}\)/);
  assert.match(logout, /sessionStorage\.removeItem\("portal-password-recovery"\)/);
  assert.match(logout, /clearLocalAuthState\(\)/);
  assert.match(app, /setSession\(null\)/);
  assert.match(app, /setAccess\(EMPTY_ACCESS\)/);
});

test("logout é idempotente, usa destino fixo e replace", () => {
  assert.match(logout, /if \(started\.current\) return/);
  assert.match(logout, /navigate\("\/", \{ replace: true \}\)/);
  assert.doesNotMatch(logout, /redirect|returnUrl|searchParams/);
});

test("falha de signOut também termina no login sem delay", () => {
  assert.match(logout, /try \{[\s\S]*await supabase\.auth\.signOut[\s\S]*\} finally \{/);
  assert.doesNotMatch(logout, /setTimeout|setInterval/);
});
