import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detailedJustificationIsValid, travelLocationIsValid } from "../src/textQuality.ts";
import { motivoRecusaValido } from "../src/recusaRules.ts";

const page = readFileSync("src/pages.tsx", "utf8");
const migration = readFileSync("supabase/migrations/202609290003_valida_qualidade_preenchimento.sql", "utf8");

test("reprovação exige vinte caracteres significativos", () => {
  assert.equal(detailedJustificationIsValid("Data errada"), false);
  assert.equal(detailedJustificationIsValid("Texto ainda curto."), false);
  assert.equal(detailedJustificationIsValid("Data da viagem informada incorretamente."), true);
  assert.equal(detailedJustificationIsValid("...................."), false);
  assert.equal(detailedJustificationIsValid("--------------------"), false);
  assert.equal(detailedJustificationIsValid("   Motivo detalhado com ação necessária.   "), true);
  assert.match(page, /Informe um motivo mais detalhado, com pelo menos 20 caracteres\./);
});

test("exceção de prazo usa a mesma regra significativa", () => {
  assert.equal(detailedJustificationIsValid("Prazo curto"), false);
  assert.equal(detailedJustificationIsValid("Viagem solicitada após confirmação da obra."), true);
  assert.equal(detailedJustificationIsValid("...................."), false);
  assert.match(page, /justificativa_excecao_prazo\.trim\(\)\.length\}\/20 caracteres mínimos/);
});

test("origem e destino exigem três caracteres e ao menos uma letra Unicode", () => {
  for (const invalid of [".", "..", "...", "-", "---", "/", "///", "   .   ", "   "]) assert.equal(travelLocationIsValid(invalid), false);
  for (const valid of ["Itu", "Rio Claro - SP", "Cuiabá / MT", "São Paulo", "Paranaguá", "BR-163", "Porto do Mangue / RN"]) assert.equal(travelLocationIsValid(valid), true);
  assert.match(page, /Informe uma origem válida\./);
  assert.match(page, /Informe um destino válido\./);
});

test("frontend e backend usam a mesma classe latina explícita e independente de locale", () => {
  const latinLetters = "A-Za-zÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ";
  assert.match(readFileSync("src/textQuality.ts", "utf8"), new RegExp(`\\[${latinLetters}\\]`));
  assert.match(migration, new RegExp(`~ '${String.raw`\[`}${latinLetters}${String.raw`\]`}'`));
  assert.doesNotMatch(migration, /\[\[:alpha:\]\]|collate|lc_ctype/i);
});

test("backend protege chamada direta e não reescreve dados históricos", () => {
  assert.match(migration, /ro_texto_significativo\(new\.origem,3\)[\s\S]*ORIGEM_INVALIDA/);
  assert.match(migration, /ro_texto_significativo\(new\.destino,3\)[\s\S]*DESTINO_INVALIDO/);
  assert.match(migration, /ro_texto_significativo\(new\.justificativa_excecao_prazo,20\)/);
  assert.match(migration, /ro_texto_significativo\(m,20\)[\s\S]*MOTIVO_REPROVACAO_INVALIDO/);
  assert.match(migration, /tg_op='INSERT' or new\.origem is distinct from old\.origem/);
  assert.doesNotMatch(migration, /update\s+public\.ro_passagem_solicitacoes\s+set\s+(origem|destino)/i);
});

test("recusa operacional RO preserva a regra anterior de dez caracteres", () => {
  assert.equal(motivoRecusaValido("123456789"), false);
  assert.equal(motivoRecusaValido("1234567890"), true);
  assert.doesNotMatch(migration, /create or replace function public\.ro_recusar_solicitacao/i);
});
