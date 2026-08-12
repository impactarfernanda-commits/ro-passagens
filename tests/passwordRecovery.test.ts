import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const login = fs.readFileSync("src/pages.tsx", "utf8");
const page = fs.readFileSync("src/PasswordRecovery.tsx", "utf8");
const auth = fs.readFileSync("src/auth.ts", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const sso = fs.readFileSync("src/sso.ts", "utf8");

test("login oferece recuperação com e-mail obrigatório e retorno", () => {
  assert.match(login, /Esqueci minha senha/);
  assert.match(login, /Enviar link de recuperação/);
  assert.match(login, /Voltar para entrar/);
  assert.match(login, /type="email"[\s\S]*required/);
});

test("envio usa API oficial, redirect dedicado e resposta anti-enumeração", () => {
  assert.match(login, /resetPasswordForEmail\(email, \{ redirectTo: PASSWORD_RECOVERY_REDIRECT \}\)/);
  assert.match(auth, /\/redefinir-senha/);
  assert.match(auth, /Se houver uma conta vinculada a este e-mail/);
  assert.match(login, /isRateLimitError/);
  assert.doesNotMatch(login, /E-mail não cadastrado/);
});

test("rota pública aceita implicit, code e token_hash sem afetar callback SSO", () => {
  assert.match(app, /location\.pathname === "\/redefinir-senha"/);
  assert.match(page, /PASSWORD_RECOVERY/);
  assert.match(page, /exchangeCodeForSession\(params\.code\)/);
  assert.match(page, /verifyOtp\(\{ token_hash: params\.tokenHash, type: "recovery" \}\)/);
  assert.match(page, /clearRecoveryUrl\(\)/);
  assert.match(sso, /redirect\.pathname !== "\/sso\/callback"/);
});

test("nova senha preserva mínimo, confirmação, envio único e payload mínimo", () => {
  assert.match(page, /password\.length < PASSWORD_MIN_LENGTH/);
  assert.match(page, /password !== confirmation/);
  assert.match(page, /if \(busy\) return/);
  assert.match(page, /updateUser\(\{ password \}\)/);
  assert.doesNotMatch(page, /console\./);
});

test("sucesso encerra sessão e erros não expõem detalhes técnicos", () => {
  assert.match(page, /await supabase\.auth\.signOut\(\)/);
  assert.match(auth, /Senha redefinida com sucesso\. Entre com sua nova senha\./);
  assert.match(auth, /Este link de recuperação é inválido ou expirou/);
  assert.match(page, /Solicitar novo link/);
});

test("sessão de recuperação fica confinada à rota pública", () => {
  assert.match(app, /recoveryOnly && location\.pathname !== "\/redefinir-senha"/);
  assert.match(app, /event === "SIGNED_OUT"/);
});
