import assert from "node:assert/strict";
import test from "node:test";
import {
  custosDePassagensComplementares,
  resumoImprevistosComPassagens,
  type CustoIndicadorImprevisto,
} from "../src/dashboardImprevistos.ts";

const custo = (
  solicitacao_id: string,
  tipo: string,
  valor: number,
  passagem_complementar = false,
): CustoIndicadorImprevisto => ({
  solicitacao_id,
  tipo,
  valor,
  passagem_complementar,
});

test("caso Maycon soma somente as duas passagens complementares", () => {
  const custos = [
    custo("maycon", "passagem", 1800),
    custo("maycon", "passagem", 1210.29),
    custo("maycon", "uber", 200),
    custo("maycon", "refeicao", 200),
    custo("maycon", "passagem", 2039.6, true),
    custo("maycon", "passagem", 123, true),
  ];
  assert.deepEqual(resumoImprevistosComPassagens(custos), {
    quantidade: 1,
    valor: 2162.6,
  });
});

test("duas complementares da mesma solicitação contam uma vez e somam ambas", () => {
  assert.deepEqual(
    resumoImprevistosComPassagens([
      custo("a", "passagem", 100, true),
      custo("a", "passagem", 50, true),
    ]),
    { quantidade: 1, valor: 150 },
  );
});

test("duas solicitações com complementares contam duas", () => {
  assert.equal(
    resumoImprevistosComPassagens([
      custo("a", "passagem", 100, true),
      custo("b", "passagem", 50, true),
    ]).quantidade,
    2,
  );
});

test("marcadores genéricos de imprevisto e anexos não participam do cálculo", () => {
  const custos = [
    { ...custo("a", "passagem", 100), houve_imprevisto: true },
    { ...custo("b", "passagem", 200), anexo_imprevisto: true },
    { ...custo("c", "uber", 300), anexo_complementar: true },
  ];
  assert.deepEqual(resumoImprevistosComPassagens(custos), {
    quantidade: 0,
    valor: 0,
  });
});

test("custos normais e passagem original não entram", () => {
  const custos = [
    custo("a", "passagem", 100),
    custo("a", "uber", 20),
    custo("a", "refeicao", 30),
    custo("a", "hospedagem", 40),
    custo("a", "outros", 50),
    custo("a", "passagem", 60, true),
  ];
  assert.deepEqual(custosDePassagensComplementares(custos), [custos[5]]);
});

test("marcador complementar não admite tipo diferente de passagem nem valor não positivo", () => {
  assert.deepEqual(
    resumoImprevistosComPassagens([
      custo("a", "uber", 100, true),
      custo("a", "passagem", 0, true),
      custo("a", "passagem", -1, true),
    ]),
    { quantidade: 0, valor: 0 },
  );
});
