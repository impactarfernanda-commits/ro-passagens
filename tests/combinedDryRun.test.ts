import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";

const migration002=readFileSync(new URL("../supabase/migrations/202608050002_recusa_solicitacao_ro.sql",import.meta.url),"utf8").replace(/^\uFEFF/,"");
const migration003=readFileSync(new URL("../supabase/migrations/202608050003_controle_ciclo_folga_campo.sql",import.meta.url),"utf8").replace(/^\uFEFF/,"");
const combined=readFileSync(new URL("../supabase/manual/DRY_RUN_COMBINADO_202608050002_003_RECUSA_FOLGA.sql",import.meta.url),"utf8").replace(/^\uFEFF/,"");
const body=(sql:string)=>sql.replace(/\r\n/g,"\n").replace(/^\s*begin;\s*/i,"").replace(/\s*commit;\s*$/i,"").trim();
const marker002="-- 202608050002_recusa_solicitacao_ro.sql";
const marker003="-- 202608050003_controle_ciclo_folga_campo.sql";

test("DRY RUN combinado começa com um único BEGIN executável",()=>{assert.match(combined,/^begin;/i);assert.equal((combined.match(/^\s*begin;\s*$/gim)||[]).length,1);});
test("DRY RUN combinado termina com um único ROLLBACK",()=>{assert.match(combined,/rollback;\s*$/i);assert.equal((combined.match(/^\s*rollback;\s*$/gim)||[]).length,1);});
test("DRY RUN combinado não contém COMMIT executável",()=>assert.equal((combined.match(/^\s*commit;\s*$/gim)||[]).length,0));
test("migration 002 aparece integralmente antes da 003",()=>{const start002=combined.indexOf(marker002);const start003=combined.indexOf(marker003);assert.ok(start002>=0&&start003>start002);assert.equal(body(combined.slice(start002+marker002.length,start003)),body(migration002));});
test("migration 003 aparece integralmente após a 002",()=>{const start003=combined.indexOf(marker003);const rollback=combined.lastIndexOf("rollback;");assert.ok(rollback>start003);assert.equal(body(combined.slice(start003+marker003.length,rollback)),body(migration003));});
test("migrations originais mantêm os hashes de origem do combinado",()=>{const sha=(value:string)=>createHash("sha256").update(value).digest("hex").toUpperCase();assert.equal(sha(migration002),"F320BDBCD9091BD62682E101FF245B738CFBDE4608E6ACC20ECA4FE019FC9BEE");assert.equal(sha(migration003),"5C896D936BCCF5201445B397F448B08F2E14736283B3B3B5CB89FD8C892EA828");});
