import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const diagnostic=fs.readFileSync("supabase/manual/diagnosticar_duplicacao_colaboradores_rh.sql","utf8");
const migration=fs.readFileSync("supabase/migrations/202608110002_corrige_duplicacao_colaboradores_rh.sql","utf8");
const dryRun=fs.readFileSync("supabase/manual/DRY_RUN_202608110002_corrige_duplicacao_colaboradores_rh.sql","utf8");
const correction=fs.readFileSync("supabase/manual/corrigir_duplicacao_colaboradores_rh_controlado.sql","utf8");
const executable=diagnostic.replace(/^\s*--.*$/gm,"").trim();
const normalization=/trim\(regexp_replace\(regexp_replace\(lower\(translate\([\s\S]*?'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn'\)\),[\s\S]*?'\[\._:\/\\\\-\]\+',' ','g'\),'\\s\+',' ','g'\)\)/g;

test("diagnóstico pré-migration contém somente CTE e SELECT",()=>{assert.match(executable,/^with\s/i);assert.doesNotMatch(executable,/\b(begin|commit|rollback|insert|update|delete|alter|create|drop|grant|revoke)\b/i)});
test("diagnóstico não chama função criada pela migration",()=>assert.doesNotMatch(diagnostic,/public\.ro_normalizar_nome_colaborador\s*\(/i));
test("diagnóstico não cria objetos persistentes ou temporários",()=>assert.doesNotMatch(executable,/\b(function|table|view|extension|procedure)\b/i));
test("normalização inline repete a expressão definitiva para privado e Obras",()=>{const compact=(value:string|undefined)=>value?.replace(/\s+/g," ");const migrationExpression=migration.match(normalization);const diagnosticExpressions=diagnostic.match(normalization);assert.equal(migrationExpression?.length,1);assert.equal(diagnosticExpressions?.length,2);assert.equal(compact(diagnosticExpressions?.[0].replace("e.nome","p_nome")),compact(migrationExpression?.[0]));assert.equal(compact(diagnosticExpressions?.[1].replace("f.nome","p_nome")),compact(migrationExpression?.[0]))});
test("diagnóstico é autônomo antes da migration",()=>{assert.match(diagnostic,/PRÉ-MIGRATION/);assert.doesNotMatch(executable,/ro_normalizar_nome_colaborador/)});
test("dry run cria a função dentro de transação revertida",()=>{assert.match(dryRun,/^\s*--[^\n]*\n+begin;/i);assert.match(dryRun,/create or replace function public\.ro_normalizar_nome_colaborador/);assert.match(dryRun,/rollback;\s*$/i)});
test("correção controlada é explicitamente pós-migration e segura por padrão",()=>{assert.match(correction,/PÓS-MIGRATION 202608110002/);assert.match(correction,/^--[\s\S]*\nbegin;/i);assert.match(correction,/rollback;\s*$/i)});
