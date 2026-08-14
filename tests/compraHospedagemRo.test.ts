import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { HOSPEDAGEM_ATTACHMENT_TYPE, isHospedagemAttachment, parseHospedagemValor } from "../src/hospedagemOperationalRules.ts";

const migration = fs.readFileSync("supabase/migrations/20260814120000_corrige_compra_hospedagem_ro.sql", "utf8");
const dry = fs.readFileSync("supabase/manual/DRY_RUN_20260814120000_corrige_compra_hospedagem.sql", "utf8");
const page = fs.readFileSync("src/pages.tsx", "utf8");

test("RPC canônica corrige a cadeia sem expor a função interna", () => {
  assert.match(migration, /ro_registrar_compra[^$]+security definer set search_path=public,pg_temp/i);
  assert.match(migration, /if not coalesce\(public\.ro_can_operate\(\),false\)/i);
  assert.match(migration, /perform public\.ro_registrar_compra_pre_operacional/i);
  assert.match(migration, /revoke all on function public\.ro_registrar_compra_pre_operacional[^;]+from public,anon,authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.ro_registrar_compra_pre_operacional/i);
  assert.match(page, /supabase\.rpc\("ro_registrar_compra"/);
});

test("hospedagem usa custo único, positivo e idempotente", () => {
  assert.match(migration, /tipo in \('passagem','hospedagem','uber','refeicao','outros'\)/);
  assert.match(migration, /unique index ro_passagem_custos_hospedagem_unico[^;]+where tipo='hospedagem'/i);
  assert.match(migration, /p_valor_total is null or p_valor_total<=0/i);
  assert.match(migration, /on conflict\(solicitacao_id\) where tipo='hospedagem' do update/i);
  assert.match(migration, /v_tinha_hospedagem[\s\S]+ro_registrar_compra_pre_operacional[\s\S]+if v_tinha_hospedagem/i);
});

test("voucher tem classificação explícita, permanece opcional e aceita múltiplos PDFs", () => {
  assert.equal(HOSPEDAGEM_ATTACHMENT_TYPE, "hospedagem_pdf");
  assert.equal(isHospedagemAttachment("hospedagem_pdf"), true);
  assert.equal(isHospedagemAttachment("passagem_pdf"), false);
  assert.match(migration, /tipo in \('passagem_pdf','hospedagem_pdf'\)/);
  assert.match(page, /Voucher opcional/);
  assert.match(page, /type="file"[^>]+multiple/);
});

test("valor da hospedagem falha fechado para entradas inválidas", () => {
  assert.equal(parseHospedagemValor("780.00"), 780);
  assert.equal(parseHospedagemValor("780,00"), 780);
  for (const invalid of ["", "texto", "NaN", "0", "-1"]) assert.equal(parseHospedagemValor(invalid), null);
});

test("UI mostra hospedagem somente quando solicitada e separa custos e documentos", () => {
  assert.match(page, /row\.necessita_hospedagem && !\["cancelada","recusada"\]/);
  assert.match(page, /Check-in:/);
  assert.match(page, /Check-out:/);
  assert.match(page, /Valor total gasto com a hospedagem/);
  assert.match(page, /Vouchers de hospedagem/);
  assert.match(page, /const hospedagem = soma\("hospedagem"\)/);
  assert.match(page, /totalPassagens \+ hospedagem \+ uber/);
});

test("regra de horário anterior e histórico permanecem na RPC canônica", () => {
  assert.match(migration, /CONFIRMACAO_HORARIO_ANTERIOR_OBRIGATORIA/);
  assert.match(migration, /Compra confirmada com horário anterior ao solicitado/);
  assert.match(page, /COMPRA_HORARIO_ALERTA/);
  assert.match(page, />Voltar</);
  assert.match(page, />Confirmar mesmo assim</);
});

test("dry-run replica a migration e termina em rollback", () => {
  const normalize = (value: string) => value.replace(/(?:commit|rollback);\s*$/i, "END;");
  assert.equal(normalize(dry), normalize(migration));
  assert.match(dry, /^begin;/i);
  assert.match(dry, /rollback;\s*$/i);
});
