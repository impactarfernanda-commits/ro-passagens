import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("supabase/migrations/202608110005_reconhece_cidade_uf_embutida.sql","utf8");
const dry=fs.readFileSync("supabase/manual/DRY_RUN_202608110005_reconhece_cidade_uf_embutida.sql","utf8");
const smoke=fs.readFileSync("supabase/manual/smoke_cidade_uf_embutida.sql","utf8");
const diagnostic=fs.readFileSync("supabase/manual/diagnosticar_cidade_uf_embutida.sql","utf8");
const frontend=fs.readFileSync("src/pages.tsx","utf8");

const scenarios=[
  ["formato separado",/\('Curitiba','PR',true,'Curitiba','PR'\)/],
  ["hífen com espaços",/\('Chopinzinho - PR',null,true,'Chopinzinho','PR'\)/],
  ["Salvador com UF embutida",/\('Salvador - BA',null,true,'Salvador','BA'\)/],
  ["barra sem espaços",/\('Manaus\/AM',null,true,'Manaus','AM'\)/],
  ["barra com espaços",/\('Rio Claro \/ SP',null,true,'Rio Claro','SP'\)/],
  ["hífen sem espaços",/\('São Paulo-SP',null,true,'São Paulo','SP'\)/],
  ["sem UF",/\('Curitiba',null,false,'Curitiba',null\)/],
  ["UF inválida",/\('Cidade - XX',null,false,'Cidade - XX',null\)/],
  ["valores nulos",/\(null,null,false,null,null\)/],
  ["UF explícita divergente prevalece",/\('Chopinzinho - PR','SC',true,'Chopinzinho - PR','SC'\)/],
] as const;
for(const [name,pattern] of scenarios)test(name,()=>assert.match(smoke,pattern));

test("dry run replica a migration e troca somente commit por rollback",()=>assert.equal(dry,migration.replace(/^commit;$/im,"rollback;")));
test("RPC e trigger reutilizam o interpretador central",()=>{
  assert.match(migration,/ro_obter_destino_colaborador_resumido[\s\S]*ro_interpretar_cidade_uf_residencial/);
  assert.match(migration,/ro_aplicar_destino_residencial[\s\S]*ro_interpretar_cidade_uf_residencial/);
  assert.match(migration,/new\.motivo not in \('ferias','folga_campo','recesso'\)/);
});
test("frontend continua consumindo apenas a RPC resumida",()=>{
  assert.match(frontend,/rpc\("ro_obter_destino_colaborador_resumido"/);
  assert.doesNotMatch(frontend,/ro_interpretar_cidade_uf_residencial/);
});
test("artefatos não alteram dados nem expõem endereço completo",()=>{
  for(const sql of [migration,dry,smoke,diagnostic]){
    assert.doesNotMatch(sql,/\b(update|insert|delete|merge)\s+(?:into\s+|from\s+)?public\.ro_funcionarios_enderecos_privados\b/i);
    assert.doesNotMatch(sql,/\b(logradouro|numero|complemento|bairro|cep)\b/i);
  }
});
