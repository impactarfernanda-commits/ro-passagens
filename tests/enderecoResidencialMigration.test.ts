import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const migration=fs.readFileSync("supabase/migrations/202608100001_endereco_residencial_funcionarios.sql","utf8");
const dry=fs.readFileSync("supabase/manual/DRY_RUN_202608100001_endereco_residencial_funcionarios.sql","utf8");
test("dry run replica integralmente a migration e troca somente commit por rollback",()=>assert.equal(dry,migration.replace(/^commit;\s*$/im,"rollback;")));
test("migration mantém endereço privado separado e vinculado ao UUID oficial",()=>{assert.match(migration,/ro_funcionarios_enderecos_privados/);assert.match(migration,/funcionario_id uuid not null references public\.funcionarios\(id\)/);assert.match(migration,/unique\(funcionario_id\)/)});
test("usuário comum recebe somente destino resumido",()=>{const start=migration.indexOf("ro_obter_destino_residencial_resumido");const end=migration.indexOf("ro_obter_endereco_residencial_completo");const body=migration.slice(start,end);assert.match(body,/possui_endereco boolean,cidade text,uf text/);assert.doesNotMatch(body,/logradouro text/)});
test("importação valida funcionário oficial e não insere em funcionarios",()=>{assert.match(migration,/FUNCIONARIO_NAO_CADASTRADO_NO_OBRAS_CONTROL/);assert.doesNotMatch(migration,/insert into public\.funcionarios\b/i)});
