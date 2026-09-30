import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const page = fs.readFileSync("src/pages.tsx", "utf8");
const sql = fs.readFileSync("supabase/migrations/202609300001_permite_cadastro_retroativo_equipe_ro.sql", "utf8");

test("frontend libera mínimo somente para operador RO ativo", () => {
  assert.match(page, /operadorRoPodeCadastrarRetroativa = access\.canOperateRO/);
  assert.match(page, /operadorRoPodeCadastrarRetroativa \? "" : dataMinimaDoInput/);
  assert.match(page, /!operadorRoPodeCadastrarRetroativa && form\.data_ida < dataMinimaInput/);
  assert.match(page, /min=\{dataMinimaInput \|\| undefined\}/);
});

test("operador RO não envia justificativa fictícia de prazo", () => {
  assert.match(page, /solicitar_excecao_prazo:!operadorRoPodeCadastrarRetroativa/);
  assert.match(page, /!operadorRoPodeCadastrarRetroativa && podeExcepcionarPrazo/);
});

test("backend usa operador RO ativo e mantém usuários comuns protegidos", () => {
  assert.match(sql, /v_operador_ro boolean:=coalesce\(public\.ro_is_operador_ativo\(auth\.uid\(\)\),false\)/);
  assert.match(sql, /new\.data_ida<v_hoje and not v_operador_ro/);
  assert.match(sql, /not v_operador_ro and not v_can_excepcionar_prazo/);
  assert.match(sql, /not v_operador_ro and length\(trim/);
});

test("coerência de retorno continua protegida no frontend e no banco", () => {
  assert.match(page, /form\.data_retorno && form\.data_retorno < form\.data_ida/);
  const base = fs.readFileSync("supabase/migrations/202607170001_create_ro_passagens.sql", "utf8");
  assert.match(base, /data_retorno is null or data_retorno >= data_ida/);
});

test("auditoria existente marca exceção sem mudar aprovação ou status", () => {
  assert.match(sql, /new\.prazo_excecao:=true/);
  assert.match(sql, /'operador_ro',v_operador_ro/);
  assert.doesNotMatch(sql, /aprovador|aprovacao_status|comprado_em|status\s*:=/i);
});
