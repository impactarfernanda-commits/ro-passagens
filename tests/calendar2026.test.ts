import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calcularDataMinima } from "../src/passagemRules.ts";

const migration=readFileSync(new URL("../supabase/migrations/202608040002_calendario_empresa_2026.sql",import.meta.url),"utf8");
const baseMigration=readFileSync(new URL("../supabase/migrations/202608040001_regras_prazos_rh_desligamentos.sql",import.meta.url),"utf8");
const dry=readFileSync(new URL("../supabase/manual/DRY_RUN_202608040002_calendario_empresa_2026.sql",import.meta.url),"utf8");
const page=readFileSync(new URL("../src/pages.tsx",import.meta.url),"utf8");
const rows=migration.split(/\r?\n/).filter((line)=>/^\s*\('2026-\d{2}-\d{2}'::date,/.test(line));
const sp=(value:string)=>new Date(`${value}-03:00`);
const anos=[{ano:2026,completo:true}];
const normalize=(value:string)=>value.replace(/^\uFEFF/,"").replace(/--[^\n]*/g,"").replace(/(?:commit|rollback);\s*$/i,"END;").replace(/\s+/g," ").trim();

test("carga define 26 registros",()=>assert.equal(rows.length,26));
test("carga define 20 registros ativos",()=>assert.equal(rows.filter((row)=>/,true\),?$/.test(row)).length,20));
test("carga define 6 registros inativos",()=>assert.equal(rows.filter((row)=>/,false\),?$/.test(row)).length,6));
const constraintNames=[...migration.matchAll(/add constraint\s+(\w+)\s+check\b/gi)].map((match)=>match[1]);
const abrangenciaValida=(abrangencia:string,estado:string|null,municipio:string|null)=>(
  (abrangencia==="nacional"&&estado===null&&municipio===null)||
  (abrangencia==="estadual"&&estado==="SP"&&municipio===null)||
  (abrangencia==="municipal"&&estado==="SP"&&municipio==="Rio Claro")||
  (abrangencia==="empresa"&&estado===null&&municipio===null)
);

