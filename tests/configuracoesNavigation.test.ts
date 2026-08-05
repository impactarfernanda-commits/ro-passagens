import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const components = readFileSync(new URL("../src/components.tsx", import.meta.url), "utf8");
const pages = readFileSync(new URL("../src/pages.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const sidebar = components.slice(components.indexOf("export function Sidebar"), components.indexOf("export function Header"));
const solicitacoes = pages.slice(pages.indexOf("export function Solicitacoes"), pages.indexOf("export function NovaSolicitacao"));
const config = pages.slice(pages.indexOf("type AbaConfiguracoes"), pages.indexOf("export function Detalhe"));

test("menu final mantém Painel, Solicitações, Relatórios e Configurações nessa ordem", () => {
  const labels = ["Painel", "Solicitações", "Relatórios", "Configurações"];
  const positions = labels.map((label) => sidebar.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("menu não contém atalhos administrativos antigos nem Nova solicitação", () => {
  for (const label of ["Nova solicitação", "Responsáveis RO", "Configurações RH", "Importar funcionários", "Importar centros de custo"])
    assert.equal(sidebar.includes(label), false, label);
  for (const route of ["/nova", "/responsaveis", "/configuracoes-rh", "/importacao-funcionarios", "/importacao-centros-custo"])
    assert.equal(sidebar.includes(`to="${route}"`), false, route);
});

test("Configurações usa exclusivamente a autorização da administradora do sistema", () => {
  assert.match(app, /canConfigure=\{access\.canImport\}/);
  assert.match(app, /path="\/configuracoes"[\s\S]*?access\.canImport\s*\?\s*<Configuracoes \/>\s*:\s*<Navigate to="\/painel" replace \/>/);
  assert.match(app, /supabase\.rpc\("ro_is_system_admin"/);
  assert.doesNotMatch(sidebar, /canManageRO|canManageRh|isRO|isRh|role/);
});

test("rota e único botão existente de Nova solicitação permanecem", () => {
  assert.match(app, /path="\/nova"[\s\S]*?<NovaSolicitacao/);
  assert.equal((solicitacoes.match(/Nova solicitação/g) || []).length, 1);
  assert.match(solicitacoes, /to="\/nova"/);
});

test("Configurações possui quatro abas na ordem definida e persiste a seleção na URL", () => {
  const labels = ["Responsáveis RO", "Responsáveis RH", "Calendário da empresa", "Importações"];
  const positions = labels.map((label) => config.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(config, /useSearchParams\(\)/);
  assert.match(config, /new URLSearchParams\(\{ aba: proxima \}\)/);
});

test("abas reutilizam os componentes existentes sem duplicar operações", () => {
  assert.match(config, /<Responsaveis embedded \/>/);
  assert.match(config, /<ConfiguracoesRH secao="rh" \/>/);
  assert.match(config, /<ConfiguracoesRH secao="calendario" \/>/);
  assert.match(config, /<ImportacaoFuncionarios embedded \/>/);
  assert.match(config, /<ImportacaoCentrosCusto embedded \/>/);
  assert.equal((pages.match(/ro_importar_funcionarios/g) || []).length, 1);
  assert.equal((pages.match(/ro_importar_centros_custo_restritos/g) || []).length, 1);
});

test("importações preservam estados independentes ao trocar o tipo", () => {
  assert.match(config, /hidden=\{tipo !== "funcionarios"\}/);
  assert.match(config, /hidden=\{tipo !== "centros-custo"\}/);
  assert.match(config, /tipo: "funcionarios"/);
  assert.match(config, /tipo: "centros-custo"/);
});

test("rotas administrativas antigas redirecionam com replace", () => {
  const redirects = [
    ["/responsaveis", "/configuracoes?aba=responsaveis-ro"],
    ["/configuracoes-rh", "/configuracoes?aba=responsaveis-rh"],
    ["/importacao-funcionarios", "/configuracoes?aba=importacoes&tipo=funcionarios"],
    ["/importacao-centros-custo", "/configuracoes?aba=importacoes&tipo=centros-custo"],
  ];
  for (const [oldRoute, destination] of redirects) {
    const route = app.slice(app.indexOf(`path="${oldRoute}"`));
    assert.match(route.slice(0, 300), new RegExp(`to="${destination.replace(/[?]/g, "\\?")}" replace`));
  }
});

test("abas têm semântica, teclado, foco e comportamento responsivo", () => {
  assert.match(config, /role="tablist"/);
  assert.match(config, /role="tab"/);
  assert.match(config, /aria-selected=/);
  assert.match(config, /role="tabpanel"/);
  assert.match(config, /ArrowLeft/);
  assert.match(config, /ArrowRight/);
  assert.match(styles, /\.settings-tabs\{[^}]*overflow-x:auto/);
  assert.match(styles, /@media\(max-width:650px\).*\.settings-tabs/s);
});
