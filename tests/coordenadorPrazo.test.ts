import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canExcepcionarPrazo,
  isGerencial,
  validarSolicitacao,
  type ValidacaoInput,
} from "../src/passagemRules.ts";

const agora = new Date("2026-08-03T10:00:00-03:00");
const base: ValidacaoInput = {
  motivo: "ferias",
  role: "assistente",
  isRh: false,
  dataIda: "2026-09-01",
  agora,
  anos: [{ ano: 2026, completo: true }],
  documentos: [],
};
const validar = (patch: Partial<ValidacaoInput>) => validarSolicitacao({ ...base, ...patch });
const justificativaValida = "Necessidade operacional urgente";
const page = readFileSync(new URL("../src/pages.tsx", import.meta.url), "utf8");
const backend = readFileSync(new URL("../supabase/migrations/20260827183517_permite_excecao_prazo_coordenador.sql", import.meta.url), "utf8");

test("coordenador dentro do prazo segue o fluxo normal sem exceção", () => {
  const resultado = validar({ role: "coordenador" });
  assert.equal(resultado.foraDoPrazo, false);
  assert.deepEqual(resultado.bloqueios, []);
});

test("coordenador fora do prazo pode solicitar exceção com justificativa", () => {
  assert.deepEqual(validar({ role: "coordenador", dataIda: "2026-08-10", solicitarExcecao: true, justificativa: justificativaValida }).bloqueios, []);
});

test("coordenador fora do prazo sem solicitar exceção é bloqueado", () => {
  assert.ok(validar({ role: "coordenador", dataIda: "2026-08-10" }).bloqueios.includes("EXCECAO_PRAZO_NAO_SOLICITADA"));
});

test("coordenador fora do prazo sem justificativa é bloqueado", () => {
  assert.ok(validar({ role: "coordenador", dataIda: "2026-08-10", solicitarExcecao: true, justificativa: "   " }).bloqueios.includes("JUSTIFICATIVA_EXCECAO_OBRIGATORIA"));
});

test("coordenador fora do prazo com menos de dez caracteres úteis é bloqueado", () => {
  assert.ok(validar({ role: "coordenador", dataIda: "2026-08-10", solicitarExcecao: true, justificativa: "  curta  " }).bloqueios.includes("JUSTIFICATIVA_EXCECAO_OBRIGATORIA"));
});

test("assistente e supervisor continuam bloqueados fora do prazo", () => {
  for (const role of ["assistente", "supervisor"]) {
    assert.ok(validar({ role, dataIda: "2026-08-10", solicitarExcecao: true, justificativa: justificativaValida }).bloqueios.includes("FORA_DO_PRAZO"));
    assert.equal(canExcepcionarPrazo(role), false);
  }
});

test("gerente e diretor preservam a exceção vigente", () => {
  for (const role of ["gerente", "diretor"]) {
    assert.deepEqual(validar({ role, dataIda: "2026-08-10", solicitarExcecao: true, justificativa: justificativaValida }).bloqueios, []);
  }
});

test("coordenador pode excepcionar sem ser classificado como gerencial", () => {
  assert.equal(canExcepcionarPrazo("coordenador"), true);
  assert.equal(isGerencial("coordenador"), false);
  assert.equal(isGerencial("gerente"), true);
  assert.equal(isGerencial("diretor"), true);
});

test("formulário oferece exceção ao coordenador e exige dez caracteres", () => {
  assert.match(page, /const podeExcepcionarPrazo = canExcepcionarPrazo\(access\.role\)/);
  assert.match(page, /Esta solicitação está fora da antecedência mínima\./);
  assert.match(page, /Justificativa da exceção \*[\s\S]*minLength=\{10\}/);
  assert.match(page, /solicitar_excecao_prazo:podeExcepcionarPrazo&&permiteExcecaoPrazo&&solicitarExcecao/);
});

test("aprovação individual permanece no payload e na RPC canônica", () => {
  assert.match(page, /if \(!dispensaAprovacao && !form\.aprovador_id\)/);
  assert.match(page, /const payload=normalizarCamposRetorno\(\{\.\.\.form,/);
  assert.match(page, /ro_criar_solicitacao_com_aprovador/);
  assert.doesNotMatch(page, /podeExcepcionarPrazo[^;]*(aprovador_id|aprovacao_status)/);
});

test("frontend e backend usam os mesmos três papéis para a exceção", () => {
  assert.match(backend, /v_can_excepcionar_prazo boolean:=coalesce\(v_role,''\) in \('coordenador','gerente','diretor'\)/);
  for (const role of ["coordenador", "gerente", "diretor"]) assert.equal(canExcepcionarPrazo(role), true);
  for (const role of ["assistente", "supervisor", null]) assert.equal(canExcepcionarPrazo(role), false);
});

test("backend preserva classificação gerencial exclusiva de gerente e diretor", () => {
  assert.match(backend, /v_is_gerencial boolean:=coalesce\(v_role,''\) in \('gerente','diretor'\)/);
  assert.match(backend, /if not v_can_excepcionar_prazo then raise exception 'FORA_DO_PRAZO/);
});
