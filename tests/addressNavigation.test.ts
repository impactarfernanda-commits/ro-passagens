import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { podeAcessarAreasGerais, podeAcessarImportacaoEnderecos } from "../src/addressAccess.ts";

const app=readFileSync("src/App.tsx","utf8");
const components=readFileSync("src/components.tsx","utf8");
const pages=readFileSync("src/pages.tsx","utf8");

test("RH ativo acessa importação, mas não áreas gerais",()=>{const access={isRh:true,canImport:false,canViewAll:true};assert.equal(podeAcessarImportacaoEnderecos(access),true);assert.equal(podeAcessarAreasGerais(access),false)});
test("Fernanda mantém áreas gerais e importação",()=>{const access={isRh:false,canImport:true,canViewAll:true};assert.equal(podeAcessarImportacaoEnderecos(access),true);assert.equal(podeAcessarAreasGerais(access),true)});
test("RO, comum, gerente, diretor e RH inativo não recebem importação",()=>{for(const access of [{isRh:false,canImport:false,canViewAll:true},{isRh:false,canImport:false,canViewAll:false}])assert.equal(podeAcessarImportacaoEnderecos(access),false)});
test("rota usa permissão central e redireciona para solicitações",()=>assert.match(app,/path="\/rh\/enderecos" element=\{canAccessAddressImport \? <EnderecosFuncionarios \/> : <Navigate to="\/solicitacoes" replace \/>\}/));
test("RH não acessa painel, relatórios ou configurações",()=>{assert.equal((app.match(/canAccessGeneralAreas \?/g)||[]).length,2);assert.match(app,/path="\/configuracoes"[\s\S]*?<Navigate to="\/solicitacoes" replace \/>/)});
test("menu desktop e drawer móvel compartilham um único nav",()=>assert.equal((components.match(/<nav>/g)||[]).length,1));
test("configurações mantém somente funcionários e centros de custo",()=>{const config=pages.slice(pages.indexOf("type AbaConfiguracoes"),pages.indexOf("export function Detalhe"));assert.match(config,/Funcionários/);assert.match(config,/Centros de custo/);assert.doesNotMatch(config,/Endereços de funcionários|tipo === "enderecos"/)});
test("existe uma única implementação da tela de endereços",()=>assert.equal((pages.match(/export function EnderecosFuncionarios/g)||[]).length,1));
test("página independente preserva XLSX, prévia, matching e edição",()=>{const page=pages.slice(pages.indexOf("export function EnderecosFuncionarios"));for(const token of [".xlsx","Prévia obrigatória","safeMatches","Visualizar / Editar","ro_salvar_endereco_funcionario"])assert.ok(page.includes(token),token);assert.match(page,/title="Importação" subtitle="Endereços residenciais dos funcionários"/)});
