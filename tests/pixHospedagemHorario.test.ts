import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { COMPRA_HORARIO_ALERTA, horarioLocalDaPartida, partidaAnteriorAoSolicitado } from "../src/passagemOperationalRules.ts";
import { emptyNovaSolicitacaoForm, parseDraft, serializeDraft } from "../src/novaSolicitacaoDraft.ts";

test("compara o relógio local sem inventar timezone", () => {
  assert.equal(horarioLocalDaPartida("2026-08-18T13:59"), "13:59");
  assert.equal(partidaAnteriorAoSolicitado("2026-08-18T13:59", "14:00:00"), true);
  assert.equal(partidaAnteriorAoSolicitado("2026-08-18T14:00", "14:00:00"), false);
  assert.equal(partidaAnteriorAoSolicitado("2026-08-18T14:01", "14:00:00"), false);
  assert.equal(partidaAnteriorAoSolicitado("2026-08-18T18:00", "14:00:00"), false);
  assert.equal(partidaAnteriorAoSolicitado("2026-08-18T13:59", null), false);
  assert.equal(COMPRA_HORARIO_ALERTA, "Horário anterior ao solicitado. Confirmar mesmo assim?");
});

test("PIX não é serializado no rascunho textual", () => {
  const form = { ...emptyNovaSolicitacaoForm(), pix_viajante: "pix-secreto", origem: "Porto Velho / RO" };
  const raw = serializeDraft({ form, solicitarExcecao:false, destinoDiferente:false, justificativaDestino:"" });
  assert.doesNotMatch(raw, /pix-secreto/);
  assert.equal(parseDraft(raw)?.form.pix_viajante, "");
  assert.equal(parseDraft(raw)?.form.origem, "Porto Velho / RO");
});

test("PIX privado é restaurado antes do fallback histórico", () => {
  const page = fs.readFileSync("src/pages.tsx", "utf8");
  assert.match(page, /privateData\?\.pix[\s\S]*draftPixRestoredRef\.current = true/);
  assert.match(page, /if \(!privateReady \|\| draftPixRestoredRef\.current\) return;/);
  assert.match(page, /ro_ultimo_pix_viajante/);
});

test("sucesso e cancelamento limpam o registro privado", () => {
  const page = fs.readFileSync("src/pages.tsx", "utf8");
  assert.ok((page.match(/deleteDraftPrivate\(privateRef\)/g) || []).length >= 2);
  assert.match(page, /if \(error\)[\s\S]*setBusy\(false\);[\s\S]*return;[\s\S]*deleteDraftPrivate\(privateRef\)/);
});

test("migration usa identidades explícitas e permissões mínimas", () => {
  const sql = fs.readFileSync("supabase/migrations/20260813200540_adiciona_pix_hospedagem_horario.sql", "utf8");
  assert.match(sql, /where s\.colaborador_id=p_colaborador_id/);
  assert.match(sql, /where s\.funcionario_id=p_funcionario_id/);
  assert.doesNotMatch(sql, /lower\(.*nome|email|cpf|similar/i);
  assert.match(sql, /revoke all on function public\.ro_ultimo_pix_viajante[\s\S]*from public,anon/);
  assert.match(sql, /grant execute on function public\.ro_ultimo_pix_viajante[\s\S]*to authenticated/);
});

test("frontend não mostra PIX na tabela e não cria horário de retorno", () => {
  const page = fs.readFileSync("src/pages.tsx", "utf8");
  assert.doesNotMatch(page.slice(0, page.indexOf("export function NovaSolicitacao")), /PIX do viajante/);
  assert.doesNotMatch(page, /Retorno a partir do horário/);
  assert.match(page, /p_horario_anterior_confirmado: divergenciaConfirmada/);
});
