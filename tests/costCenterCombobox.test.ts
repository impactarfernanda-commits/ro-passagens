import assert from "node:assert/strict";
import test from "node:test";
import { filterCostCenters, normalizeCostCenterSearch } from "../src/costCenterSearch.ts";
import type { Obra } from "../src/types.ts";

const obras = [
  { id: "1", codigo: "04.0003.01", nome: "Diretoria Geral" },
  { id: "2", codigo: "10.2000", nome: "Operação São Paulo" },
  { id: "3", codigo: null, nome: "Administrativo" },
] as Obra[];

test("busca centro de custo por código completo e parcial", () => {
  assert.equal(filterCostCenters(obras, "04.0003.01")[0].id, "1");
  assert.equal(filterCostCenters(obras, "0003")[0].id, "1");
});

test("busca nome ignorando caixa, acentos e espaços repetidos", () => {
  assert.equal(filterCostCenters(obras, "  OPERACAO   sao  ")[0].id, "2");
  assert.equal(normalizeCostCenterSearch("Diretória"), "diretoria");
});

test("busca combinação código e nome e prioriza código exato", () => {
  assert.equal(filterCostCenters(obras, "04.0003.01 diretoria")[0].id, "1");
  assert.equal(filterCostCenters([obras[2], obras[0]], "04.0003.01")[0].id, "1");
});

test("texto inexistente não produz nem cria opção", () => assert.deepEqual(filterCostCenters(obras, "99.9999"), []));
