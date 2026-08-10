import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const config=JSON.parse(readFileSync("vercel.json","utf8"));
const app=readFileSync("src/App.tsx","utf8");
const components=readFileSync("src/components.tsx","utf8");
const sourceFiles=["src/App.tsx","src/components.tsx","src/pages.tsx","src/Portal.tsx","src/Relatorios.tsx"].map(path=>readFileSync(path,"utf8")).join("\n");

test("deploy está versionado como Vite com saída dist",()=>{assert.equal(config.framework,"vite");assert.equal(config.buildCommand,"npm run build");assert.equal(config.outputDirectory,"dist")});
test("fallback SPA entrega index.html para rotas sem arquivo físico",()=>assert.deepEqual(config.rewrites,[{source:"/(.*)",destination:"/index.html"}]));
test("rotas profundas são resolvidas pelo React Router",()=>{for(const route of ["/solicitacoes","/nova","/painel","/relatorios","/configuracoes","/rh/enderecos"])assert.ok(app.includes(`path="${route}"`),route)});
test("menu Importação usa NavLink e não recarrega a página",()=>assert.match(components,/<NavLink to="\/rh\/enderecos"/));
test("rotas internas não usam window.location ou document.location",()=>assert.doesNotMatch(sourceFiles,/(?:window|document)\.location|location\.href/));
test("links href restantes não apontam para rotas internas",()=>{const hrefs=[...sourceFiles.matchAll(/<a\s[^>]*href=\{?([^\s}>]+)/g)].map(match=>match[1]);for(const href of hrefs)assert.doesNotMatch(href,/^["'`]\/(?:solicitacoes|nova|painel|relatorios|configuracoes|rh)/)});
test("build mantém entrypoint e diretório de assets",()=>{assert.ok(existsSync("index.html"));assert.match(readFileSync("index.html","utf8"),/<script type="module" src="\/src\/main\.tsx"><\/script>/)});
