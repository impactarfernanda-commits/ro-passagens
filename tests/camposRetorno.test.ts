import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { motivoPossuiRetorno, normalizarCamposRetorno } from "../src/retornoRules.ts";

const page=fs.readFileSync("src/pages.tsx","utf8");
const migration=fs.readFileSync("supabase/migrations/202608060001_ajusta_campos_retorno.sql","utf8");
const dry=fs.readFileSync("supabase/manual/DRY_RUN_202608060001_ajusta_campos_retorno.sql","utf8");

test("somente férias, folga de campo e recesso possuem retorno",()=>{
  for(const motivo of ["ferias","folga_campo","recesso"] as const) assert.equal(motivoPossuiRetorno(motivo),true);
  for(const motivo of ["desligamento","transferencia_obra","retorno_obra","inicio_obra","admissao"] as const) assert.equal(motivoPossuiRetorno(motivo),false);
});

test("motivo sem retorno limpa todo o bloco e não restaura valores",()=>{
  const base={motivo:"desligamento" as const,data_retorno:"2026-09-01",destino_retorno:"Recife / PE",centro_custo_retorno_id:"obra",retorno_indefinido:true};
  assert.deepEqual(normalizarCamposRetorno(base),{...base,data_retorno:"",destino_retorno:"",centro_custo_retorno_id:"",retorno_indefinido:false});
});

test("retorno indefinido preserva data e limpa apenas destino e centro",()=>{
  const form={motivo:"ferias" as const,data_retorno:"2026-09-01",destino_retorno:"Recife / PE",centro_custo_retorno_id:"obra",retorno_indefinido:true};
  assert.deepEqual(normalizarCamposRetorno(form),{...form,destino_retorno:"",centro_custo_retorno_id:""});
});

test("formulário mantém rótulo, placeholder e data independente do checkbox",()=>{
  assert.match(page,/Destino de retorno — Cidade\/UF[\s\S]*placeholder="Cidade \/ UF"/);
  assert.match(page,/Retorno indefinido/);
  const checkbox=page.slice(page.indexOf('checked={form.retorno_indefinido}'),page.indexOf('Retorno indefinido',page.indexOf('checked={form.retorno_indefinido}')));
  assert.doesNotMatch(checkbox,/data_retorno/);
  assert.match(page,/row\.destino_retorno && <DT t="Destino de retorno"/);
});

test("migration e dry run permanecem sincronizados",()=>{
  const normalize=(sql:string)=>sql.trim().replace(/^begin;/i,"BEGIN;").replace(/(?:commit|rollback);$/i,"END;");
  assert.equal(normalize(dry),normalize(migration));
  assert.match(dry,/^begin;/i);assert.match(dry,/rollback;\s*$/i);assert.doesNotMatch(dry,/\bcommit\s*;/i);
});

test("banco normaliza criação direta, prefill e mantém grants restritos",()=>{
  assert.match(migration,/add column if not exists destino_retorno text/i);
  assert.match(migration,/before insert or update of motivo,data_retorno,destino_retorno/i);
  assert.match(migration,/case when v_tem_retorno and not v_retorno_indefinido then nullif\(trim\(p_solicitacao->>'destino_retorno'\)/i);
  assert.match(migration,/'destino_retorno',case when public\.ro_motivo_possui_retorno/i);
  assert.match(migration,/revoke all[\s\S]*from public,anon;[\s\S]*grant execute[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration,/\bupdate\s+public\.ro_passagem_solicitacoes\b/i);
});
