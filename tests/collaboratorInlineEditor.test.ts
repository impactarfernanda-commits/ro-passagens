import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeNeighborhoodForDisplay, normalizeStreetForDisplay } from "../src/collaboratorDisplay.ts";

const page=fs.readFileSync("src/pages.tsx","utf8");
const scope=page.slice(page.indexOf("export function EnderecosFuncionarios"));

test("remove prefixo BAIRRO em caixa alta",()=>assert.equal(normalizeNeighborhoodForDisplay("BAIRRO Jardim das Margaridas"),"Jardim das Margaridas"));
test("remove prefixo Bairro com dois-pontos",()=>assert.equal(normalizeNeighborhoodForDisplay("Bairro: Centro"),"Centro"));
test("remove prefixo bairro com hífen",()=>assert.equal(normalizeNeighborhoodForDisplay("bairro - Vila Nova"),"Vila Nova"));
test("preserva bairro normal",()=>assert.equal(normalizeNeighborhoodForDisplay("Jardim América"),"Jardim América"));
test("remove somente tipo duplicado de rua",()=>assert.equal(normalizeStreetForDisplay("RUA Rua Joaquim Ferreira - 1197"),"Rua Joaquim Ferreira - 1197"));
test("remove somente tipo duplicado de avenida",()=>assert.equal(normalizeStreetForDisplay("AVENIDA Avenida Brasil"),"Avenida Brasil"));
test("preserva logradouro com tipo único",()=>assert.equal(normalizeStreetForDisplay("RUA DAS FLORES"),"RUA DAS FLORES"));
test("preserva outros tipos únicos",()=>{for(const value of ["Avenida Brasil","Travessa Aurora","Rodovia BR-364","Estrada do Sol"])assert.equal(normalizeStreetForDisplay(value),value)});

test("editor é renderizado dentro da linha selecionada",()=>assert.match(scope,/collaborator-row[\s\S]*selectedEmployee\?\.id===employee\.id&&<div className="collaborator-inline-editor"/));
test("não existe editor solto depois da listagem",()=>assert.doesNotMatch(scope,/<\/div>\}\{selectedEmployee&&<div className="wide"><h3>Dados do colaborador/));
test("trocar colaborador reutiliza um único selectedEmployee",()=>{assert.match(scope,/function openEmployee\(employee:AddressEmployee\)/);assert.equal((scope.match(/useState<AddressEmployee\|null>/g)||[]).length,1)});
test("fechar remove o editor sem limpar busca ou recarregar",()=>{const body=scope.slice(scope.indexOf("function closeEmployee"),scope.indexOf("async function saveManual"));assert.match(body,/setSelectedEmployee\(null\)/);assert.doesNotMatch(body,/setSearch|load\(/)});
test("salvar mantém contexto, atualiza lista local e preserva erro",()=>{const body=scope.slice(scope.indexOf("async function saveManual"),scope.indexOf("const counts"));assert.match(body,/setEmployees\(current=>current\.map/);assert.match(body,/setEditorMessage\(\{kind:"error"/);assert.doesNotMatch(body,/setSelectedEmployee\(null\)|load\(/)});
test("busca permanece controlada ao abrir e fechar",()=>{assert.match(scope,/value=\{search\} onChange=\{e=>setSearch/);const open=scope.slice(scope.indexOf("function openEmployee"),scope.indexOf("async function saveManual"));assert.doesNotMatch(open,/setSearch/)});
test("editor possui heading contextual e associação acessível",()=>{assert.match(scope,/Dados do colaborador — \{selectedEmployee\.nome\}/);assert.match(scope,/aria-controls=/);assert.match(scope,/aria-expanded=\{selectedEmployee\?\.id===employee\.id\}/)});
test("fluxo de edição não registra informações pessoais em logs",()=>{const edit=scope.slice(scope.indexOf("function openEmployee"),scope.indexOf("const counts"));assert.doesNotMatch(edit,/console\.(log|info|debug|warn|error)/)});

