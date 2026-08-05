import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/202608050004_altera_prazo_programado_outros_15_dias.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const dryRun = readFileSync(new URL("../supabase/manual/DRY_RUN_202608050004_altera_prazo_programado_outros_15_dias.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const verification = readFileSync(new URL("../supabase/manual/verificar_prazo_programado_outros_15_dias.sql", import.meta.url), "utf8");
const frontend = readFileSync(new URL("../src/passagemRules.ts", import.meta.url), "utf8");
const latestValidation = readFileSync(new URL("../supabase/migrations/202608050001_usa_data_ida_nas_regras_prazo.sql", import.meta.url), "utf8");
const body = (sql: string) => sql.replace(/^\s*begin;\s*/i, "").replace(/\s*(commit|rollback);\s*$/i, "").trim();

test("migration é complementar e transacional", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.equal((migration.match(/create or replace function public\.ro_prazo_regra/g) || []).length, 1);
});

test("banco define programado_outros como 15 dias corridos", () => {
  assert.match(migration, /p_subtipo='programado_outros' then 15/);
  assert.match(migration, /else 'dias_corridos' end/);
  assert.doesNotMatch(migration, /p_subtipo='programado_outros' then 25/);
});

test("frontend e banco usam a mesma quantidade", () => {
  assert.match(frontend, /subtipo === "programado_outros"[\s\S]*?quantidade: 15/);
  assert.match(migration, /p_subtipo='programado_outros' then 15/);
});

test("demais regras permanecem na função integral", () => {
  assert.match(migration, /p_subtipo in \('justa_causa','pedido_demissao'\) then 0/);
  assert.match(migration, /p_subtipo='ma_conduta'[\s\S]*?then 5/);
  assert.match(migration, /p_motivo='ferias' then 25/);
  assert.match(migration, /'folga_campo','transferencia_obra','admissao','retorno_obra'\) then 15/);
  assert.match(migration, /p_motivo='recesso' then 30/);
  assert.match(migration, /p_motivo='inicio_obra'[\s\S]*?'dias_uteis'/);
});

test("migration não altera solicitações históricas", () => {
  assert.doesNotMatch(migration, /\b(update|insert into|delete from|merge into)\s+public\.ro_passagem_solicitacoes\b/i);
  assert.doesNotMatch(migration, /\balter table\b/i);
});

test("validação continua baseada em Data de ida e grava o snapshot", () => {
  assert.match(latestValidation, /if new\.data_ida is null then raise exception 'DATA_IDA_OBRIGATORIA'/);
  assert.match(latestValidation, /if new\.data_ida<v_min then/);
  assert.match(latestValidation, /new\.prazo_quantidade:=v_reg\.prazo_quantidade/);
  assert.match(latestValidation, /new\.prazo_tipo:=v_reg\.prazo_tipo/);
  assert.match(latestValidation, /new\.data_minima_permitida:=v_min/);
});

test("exceção gerencial e justificativa permanecem na validação vigente", () => {
  assert.match(latestValidation, /if not v_is_gerencial then raise exception 'FORA_DO_PRAZO/);
  assert.match(latestValidation, /JUSTIFICATIVA_EXCECAO_OBRIGATORIA/);
});

test("DRY RUN replica integralmente a migration e termina em rollback", () => {
  assert.match(dryRun, /^begin;/i);
  assert.match(dryRun, /rollback;\s*$/i);
  assert.doesNotMatch(dryRun, /^\s*commit;\s*$/im);
  assert.equal(body(dryRun), body(migration));
});

test("verificação é somente leitura e cobre regra e snapshots históricos", () => {
  assert.match(verification, /pg_get_functiondef/);
  assert.match(verification, /ro_prazo_regra\('desligamento','programado_outros'\)/);
  assert.match(verification, /prazo_quantidade/);
  assert.match(verification, /desligamento_subtipo = 'programado_outros'/);
  assert.doesNotMatch(verification, /\b(update|insert|delete|merge|alter|create|drop|truncate)\b/i);
});

test("migration altera somente a função central de regra", () => {
  assert.doesNotMatch(migration, /ro_criar_solicitacao_validada|ro_validar_nova_solicitacao|service_role/);
});
