import test from "node:test"; import assert from "node:assert/strict";
import {autoMapHeaders,normalizeText,possibleMatches,safeMatches,validUf} from "../src/addressImport.ts";
test("normaliza acento, caixa, unicode e espaços sem reordenar nomes",()=>assert.equal(normalizeText("  JOÃO   DA Silva "),"joao da silva"));
test("reconhece cabeçalhos usuais",()=>assert.deepEqual(autoMapHeaders(["NOME FUNCIONÁRIO","ENDERECO","NUM","MUNICÍPIO","ESTADO","C.E.P."]),{nome:0,cep:5,logradouro:1,numero:2,cidade:3,uf:4}));
test("match automático exige igualdade única",()=>{const e=[{id:"1",nome:"João da Silva"},{id:"2",nome:"Maria"}];assert.deepEqual(safeMatches("JOAO DA SILVA",e).map(x=>x.id),["1"]);assert.equal(safeMatches("João Silva",e).length,0)});
test("nome duplicado permanece ambíguo e UF é validada",()=>{assert.equal(safeMatches("Ana",[{id:"1",nome:"Ana"},{id:"2",nome:"ANA"}]).length,2);assert.equal(validUf("rs"),true);assert.equal(validUf("XX"),false)});
test("aproximação conservadora apenas sugere revisão",()=>assert.deepEqual(possibleMatches("José C Souza",[{id:"1",nome:"José Carlos de Souza"},{id:"2",nome:"Maria Silva"}]).map(x=>x.id),["1"]));
