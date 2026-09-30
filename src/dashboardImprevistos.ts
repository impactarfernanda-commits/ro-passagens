export type CustoIndicadorImprevisto = {
  solicitacao_id: string;
  tipo: string;
  valor: number;
  passagem_complementar: boolean;
};

export function custosDePassagensComplementares<T extends CustoIndicadorImprevisto>(
  custos: T[],
) {
  return custos.filter(
    (custo) =>
      custo.tipo === "passagem" &&
      custo.passagem_complementar === true &&
      Number(custo.valor) > 0,
  );
}

export function resumoImprevistosComPassagens(
  custos: CustoIndicadorImprevisto[],
) {
  const complementares = custosDePassagensComplementares(custos);
  return {
    quantidade: new Set(complementares.map((custo) => custo.solicitacao_id)).size,
    valor: complementares.reduce(
      (total, custo) => total + Number(custo.valor),
      0,
    ),
  };
}
