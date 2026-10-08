import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  COMPLEMENTARY_COST_CENTER_REQUIRED,
  COMPLEMENTARY_COST_CENTER_UNAVAILABLE,
  complementaryCostCenters,
  complementaryCostCenterValidationMessage,
  complementaryPassageErrorMessage,
} from "../src/complementaryPassage.ts";
import type { Obra } from "../src/types.ts";

const page = fs.readFileSync("src/pages.tsx", "utf8");
const request = {
  obra_id: "obra",
  centro_custo_destino_id: "destino",
  centro_custo_retorno_id: "retorno",
};
const center = (id: string, patch: Partial<Obra> = {}): Obra => ({
  id,
  nome: id,
  visivel_passagens: true,
  escopo_passagens: "comum",
  ...patch,
});

test("modo complementar inicia sem centro de custo selecionado", () => {
  assert.match(page, /centro_custo_id:\s*""/);
  assert.match(page, /<option value="">Selecione o centro de custo<\/option>/);
});

test("validação de centro de custo ocorre antes do upload e da RPC", () => {
  const validation = page.indexOf("complementaryCostCenterValidationMessage(");
  const upload = page.indexOf('.from("ro-passagem-anexos")', validation);
  const rpc = page.indexOf('supabase.rpc("ro_registrar_passagem_complementar_v2"', validation);
  assert.ok(validation >= 0 && upload > validation && rpc > upload);
  assert.equal(
    complementaryCostCenterValidationMessage("", [center("obra")]),
    COMPLEMENTARY_COST_CENTER_REQUIRED,
  );
  assert.match(page, /onInvalid=\{\(e\) => \{[\s\S]*?Selecione o centro de custo da passagem complementar\./);
});

test("seletor contém somente obra, destino e retorno vinculados", () => {
  assert.deepEqual(
    complementaryCostCenters(request, [
      center("outro"),
      center("retorno"),
      center("obra"),
      center("destino"),
    ]).map(({ id }) => id),
    ["retorno", "obra", "destino"],
  );
});

test("IDs repetidos aparecem uma única vez pelo catálogo", () => {
  assert.deepEqual(
    complementaryCostCenters(
      { ...request, centro_custo_destino_id: "obra" },
      [center("obra"), center("obra"), center("retorno")],
    ).map(({ id }) => id),
    ["obra", "retorno"],
  );
});

test("centro invisível ou fora dos escopos permitidos não aparece", () => {
  assert.deepEqual(
    complementaryCostCenters(request, [
      center("obra", { visivel_passagens: false }),
      center("destino", { escopo_passagens: "indisponivel" }),
      center("retorno", { escopo_passagens: "restrito_ro" }),
    ]).map(({ id }) => id),
    ["retorno"],
  );
});

test("catálogo sem os marcadores explícitos de elegibilidade falha fechado", () => {
  assert.deepEqual(
    complementaryCostCenters(request, [{ id: "obra", nome: "Obra" }]),
    [],
  );
  assert.match(page, /select\("id,codigo,descricao,visivel_passagens,escopo_passagens"\)/);
});

test("centro selecionado é enviado em anexos e custos complementares", () => {
  assert.match(page, /anexosComplementaresPorDocumento\.set\(pdf\.id,\{\.\.\.metadata,conteudo_sha256:pdf\.conteudo_sha256,client_ref:pdf\.id,centro_custo_id:form\.centro_custo_id\}\)/);
  assert.match(page, /buildPurchaseCosts\([\s\S]*?form\.centro_custo_id/);
});

test("ausência de centro elegível bloqueia com mensagem própria", () => {
  assert.equal(
    complementaryCostCenterValidationMessage("", []),
    COMPLEMENTARY_COST_CENTER_UNAVAILABLE,
  );
  assert.match(page, /disabled=\{centrosComplementares\.length === 0\}/);
  assert.match(page, /pdfs\.length === 0 \|\| centrosComplementares\.length === 0/);
});

test("erro técnico de centro de custo recebe mensagem amigável", () => {
  assert.equal(
    complementaryPassageErrorMessage("CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO"),
    "O centro de custo selecionado não está disponível para esta solicitação.",
  );
  assert.equal(complementaryPassageErrorMessage("OUTRO_ERRO"), "OUTRO_ERRO");
});

test("compra comum mantém catálogo completo e RPC própria", () => {
  assert.match(page, /\{obras\.map\(\(obra\) => \(/);
  assert.match(page, /supabase\.rpc\("ro_registrar_compra_v2"/);
});
