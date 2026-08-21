import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {resolveUserLabel} from "../src/userLabelResolution.ts";

const page=fs.readFileSync("src/pages.tsx","utf8");
const css=fs.readFileSync("src/styles.css","utf8");
const sql=fs.readFileSync("supabase/manual/diagnostico_solicitante_wayner_pacote1.sql","utf8");
const labelsMigration=fs.readFileSync("supabase/migrations/202608210002_corrige_labels_solicitante_aprovador.sql","utf8");

test("detalhe resolve solicitante pelo id sem confundi-lo com funcionário ou aprovador",()=>{
  assert.match(page,/resolveUserLabel\(found\.solicitante_id,labels,Boolean\(labelsError\)\)/);
  assert.match(page,/funcionario:funcionarios\(id,nome\)/);
  assert.doesNotMatch(page,/full_name:\s*(?:found\.)?funcionario/);
  assert.doesNotMatch(page,/full_name:\s*labelMap\.get\(found\.aprovador_id\)/);
});
test("Fernanda Trajano é resolvida pelo solicitante_id retornado",()=>assert.deepEqual(resolveUserLabel("6025ddaf-bfbf-457f-a2c1-f7c30c73474e",[{id:"6025ddaf-bfbf-457f-a2c1-f7c30c73474e",label:"Fernanda Trajano"}],false),{status:"resolved",label:"Fernanda Trajano"}));
test("perfil ausente e falha da RPC são estados distintos",()=>{
  assert.deepEqual(resolveUserLabel("solicitante",[],false),{status:"missing"});
  assert.deepEqual(resolveUserLabel("solicitante",null,true),{status:"error"});
  assert.match(page,/error: labelsError/);
  assert.match(page,/erroIdentificacaoSolicitante&&[\s\S]*Não foi possível carregar a identificação do solicitante/);
});
test("RPC permite ao aprovador resolver o solicitante vinculado sem ampliar RLS",()=>{
  assert.match(labelsMigration,/s\.aprovador_id=auth\.uid\(\)[\s\S]*s\.solicitante_id=u\.id/);
  assert.doesNotMatch(labelsMigration,/create policy|alter table|update\s+public\.ro_passagem_solicitacoes/i);
  assert.match(labelsMigration,/revoke all[\s\S]*from public,anon/);
});
test("diagnóstico relaciona solicitação, perfil solicitante e aprovador sem mutações",()=>{
  assert.match(sql,/sp\.full_name as solicitante_full_name/);
  assert.match(sql,/sp\.id=s\.solicitante_id/);
  assert.match(sql,/ap\.id=s\.aprovador_id/);
  assert.doesNotMatch(sql,/\b(insert|update|delete|alter|create|drop|truncate|merge)\b/i);
});
test("textarea possui label próprio, três linhas e largura total responsiva",()=>{
  assert.match(page,/className="approval-rejection-field"[\s\S]*<span>Motivo da reprovação<\/span>[\s\S]*<textarea rows=\{3\}/);
  assert.match(page,/placeholder="Obrigatório ao reprovar"/);
  assert.match(css,/\.approval-rejection-field\{[^}]*flex-direction:column[^}]*width:100%/);
  assert.match(css,/\.approval-rejection-field textarea\{[^}]*min-height:86px[^}]*resize:vertical[^}]*width:100%/);
});
test("aprovar não exige motivo e reprovar exige dez caracteres",()=>{
  assert.match(page,/if \(!aprovar && motivo\.trim\(\)\.length<10\)/);
  assert.match(page,/aprovar \? \{p_solicitacao_id:row\.id\} : \{p_solicitacao_id:row\.id,p_motivo:motivo\}/);
});
