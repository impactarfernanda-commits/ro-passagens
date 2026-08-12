import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const diagnostic = fs.readFileSync("supabase/manual/diagnosticar_colaborador_p_incorreto.sql", "utf8");
const dryRun = fs.readFileSync("supabase/manual/remover_colaborador_p_incorreto_dry_run.sql", "utf8");
const definitive = fs.readFileSync("supabase/manual/remover_colaborador_p_incorreto_controlado.sql", "utf8");

test("diagnóstico localiza P exato sem projetar dados pessoais", () => {
  assert.match(diagnostic, /where trim\(e\.nome\) = 'P'/i);
  assert.match(diagnostic, /quantidade_solicitacoes_associadas/);
  assert.match(diagnostic, /outras_referencias_conhecidas/);
  assert.doesNotMatch(diagnostic, /e\.(cpf|rg|telefone|cep|logradouro|numero|complemento|bairro|cidade|uf)\b/i);
});

for (const [name, sql] of [["dry-run", dryRun], ["definitivo", definitive]] as const) {
  test(`${name} bloqueia ausência, ambiguidade, vínculo e qualquer FK`, () => {
    assert.match(sql, /v_quantidade <> 1/);
    assert.match(sql, /v_funcionario_id is not null/);
    assert.match(sql, /pg_constraint/);
    assert.match(sql, /c\.confrelid = 'public\.ro_funcionarios_enderecos_privados'::regclass/);
    assert.match(sql, /if v_referencias > 0/);
    assert.match(sql, /alternativa segura: inativacao/);
  });
  test(`${name} restringe DELETE ao único P sem vínculo e sem UUID fixo`, () => {
    assert.match(sql, /delete from public\.ro_funcionarios_enderecos_privados where id = v_id and trim\(nome\) = 'P' and funcionario_id is null/i);
    assert.match(sql, /v_excluidos <> 1/);
    assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });
}

test("dry-run termina em rollback e definitivo mantém guardas idênticas", () => {
  assert.match(dryRun, /begin;[\s\S]*rollback;/i);
  assert.match(definitive, /begin;[\s\S]*commit;/i);
  for (const guard of ["v_quantidade <> 1", "v_funcionario_id is not null", "if v_referencias > 0", "v_excluidos <> 1"]) {
    assert.ok(dryRun.includes(guard) && definitive.includes(guard), guard);
  }
});
