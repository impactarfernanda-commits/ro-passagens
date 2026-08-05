import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/pages.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const shared = page.slice(page.indexOf("function ResponsibleAdminSection"), page.indexOf("export function ConfiguracoesRH"));
const rh = page.slice(page.indexOf("export function ConfiguracoesRH"), page.indexOf("type AbaConfiguracoes"));
const ro = page.slice(page.indexOf("export function Responsaveis"));

test("RO e RH reutilizam o mesmo componente administrativo", () => {
  assert.match(ro, /<ResponsibleAdminSection/);
  assert.match(rh, /<ResponsibleAdminSection/);
  assert.match(shared, /className="card add-ro"/);
  assert.match(shared, /className="card ro-list"/);
});

test("card superior compartilhado contém seletor e botão Adicionar", () => {
  assert.match(shared, /type="search"[\s\S]*?placeholder="Selecione um usuário"/);
  assert.match(shared, /<datalist[\s\S]*?<option/);
  assert.match(shared, /<button className="btn primary"[\s\S]*?Adicionar/);
  assert.match(shared, /disabled=\{!selected \|\| loading \|\| busy !== null\}/);
  assert.doesNotMatch(rh, /Pesquisar usuário cadastrado/);
});

test("seletor RH preserva a fonte e pesquisa por nome ou e-mail", () => {
  assert.match(rh, /ro_admin_user_search/);
  assert.match(rh, /p_search:busca/);
  assert.match(rh, /onSearch=\{setBusca\}/);
  assert.match(shared, /user\.full_name, user\.email/);
  assert.match(shared, /users\.filter\(\(user\) => !selectedIds\.has\(user\.id\)\)/);
});

test("adição RH usa apenas ro_rh_responsaveis, evita duplicidade e limpa seleção", () => {
  assert.match(rh, /supabase\.from\("ro_rh_responsaveis"\)\.upsert/);
  assert.doesNotMatch(rh, /supabase\.from\("ro_responsaveis"\)/);
  assert.match(rh, /!rh\.some\(\(row\)=>row\.user_id===selectedRh\)/);
  assert.match(rh, /if\(!error&&busyId==="add"\)setSelectedRh\(""\)/);
});

test("lista compartilhada mostra nome, status e ação equivalentes ao RO", () => {
  assert.match(shared, /<strong>\{label\}<\/strong><small>/);
  assert.match(shared, /Responsável ativo/);
  assert.match(shared, /Responsável inativo/);
  assert.match(shared, /"Inativar" : "Reativar"/);
  assert.match(shared, /className=\{`btn \$\{row\.ativo \? "danger" : "secondary"\}`\}/);
});

test("operações RH bloqueiam duplo clique e expõem estado acessível", () => {
  assert.match(rh, /if\(rhBusy\)return/);
  assert.match(shared, /aria-busy=/);
  assert.match(shared, /disabled=\{busy !== null\}/);
  assert.match(shared, /aria-label=/);
  assert.match(shared, /htmlFor="responsible-user-select"/);
});

test("lista vazia e carregamento RH são apresentados", () => {
  assert.match(rh, /emptyText="Nenhum responsável RH cadastrado\."/);
  assert.match(shared, /loading \? <Spinner \/>/);
  assert.match(shared, /<Empty text=\{emptyText\} \/>/);
});

test("layout compartilhado responde em telas menores sem sobreposição", () => {
  assert.match(styles, /@media\(max-width:650px\)\{\.add-ro\{[^}]*flex-wrap:wrap/);
  assert.match(styles, /\.ro-list>div\{[^}]*align-items:flex-start/);
  assert.match(styles, /\.add-ro select,\.add-ro input\{[^}]*min-width:0/);
});

test("chamadas Supabase de responsáveis não foram duplicadas", () => {
  assert.equal((rh.match(/from\("ro_rh_responsaveis"\)/g) || []).length, 2);
  assert.equal((rh.match(/rpc\("ro_admin_user_search"/g) || []).length, 1);
  assert.equal((ro.match(/from\("ro_responsaveis"\)/g) || []).length, 3);
});