test("constraint aceita abrangência empresa",()=>{assert.match(migration,/abrangencia\s*=\s*'empresa'\s+and\s+estado\s+is\s+null\s+and\s+municipio\s+is\s+null/i);assert.equal(abrangenciaValida("empresa",null,null),true);});
test("constraint aceita convenção coletiva",()=>assert.match(migration,/tipo in \([^)]*'convencao_coletiva'/i));
test("constraint aceita recesso",()=>assert.match(migration,/tipo in \([^)]*'recesso'/i));
test("registro ativo de empresa não conta como útil",()=>assert.equal(calcularDataMinima(sp("2026-08-03T10:00:00"),"dias_uteis",5,[{data:"2026-08-05",ativo:true}],anos).data,"2026-08-10"));
test("registro inativo de empresa continua útil",()=>assert.equal(calcularDataMinima(sp("2026-08-03T10:00:00"),"dias_uteis",5,[{data:"2026-08-05",ativo:false}],anos).data,"2026-08-07"));
test("dia-ponte ativo não conta",()=>assert.equal(calcularDataMinima(sp("2026-02-16T10:00:00"),"dias_uteis",1,[{data:"2026-02-16",ativo:true}],anos).data,"2026-02-17"));
test("convenção coletiva ativa não conta",()=>assert.equal(calcularDataMinima(sp("2026-12-24T10:00:00"),"dias_uteis",1,[{data:"2026-12-24",ativo:true}],anos).data,"2026-12-25"));
test("recesso inativo não interfere",()=>assert.equal(calcularDataMinima(sp("2026-12-21T10:00:00"),"dias_uteis",1,[{data:"2026-12-21",ativo:false}],anos).data,"2026-12-21"));
test("ativar recesso passa a excluí-lo",()=>assert.equal(calcularDataMinima(sp("2026-12-21T10:00:00"),"dias_uteis",1,[{data:"2026-12-21",ativo:true}],anos).data,"2026-12-22"));
test("alteração continua invalidando o ano",()=>{assert.match(baseMigration,/create trigger ro_calendar_invalidate after insert or update or delete/i);assert.match(baseMigration,/on conflict\(ano\) do update set completo=false/i);});
test("reexecução usa MERGE sem duplicar",()=>{assert.match(migration,/merge into public\.ro_calendario_nao_util/i);assert.match(migration,/is not distinct from origem\.(?:estado|municipio)/i);});
test("registros manuais adicionais não são apagados",()=>assert.doesNotMatch(migration,/delete\s+from\s+public\.ro_calendario_nao_util/i));
test("2026 fica completo após a carga",()=>assert.match(migration,/values\(2026,true,'Calendário corporativo TanksBR 2026/i));
test("interface mostra os quatro tipos",()=>{for(const value of ["feriado","ponto_facultativo","convencao_coletiva","recesso"])assert.match(page,new RegExp(`option value="${value}"`));});
test("interface mostra abrangência Empresa",()=>assert.match(page,/<option value="empresa">Empresa<\/option>/));
test("lista diferencia ativo e pendente",()=>{assert.match(page,/Pendente\/Inativo/);assert.match(page,/calendar-recess-pending/);});
test("motor mantém os horários de corte",()=>{assert.match(migration,/time '15:30'/);assert.match(migration,/time '16:30'/);assert.match(migration,/America\/Sao_Paulo/);});
test("migration é transacional",()=>{assert.match(migration,/^begin;/i);assert.match(migration,/commit;\s*$/i);});
test("DRY RUN começa com BEGIN, termina com ROLLBACK e está sincronizado",()=>{assert.match(dry,/^begin;/i);assert.match(dry,/rollback;\s*$/i);assert.doesNotMatch(dry,/commit;\s*$/i);assert.equal(normalize(dry),normalize(migration));});
test("remove as duas constraints antigas de abrangência",()=>{for(const name of ["ro_calendario_nao_util_abrangencia_check","ro_calendario_abrangencia_ck"])assert.match(migration,new RegExp(`drop constraint if exists ${name}`));});
test("remove a constraint antiga de tipo",()=>assert.match(migration,/drop constraint if exists ro_calendario_nao_util_tipo_check/i));
test("somente constraints conhecidas são removidas",()=>{assert.equal((migration.match(/drop constraint if exists/gi)||[]).length,3);assert.doesNotMatch(migration,/pg_constraint/i);});
test("cria somente uma constraint final de abrangência",()=>{assert.equal(constraintNames.filter((name)=>/abrangencia/i.test(name)).length,1);assert.deepEqual(constraintNames.filter((name)=>/abrangencia/i.test(name)),["ro_calendario_abrangencia_ck"]);assert.doesNotMatch(migration,/add constraint ro_calendario_nao_util_abrangencia_check/i);});
test("cria somente uma constraint final de tipo",()=>assert.deepEqual(constraintNames.filter((name)=>/tipo/i.test(name)),["ro_calendario_nao_util_tipo_check"]));
test("nacional com estado preenchido é rejeitado",()=>assert.equal(abrangenciaValida("nacional","SP",null),false));
test("empresa com estado ou município preenchido é rejeitada",()=>{assert.equal(abrangenciaValida("empresa","SP",null),false);assert.equal(abrangenciaValida("empresa",null,"Rio Claro"),false);});
test("estadual diferente de SP é rejeitado",()=>assert.equal(abrangenciaValida("estadual","RJ",null),false));
test("municipal diferente de Rio Claro/SP é rejeitado",()=>{assert.equal(abrangenciaValida("municipal","SP","Campinas"),false);assert.equal(abrangenciaValida("municipal","RJ","Rio Claro"),false);});
test("não altera constraints de identidade, unique, PK ou FK",()=>{assert.doesNotMatch(migration,/drop\s+constraint[^;]*(?:unique|pkey|fkey)/i);assert.doesNotMatch(migration,/drop\s+index/i);assert.doesNotMatch(migration,/ro_calendario_identidade_uidx/i);});
test("carga não altera solicitações",()=>assert.doesNotMatch(migration,/(insert|update|delete)\s+(into\s+|from\s+)?public\.ro_passagem_solicitacoes/i));
test("seis recessos permanecem pendentes",()=>{const recessos=rows.filter((row)=>row.includes("'recesso','empresa'")&&/,false\),?$/.test(row));assert.equal(recessos.length,6);});
