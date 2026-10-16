import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calcularDataMinima, regraPrazo } from "../src/passagemRules.ts";

const migration=readFileSync(new URL("../supabase/migrations/202610150002_aplica_corte_1630_admissao_rh.sql",import.meta.url),"utf8");
const prevalidator=readFileSync(new URL("../supabase/manual/prevalidar_corte_admissao_20261015.sql",import.meta.url),"utf8");
const dryRun=readFileSync(new URL("../supabase/manual/DRY_RUN_202610150002_corte_admissao.sql",import.meta.url),"utf8");
const rollbackValidator=readFileSync(new URL("../supabase/manual/validar_rollback_corte_admissao_20261015.sql",import.meta.url),"utf8");
const postValidator=readFileSync(new URL("../supabase/manual/validar_corte_admissao_pos_instalacao_20261015.sql",import.meta.url),"utf8");
const page=readFileSync(new URL("../src/pages.tsx",import.meta.url),"utf8");
const regra=regraPrazo("admissao",null,true);
const anos=[{ano:2026,completo:true}];
const minimo=(agora:string,diasNaoUteis:Array<{data:string;ativo:boolean}>=[])=>calcularDataMinima(new Date(agora),regra.tipo,regra.quantidade,diasNaoUteis,anos).data;

test("frontend mantém admissão inclusiva antes e exatamente no corte de quinta-feira",()=>{
  assert.equal(minimo("2026-10-15T16:29:59-03:00"),"2026-10-20");
  assert.equal(minimo("2026-10-15T16:30:00-03:00"),"2026-10-20");
});

test("frontend avança admissão somente após 16h30",()=>{
  assert.equal(minimo("2026-10-15T16:30:01-03:00"),"2026-10-21");
  assert.equal(minimo("2026-10-15T23:59:00-03:00"),"2026-10-21");
});

test("sexta-feira reutiliza o corte canônico de 15h30",()=>{
  assert.equal(minimo("2026-10-16T15:30:00-03:00"),"2026-10-21");
  assert.equal(minimo("2026-10-16T15:30:01-03:00"),"2026-10-22");
});

test("fim de semana e calendário não útil continuam participando do helper canônico",()=>{
  assert.equal(minimo("2026-10-15T10:00:00-03:00"),"2026-10-20");
  assert.equal(minimo("2026-10-15T10:00:00-03:00",[{data:"2026-10-16",ativo:true}]),"2026-10-21");
  assert.equal(minimo("2026-10-15T16:31:00-03:00",[{data:"2026-10-16",ativo:true}]),"2026-10-22");
});

test("formulário usa o helper genérico e mantém a data mínima inclusiva",()=>{
  assert.match(page,/calcularDataMinima\(new Date\(\), regra\.tipo, regra\.quantidade, diasNaoUteis, anosCalendario\)/);
  assert.match(page,/min=\{dataMinimaInput \|\| undefined\}/);
  assert.match(page,/form\.data_ida < dataMinimaInput/);
});

test("migration nova reutiliza now e não altera a regra efetiva nem o helper",()=>{
  assert.match(migration,/if v_reg\.prazo_tipo='dias_uteis' then v_min:=public\.ro_data_minima_util\(now\(\),v_reg\.prazo_quantidade\)/);
  assert.doesNotMatch(migration,/\(v_hoje\+time '12:00'\)/);
  assert.doesNotMatch(migration,/create or replace function public\.ro_prazo_regra_efetiva/);
  assert.doesNotMatch(migration,/create or replace function public\.ro_data_minima_util/);
});

test("dry run incorpora literalmente a migration e sempre termina em rollback",()=>{
  const embedded=dryRun.match(/-- MIGRATION_202610150002_BEGIN\r?\n([\s\S]*?)-- MIGRATION_202610150002_END/)?.[1].trim();
  assert.equal(embedded,migration.trim());
  assert.match(dryRun,/^begin;/i);
  assert.match(dryRun,/rollback;\s*$/i);
  assert.doesNotMatch(dryRun,/\bcommit\s*;/i);
});

test("pacote operacional cobre os indicadores e não injeta relógio na produção",()=>{
  for(const indicador of [
    "admissao_4_dias_uteis_instalada","dia_viagem_conta","backend_ainda_usa_meio_dia",
    "nova_regra_com_now_ainda_ausente","pronto_para_dry_run"
  ]) assert.match(prevalidator,new RegExp(indicador));
  for(const indicador of [
    "admissao_usa_now","segunda_163000_conta","segunda_163001_nao_conta","sexta_153000_conta",
    "sexta_153001_nao_conta","datepicker_backend_alinhados","data_minima_atual_permitida",
    "data_anterior_bloqueada","fim_semana_ignorado","feriado_ignorado","somente_delta_esperado","todos_aprovados"
  ]) assert.match(dryRun,new RegExp(indicador));
  assert.match(rollbackValidator,/rollback_confirmado/);
  assert.match(postValidator,/todos_aprovados/);
  assert.doesNotMatch(migration,/p_agora|clock_timestamp|set_config/);
});
