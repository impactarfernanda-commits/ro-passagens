import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aplicarResolucaoHospedagemLocal, hospedagemOperacionalPendente, justificativaHospedagemValida } from "../src/hospedagemOperationalRules.ts";
import { divergenciasDeData, locaisEquivalentesCompra } from "../src/passagemOperationalRules.ts";

const migration = readFileSync("supabase/migrations/202609230001_resolucoes_operacionais_compra.sql", "utf8");
const hardening = readFileSync("supabase/migrations/202609230002_endurece_resolucoes_operacionais_compra.sql", "utf8");
const page = readFileSync("src/pages.tsx", "utf8");

test("compra só bloqueia hospedagem prevista quando a decisão está ausente", () => {
  assert.equal(hospedagemOperacionalPendente(true, null), true);
  assert.equal(hospedagemOperacionalPendente(true, undefined), true);
  assert.equal(hospedagemOperacionalPendente(true, false), false);
  assert.equal(hospedagemOperacionalPendente(true, true), false);
  assert.equal(hospedagemOperacionalPendente(false, null), false);
});

test("dispensa salva atualiza imediatamente a resolução local preservando boolean false", () => {
  const atualizada = aplicarResolucaoHospedagemLocal([], false, "Alojamento disponível na obra.");
  assert.equal(atualizada[0].hospedagem_utilizada, false);
  assert.equal(atualizada[0].hospedagem_justificativa, "Alojamento disponível na obra.");
  assert.equal(hospedagemOperacionalPendente(true, atualizada[0].hospedagem_utilizada), false);
});

test("salvamento de hospedagem evita submissão simultânea e decisão idêntica", () => {
  assert.match(page, /if \(savingRef\.current \|\| decisaoInalterada\) return/);
  assert.match(page, /disabled=\{busy \|\| decisaoInalterada\}/);
  assert.match(page, /onResolved\(utilizada === "sim", justificativaNormalizada\)/);
});

test("hospedagem utilizada preserva custo positivo; dispensa exige justificativa e remove custo", () => {
  assert.equal(justificativaHospedagemValida("Alojamento disponível na obra."), true);
  assert.equal(justificativaHospedagemValida("curta"), false);
  assert.match(migration, /p_hospedagem_utilizada and \(p_valor_total is null[\s\S]+p_valor_total<=0\)/i);
  assert.match(migration, /JUSTIFICATIVA_HOSPEDAGEM_MINIMO_10_CARACTERES/);
  assert.match(migration, /delete from public\.ro_passagem_custos where solicitacao_id=p_solicitacao_id and tipo='hospedagem'/i);
  assert.match(page, /Hospedagem foi necessária no atendimento\?/);
  assert.match(page, /Justificativa para não utilização da hospedagem/);
});

test("resolução não altera a previsão original e registra autor/data na auditoria", () => {
  assert.doesNotMatch(migration, /update public\.ro_passagem_solicitacoes set necessita_hospedagem/i);
  assert.match(migration, /hospedagem_confirmado_por uuid references auth\.users/);
  assert.match(migration, /hospedagem_confirmado_em timestamptz/);
  assert.match(migration, /insert into public\.ro_auditoria_interna[\s\S]+hospedagem_resolvida/);
});

test("data igual segue fluxo normal e data de ida divergente exige confirmação", () => {
  const solicitado = { origem: "Belém / PA", destino: "São Paulo / SP", data_ida: "2026-09-22", data_retorno: "2026-09-30" };
  assert.deepEqual(divergenciasDeData([{ origem: solicitado.origem, destino: solicitado.destino, partida_em: "2026-09-22T10:00" }], solicitado), []);
  assert.deepEqual(divergenciasDeData([{ origem: solicitado.origem, destino: solicitado.destino, partida_em: "2026-09-27T10:00" }], solicitado), [{ sentido: "ida", data_solicitada: "2026-09-22", data_comprada: "2026-09-27" }]);
  assert.match(migration, /CONFIRMACAO_DATA_DIVERGENTE_OBRIGATORIA/);
  assert.match(migration, /JUSTIFICATIVA_DATA_DIVERGENTE_MINIMO_10_CARACTERES/);
});

test("ida e retorno são comparados com suas datas correspondentes", () => {
  const solicitado = { origem: "Belém / PA", destino: "São Paulo / SP", data_ida: "2026-09-22", data_retorno: "2026-09-30" };
  const divergencias = divergenciasDeData([
    { origem: "Belém / PA", destino: "São Paulo / SP", partida_em: "2026-09-22T08:00" },
    { origem: "São Paulo / SP", destino: "Belém / PA", partida_em: "2026-10-01T18:00" },
  ], solicitado);
  assert.deepEqual(divergencias, [{ sentido: "retorno", data_solicitada: "2026-09-30", data_comprada: "2026-10-01" }]);
});

test("trechos múltiplos ambíguos não geram falso alerta e trecho único usa ida com segurança", () => {
  const solicitado = { origem: "Belém / PA", destino: "São Paulo / SP", data_ida: "2026-09-22", data_retorno: "2026-09-30" };
  assert.deepEqual(divergenciasDeData([
    { origem: "", destino: "", partida_em: "2026-09-27T08:00" },
    { origem: "", destino: "", partida_em: "2026-09-30T18:00" },
  ], solicitado), []);
  assert.equal(divergenciasDeData([{ origem: "", destino: "", partida_em: "2026-09-27T08:00" }], solicitado)[0]?.sentido, "ida");
});

