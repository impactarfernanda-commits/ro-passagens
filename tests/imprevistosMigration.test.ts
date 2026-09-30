import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const migrationPath = "supabase/migrations/202609300003_estrutura_imprevistos_passagens_complementares.sql";
const migration = fs.readFileSync(migrationPath, "utf8");
const pages = fs.readFileSync("src/pages.tsx", "utf8");
const allMigrations = fs.readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .map((name) => fs.readFileSync(`supabase/migrations/${name}`, "utf8"))
  .join("\n");

test("migration cria marcador estrutural e restringe-o a passagem", () => {
  assert.match(migration, /passagem_complementar boolean not null default false/i);
  assert.match(migration, /check\s*\(not passagem_complementar or tipo='passagem'\)/i);
});

test("backfill classifica apenas prefixo canônico com anexo complementar", () => {
  assert.match(migration, /c\.tipo='passagem'[\s\S]*c\.descricao like 'Passagem complementar: %'[\s\S]*a\.complementar=true/i);
  assert.doesNotMatch(migration, /a\.valor\s*=\s*c\.valor|c\.valor\s*=\s*a\.valor/i);
  assert.doesNotMatch(migration, /nome_arquivo\s*=|created_at\s*[<>=]/i);
});

test("prefixo histórico foi gerado pelo backend desde a primeira RPC complementar", () => {
  const rpcFiles = [
    "supabase/migrations/202607210003_ro_followup_passages_and_responsible.sql",
    "supabase/migrations/202608180001_fluxo_ro_pos_finalizacao_exclusao.sql",
    "supabase/migrations/202608210001_pacote_1_aprovadores_individuais_denise.sql",
  ];
  for (const path of rpcFiles) {
    const sql = fs.readFileSync(path, "utf8");
    assert.match(sql, /'Passagem complementar: '\s*\|\|/);
  }
  assert.doesNotMatch(allMigrations, /values\s*\([^;]*v_item->>'descricao'[^;]*passagem_complementar/is);
});

test("RPC complementar marca custo e liga anexo ao id retornado", () => {
  assert.match(migration, /created_by,passagem_complementar\)[\s\S]*auth\.uid\(\),true\)[\s\S]*returning id into v_custo/i);
  assert.match(migration, /update public\.ro_passagem_anexos set custo_id=v_custo where id=v_anexo/i);
});

test("backfill de custo_id usa somente IDs persistidos e valida relação", () => {
  assert.match(migration, /regexp_match\(h\.descricao,[^\n]*Anexo:/i);
  assert.match(migration, /a\.solicitacao_id=h\.solicitacao_id[\s\S]*a\.complementar=true[\s\S]*a\.custo_id is null/i);
  assert.match(migration, /c\.solicitacao_id=h\.solicitacao_id[\s\S]*c\.tipo='passagem'[\s\S]*c\.passagem_complementar=true/i);
  assert.match(migration, /count\(\*\) from validos x where x\.anexo_id=v\.anexo_id\)=1/i);
  assert.match(migration, /count\(\*\) from validos x where x\.custo_id=v\.custo_id\)=1/i);
});

test("fluxo pós-compra não define passagem complementar", () => {
  const postPurchase = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  assert.doesNotMatch(postPurchase, /passagem_complementar/);
  assert.doesNotMatch(migration, /ro_registrar_documentos_pos_compra[\s\S]*passagem_complementar=true/i);
});

test("card consulta e filtra exclusivamente pelo marcador estrutural", () => {
  assert.match(pages, /created_at,passagem_complementar,solicitacao:/);
  assert.match(pages, /custosDePassagensComplementares\(custosMensais\)/);
  const dashboard = pages.slice(pages.indexOf("export function Dashboard"), pages.indexOf("export function", pages.indexOf("export function Dashboard") + 1));
  assert.doesNotMatch(dashboard, /descricao\.includes\("imprevisto"\)|anexo\.imprevisto|solicitacao\.houve_imprevisto/);
  assert.match(dashboard, /consolidarFinanceiro\(custosImprevistos\)/);
});

test("migration é transacional e não altera valores históricos", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /set\s+valor\s*=/i);
});
