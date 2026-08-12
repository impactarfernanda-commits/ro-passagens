import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { currentCostCenterPrefill } from "../src/collaboratorCostCenter.ts";

const migration = fs.readFileSync("supabase/migrations/202608120001_restaura_centro_custo_vinculo_obras.sql", "utf8");
const priorDeduplication = fs.readFileSync("supabase/migrations/202608110006_deduplica_catalogo_passagens_ro.sql", "utf8");
const page = fs.readFileSync("src/pages.tsx", "utf8");
const diagnostic = fs.readFileSync("supabase/manual/diagnosticar_centro_custo_vinculo_obras.sql", "utf8");
const dryRun = fs.readFileSync("supabase/manual/DRY_RUN_202608120001_restaura_centro_custo_vinculo_obras.sql", "utf8");
const verification = fs.readFileSync("supabase/manual/verificar_centro_custo_vinculo_obras.sql", "utf8");
const smoke = fs.readFileSync("supabase/manual/smoke_centro_custo_vinculo_obras.sql", "utf8");

test("vínculo explícito visível com alocação preenche centro de custo", () => {
  assert.equal(currentCostCenterPrefill({id:"privado",nome:"Real",funcionario_id:"obras",visivel_obras_control:true,obra_id:"obra-1"}), "obra-1");
});

test("sem funcionario_id não preenche, mesmo com obra indevida no payload", () => {
  assert.equal(currentCostCenterPrefill({id:"privado",nome:"VITOR PENATTI FERRI",funcionario_id:null,visivel_obras_control:false,obra_id:"obra-indevida"}), "");
  assert.equal(currentCostCenterPrefill({id:"yordan",nome:"YORDAN ALISSON DE CASTRO BONACCORSI",funcionario_id:null,obra_id:"obra-indevida"}), "");
  assert.equal(currentCostCenterPrefill({id:"yuri",nome:"YURI VIEIRA DO NASCIMENTO",funcionario_id:null,obra_id:"obra-indevida"}), "");
});

test("restrito_ro invisível e funcionário Obras sem alocação não preenchem", () => {
  assert.equal(currentCostCenterPrefill({id:"legado",nome:"Restrito",funcionario_id:"legado",visivel_obras_control:false,escopo_passagens:"restrito_ro",obra_id:"obra-indevida"}), "");
  assert.equal(currentCostCenterPrefill({id:"real",nome:"Sem alocação",funcionario_id:"real",visivel_obras_control:true,obra_id:null}), "");
});

test("RPC exige vínculo por id e funcionário Obras válido antes de consultar alocação", () => {
  assert.match(migration, /f\.id=p\.funcionario_id[\s\S]*f\.ativo[\s\S]*f\.deleted_at is null[\s\S]*f\.visivel_obras_control/i);
  assert.match(migration, /a\.funcionario_id=f\.id[\s\S]*order by a\.data desc[\s\S]*limit 1/i);
  const allocationSections = migration.match(/select a\.obra_id from public\.alocacoes[\s\S]*?limit 1/g) || [];
  assert.equal(allocationSections.length, 2);
  for (const section of allocationSections) assert.doesNotMatch(section, /nome|salario|custo/i);
});

test("múltiplas alocações usam a regra canônica mais recente", () => {
  assert.equal([{id:"antiga",data:"2026-01-01"},{id:"atual",data:"2026-08-01"}].sort((a,b)=>b.data.localeCompare(a.data))[0].id, "atual");
  assert.match(migration, /order by a\.data desc\s+limit 1/i);
});

test("troca de funcionário aplica novo prefill e escolha manual não sofre efeito/refetch", () => {
  assert.match(page, /function pickFuncionario\(id: string\)[\s\S]*obra_id: currentCostCenterPrefill\(f\)/);
  assert.doesNotMatch(page, /useEffect\([\s\S]{0,250}currentCostCenterPrefill/);
  assert.match(page, /<CostCenterCombobox required options=\{obras\} value=\{form\.obra_id\}/);
  assert.match(page, /onChange=\{\(obra_id\) => setForm\(\(atual\) => \(\{ \.\.\.atual, obra_id \}\)\)\}/);
});

test("deduplicação permanece integral e alocação não usa matching por nome", () => {
  for (const token of ["NOME_INTERMEDIARIO_AUSENTE", "SOBRENOME_TRUNCADO"]) assert.ok(priorDeduplication.includes(token), token);
  for (const token of ["ro_correspondencia_nome_catalogo_ro(l.nome,p.nome)", "unicos as("]) assert.ok(migration.includes(token), token);
  const afterUnion = migration.slice(migration.indexOf("select p.id"));
  assert.doesNotMatch(afterUnion, /a\.nome|a\.funcionario_nome|p\.nome\s*=\s*f\.nome/i);
  assert.doesNotMatch(migration, /update\s+public\.(funcionarios|ro_funcionarios_enderecos_privados|alocacoes)/i);
});

test("artefatos SQL são seguros, mínimos e não expõem salário ou custo", () => {
  assert.match(diagnostic, /^--[^\n]*\nselect/i);
  assert.doesNotMatch(diagnostic, /\b(insert|update|delete|create|alter|drop)\b/i);
  assert.match(dryRun, /^begin;[\s\S]*rollback;\s*$/i);
  assert.match(verification, /^--[^\n]*\nselect/i);
  assert.match(smoke, /^--[^\n]*\nbegin;[\s\S]*rollback;\s*$/i);
  for (const sql of [migration, diagnostic, dryRun, verification, smoke]) assert.doesNotMatch(sql, /salario|remuneracao|valor_custo/i);
  assert.match(migration, /revoke all on function public\.ro_catalogo_colaboradores_viagem\(\) from public,anon/);
  assert.match(migration, /grant execute on function public\.ro_catalogo_colaboradores_viagem\(\) to authenticated/);
});