test("backend persiste datas efetivas, justificativa, usuário e instante sem sobrescrever data solicitada", () => {
  assert.match(migration, /divergencias_data jsonb/);
  assert.match(migration, /data_confirmado_por uuid references auth\.users/);
  assert.match(migration, /data_confirmado_em timestamptz/);
  assert.doesNotMatch(migration, /update public\.ro_passagem_solicitacoes set data_ida/i);
  assert.match(migration, /data_passagem_divergente_confirmada/);
  assert.match(page, /Data solicitada:/);
  assert.match(page, /Data da passagem:/);
});

test("regra de horário anterior continua independente", () => {
  assert.match(migration, /CONFIRMACAO_HORARIO_ANTERIOR_OBRIGATORIA/);
  assert.match(page, /COMPRA_HORARIO_ALERTA/);
});

test("fase 1 mantém endpoints antigos e oferece RPC v2 sem overload", () => {
  assert.match(migration, /create or replace function public\.ro_registrar_compra_v2\(/i);
  assert.doesNotMatch(migration, /create or replace function public\.ro_registrar_compra\(/i);
  assert.doesNotMatch(migration, /revoke all on function public\.ro_registrar_hospedagem/i);
  assert.doesNotMatch(migration, /revoke all on function public\.ro_registrar_compra\(/i);
  assert.match(page, /supabase\.rpc\("ro_registrar_compra_v2"/);
  assert.match(page, /supabase\.rpc\("ro_resolver_hospedagem"/);
});

test("fase 2 revoga endpoints antigos e fecha escrita direta de custos", () => {
  assert.match(hardening, /revoke all on function public\.ro_registrar_hospedagem\(uuid,numeric\)[^;]+authenticated/i);
  assert.match(hardening, /revoke all on function public\.ro_registrar_compra\(uuid,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,boolean,time\)[^;]+authenticated/i);
  assert.match(hardening, /revoke insert,update,delete on table public\.ro_passagem_custos from anon,authenticated/i);
  assert.match(hardening, /deferrable initially deferred/i);
});

test("backend usa partida efetiva quando p_trechos está vazio", () => {
  assert.match(migration, /v_datas_validas=0 and p_partida_em is not null/i);
  assert.match(migration, /p_partida_em at time zone 'America\/Sao_Paulo'/i);
  assert.match(migration, /v_data<>v_esperada[\s\S]+data_comprada/i);
});

test("trecho sem data é ignorado e não vira falsa divergência", () => {
  assert.deepEqual(divergenciasDeData([{ origem: "Belém", destino: "São Paulo", partida_em: "" }], {
    origem: "Belém", destino: "São Paulo", data_ida: "2026-09-22",
  }), []);
  assert.match(migration, /v_data:=public\.ro_data_compra_segura[\s\S]+if v_data is null then continue/i);
  assert.doesNotMatch(migration, /v_data is distinct from v_esperada/i);
});

test("normalização de cidades alinha acentos, caixa, espaços e UF opcional", () => {
  assert.equal(locaisEquivalentesCompra("  SÃO   PAULO / SP ", "Sao Paulo / sp"), true);
  assert.equal(locaisEquivalentesCompra("São Paulo / SP", "sao paulo"), true);
  assert.equal(locaisEquivalentesCompra("São Paulo / SP", "São Paulo / RJ"), false);
  assert.match(migration, /ro_normalizar_local_compra/);
  assert.match(migration, /ro_locais_equivalentes_compra/);
});

test("divergencias_data possui shape, sentido, datas, diferença e justificativa protegidos", () => {
  assert.match(migration, /coalesce\(v_item->>'sentido',''\) not in\('ida','retorno'\)/i);
  assert.match(migration, /v_solicitada is null or v_comprada is null or v_solicitada=v_comprada/i);
  assert.match(migration, /char_length\(btrim\(coalesce\(v_item->>'justificativa',''\)\)\)<10/i);
  assert.match(migration, /jsonb_array_length\(divergencias_data\)=0 and data_confirmado_por is null and data_confirmado_em is null/i);
  assert.match(migration, /jsonb_array_length\(divergencias_data\)>0 and data_confirmado_por is not null and data_confirmado_em is not null/i);
});

test("hospedagem rejeita não finitos e coerência final exige zero ou um custo positivo", () => {
  assert.match(migration, /p_valor_total::text in\('NaN','Infinity','-Infinity'\)/i);
  assert.match(migration, /HOSPEDAGEM_DISPENSADA_NAO_PODE_TER_CUSTO/);
  assert.match(hardening, /v_utilizada=false and v_quantidade<>0/i);
  assert.match(hardening, /v_utilizada=true and\(v_quantidade<>1 or v_positivos<>1\)/i);
});

test("confirmações ficam vinculadas ao fingerprint e são invalidadas quando documentos mudam", () => {
  assert.match(page, /const confirmationFingerprint = JSON\.stringify/);
  assert.match(page, /documentos: pdfs\.map/);
  assert.match(page, /confirmacaoHorarioRef\.current=null/);
  assert.match(page, /confirmacaoDataRef\.current=null/);
  assert.match(page, /confirmacaoHorarioRef\.current !== confirmationFingerprint/);
  assert.match(page, /confirmacaoDataRef\.current !== confirmationFingerprint/);
});

test("proteção de compra_chave permanece na RPC v2", () => {
  assert.match(migration, /IDENTIDADE_COMPRA_PASSAGEM_OBRIGATORIA/);
  assert.match(migration, /IDENTIDADE_COMPRA_PASSAGEM_INVALIDA/);
  assert.match(migration, /CUSTO_PASSAGEM_DUPLICADO_NA_MESMA_COMPRA/);
});
