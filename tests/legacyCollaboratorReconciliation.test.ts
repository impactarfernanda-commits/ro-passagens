import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {matchCollaborator,mergePreservingExisting,strongAuxiliaryMatches} from "../src/addressImport.ts";

const legacy=(extra={})=>({id:"legacy-wendell",nome:"WENDELL JOVIANO DA SILVA",cpf:null,funcionario_id:null,data_nascimento:null,telefone:null,cidade:"Porto Velho",uf:"RO",...extra});
const obras=(extra={})=>({id:"obras-1",nome:"WENDELL JOVIANO DA SILVA",...extra});
const migration2=fs.readFileSync("supabase/migrations/202608110002_corrige_duplicacao_colaboradores_rh.sql","utf8");
const migration3=fs.readFileSync("supabase/migrations/202608110003_reconcilia_colaboradores_antigos_ro.sql","utf8");
const historical=fs.readFileSync("supabase/manual/diagnosticar_duplicidades_historicas_colaboradores_ro.sql","utf8");
const reconciliation=fs.readFileSync("supabase/manual/diagnosticar_reconciliacao_colaboradores_antigos_ro.sql","utf8");

test("CPF privado exato atualiza",()=>assert.equal(matchCollaborator({nome:"Outro",cpf:"17271846883"},[legacy({cpf:"17271846883"})],[]).status,"atualizacao"));
test("funcionario_id existente atualiza",()=>assert.equal(matchCollaborator({nome:"Outro",funcionario_id:"obras-1"},[legacy({funcionario_id:"obras-1"})],[]).status,"atualizacao"));
test("nome privado exato único atualiza preservando id",()=>{const result=matchCollaborator({nome:" Wendell  Joviano da Silva "},[legacy()],[]);assert.equal(result.status,"atualizacao");assert.equal(result.privateRecord?.id,"legacy-wendell")});
test("Wendell antigo sem CPF recebe classificação de enriquecimento",()=>{const result=matchCollaborator({nome:"WENDELL JOVIANO DA SILVA",cpf:"17271846883"},[legacy()],[]);assert.equal(result.status,"atualizacao");assert.equal(result.reason,"nome_privado_exato")});
test("nome exato com CPF histórico diferente é conflito",()=>{const result=matchCollaborator({nome:"WENDELL JOVIANO DA SILVA",cpf:"17271846883"},[legacy({cpf:"99988877766"})],[]);assert.equal(result.status,"conflito");assert.equal(result.reason,"cpf_conflitante")});
test("dois privados homônimos são ambíguos",()=>assert.equal(matchCollaborator({nome:"WENDELL JOVIANO DA SILVA"},[legacy(),legacy({id:"legacy-2"})],[]).status,"possivel_duplicidade"));
test("nome apenas similar não é mesclado automaticamente",()=>assert.equal(matchCollaborator({nome:"WENDELL SILVA"},[legacy()],[]).status,"novo_externo"));
test("combinação forte de nascimento e telefone gera somente sugestão",()=>assert.equal(strongAuxiliaryMatches({data_nascimento:"1990-01-01",telefone:"69999999999"},[legacy({data_nascimento:"1990-01-01",telefone:"(69) 99999-9999"})]).length,1));
test("funcionário Obras único cria privado vinculado",()=>assert.equal(matchCollaborator({nome:"WENDELL JOVIANO DA SILVA"},[],[obras()]).status,"novo_vinculado"));
test("externo real permanece novo externo",()=>assert.equal(matchCollaborator({nome:"PESSOA EXTERNA"},[],[obras()]).status,"novo_externo"));
test("reimportação de Wendell continua atualização e zero novos",()=>{const after=[legacy({cpf:"17271846883"})];assert.equal(matchCollaborator({nome:"WENDELL JOVIANO DA SILVA",cpf:"17271846883"},after,[]).status,"atualizacao");assert.match(migration2,/v_existed.*v_updates/s)});
test("células vazias preservam dados antigos",()=>assert.deepEqual(mergePreservingExisting({cep:"76800-000",numero:"10",telefone:"69999999999"},{cep:"",numero:null,telefone:undefined}),{cep:"76800-000",numero:"10",telefone:"69999999999"}));
test("histórico de solicitações participa da escolha do principal e não há delete",()=>{assert.match(historical,/ro_passagem_solicitacoes/);assert.match(historical,/referencias/);assert.doesNotMatch(historical,/\b(delete|update|insert)\b/i)});
test("duplicidades históricas e conflitos são diagnosticados sem CPF completo",()=>{for(const token of ["cpf_igual_em_mais_de_um_registro","mesmo_funcionario_id","nome_exato_duplicado","possivel_duplicidade","conflito_cpf_possivel_homonimo"])assert.ok(historical.includes(token),token);assert.doesNotMatch(historical,/select\s+\*/i)});
test("diagnóstico de reconciliação não expõe PII e migration protege CPF",()=>{assert.match(reconciliation,/possui_cpf/);assert.doesNotMatch(reconciliation,/\be\.rg\b|telefone|logradouro|data_nascimento/i);assert.match(migration3,/CPF_DIVERGENTE_CADASTRO_EXISTENTE/);assert.doesNotMatch(migration3,/insert into public\.funcionarios|delete from/i)});
