import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {matchCollaborator,normalizeText} from "../src/addressImport.ts";

const migration=fs.readFileSync("supabase/migrations/202608110002_corrige_duplicacao_colaboradores_rh.sql","utf8");
const diagnostic=fs.readFileSync("supabase/manual/diagnosticar_duplicacao_colaboradores_rh.sql","utf8");
const correction=fs.readFileSync("supabase/manual/corrigir_duplicacao_colaboradores_rh_controlado.sql","utf8");
const page=fs.readFileSync("src/pages.tsx","utf8").slice(fs.readFileSync("src/pages.tsx","utf8").indexOf("export function EnderecosFuncionarios"));
const privateRecord=(extra={})=>({id:"p1",nome:"Maria Silva",cpf:null,funcionario_id:null,...extra});
const obras=(id="f1",nome="Maria Silva")=>({id,nome,ativo:true,colaborador_id:null});

test("funcionário Obras único por nome vira novo vinculado e não externo",()=>{
 const match=matchCollaborator({nome:"  MÁRIA-SILVA "},[],[obras()]);
 assert.equal(match.status,"novo_vinculado");assert.equal(match.obrasRecord?.id,"f1");
});
test("nome inexistente no Obras permanece externo",()=>assert.equal(matchCollaborator({nome:"Pessoa Externa"},[],[obras()]).status,"novo_externo"));
test("dois nomes iguais no Obras são ambíguos",()=>assert.equal(matchCollaborator({nome:"Maria Silva"},[],[obras("f1"),obras("f2")]).status,"possivel_duplicidade"));
test("CPF privado exato tem prioridade sobre nomes",()=>assert.equal(matchCollaborator({nome:"Outro Nome",cpf:"123.456.789-01"},[privateRecord({cpf:"12345678901"})],[obras()]).privateRecord?.id,"p1"));
test("funcionario_id existente vence nome",()=>assert.equal(matchCollaborator({nome:"Outro Nome",funcionario_id:"f1"},[privateRecord({funcionario_id:"f1"})],[obras()]).privateRecord?.id,"p1"));
test("nome privado exato precede o catálogo Obras",()=>assert.equal(matchCollaborator({nome:"Maria Silva"},[privateRecord()],[obras()]).status,"atualizacao"));
test("normalização remove acentos, pontuação e espaços",()=>assert.equal(normalizeText("  João-da.Silva "),normalizeText("JOAO DA SILVA")));
test("reimportação resolve o cadastro privado como atualização",()=>assert.equal(matchCollaborator({nome:"Maria Silva"},[privateRecord({funcionario_id:"f1"})],[obras()]).status,"atualizacao"));
test("prévia separa atualizações, vinculados, externos e pendências",()=>{for(const token of ['counts("atualizacao")','counts("novo_vinculado")','counts("novo_externo")','possivel_duplicidade'])assert.ok(page.includes(token),token)});
test("frontend usa catálogo Obras mínimo específico",()=>assert.match(page,/ro_catalogo_funcionarios_obras_matching_rh/));
test("catálogo final anterior suprime público já vinculado",()=>{const prior=fs.readFileSync("supabase/migrations/202608110001_amplia_cadastro_colaboradores_rh.sql","utf8");assert.match(prior,/not exists\(select 1 from public\.ro_funcionarios_enderecos_privados e where e\.funcionario_id=f\.id\)/)});
test("constraint existente e lock impedem dois privados para o mesmo vínculo",()=>{const original=fs.readFileSync("supabase/migrations/202608100001_endereco_residencial_funcionarios.sql","utf8");assert.match(original,/unique\(funcionario_id\)/);assert.match(migration,/pg_advisory_xact_lock/);assert.match(migration,/FUNCIONARIO_OBRAS_JA_VINCULADO/)});
test("diagnóstico cobre candidatos, ambiguidades, vínculos e duplicidade privada sem PII",()=>{for(const token of ["candidato_unico","sem_candidato","candidato_ambiguo","ja_vinculado","conflito_funcionario_ja_vinculado","duplicidade_privada_real"])assert.ok(diagnostic.includes(token),token);assert.doesNotMatch(diagnostic,/\be\.cpf\b|\brg\b|telefone|logradouro/i)});
test("correção controlada vincula só caso único, preserva registro e faz rollback",()=>{assert.match(correction,/quantidade=1/);assert.match(correction,/set funcionario_id=/);assert.doesNotMatch(correction,/delete\s+from/i);assert.match(correction,/rollback;/)});
test("banco restringe catálogo, valida vínculo e não cria funcionário Obras",()=>{assert.match(migration,/ro_can_manage_private_addresses/);assert.match(migration,/VINCULO_OBRAS_INVALIDO/);assert.doesNotMatch(migration,/insert into public\.funcionarios/i)});
