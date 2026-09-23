export const COMPRA_HORARIO_ALERTA = "Horário anterior ao solicitado. Confirmar mesmo assim?";
export const COMPRA_DATA_ALERTA = "A data da passagem é diferente da data solicitada.";

export type TrechoCompra = {
  origem: string;
  destino: string;
  partida_em: string;
};

export type DivergenciaDataCompra = {
  sentido: "ida" | "retorno";
  data_solicitada: string;
  data_comprada: string;
};

export function normalizarLocalCompra(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function locaisEquivalentesCompra(left: string, right: string) {
  const a = normalizarLocalCompra(left);
  const b = normalizarLocalCompra(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const uf = /\s*\/\s*[a-z]{2}$/;
  return a.replace(uf, "") === b.replace(uf, "") && (!uf.test(a) || !uf.test(b));
}

function dataLocal(partida: string) {
  return partida.match(/^(\d{4}-\d{2}-\d{2})T/)?.[1] || null;
}

export function divergenciasDeData(
  trechos: TrechoCompra[],
  solicitado: { origem: string; destino: string; data_ida: string; data_retorno?: string | null },
) {
  const validos = trechos.filter((trecho) => dataLocal(trecho.partida_em));
  const resultado: DivergenciaDataCompra[] = [];
  for (const trecho of validos) {
    let sentido: "ida" | "retorno" | null = null;
    if (locaisEquivalentesCompra(trecho.origem, solicitado.origem) && locaisEquivalentesCompra(trecho.destino, solicitado.destino)) sentido = "ida";
    else if (locaisEquivalentesCompra(trecho.origem, solicitado.destino) && locaisEquivalentesCompra(trecho.destino, solicitado.origem) && solicitado.data_retorno) sentido = "retorno";
    else if (validos.length === 1) sentido = "ida";
    if (!sentido) continue;
    const efetiva = dataLocal(trecho.partida_em)!;
    const esperada = sentido === "ida" ? solicitado.data_ida : solicitado.data_retorno!;
    if (efetiva !== esperada && !resultado.some((item) => item.sentido === sentido && item.data_comprada === efetiva)) {
      resultado.push({ sentido, data_solicitada: esperada, data_comprada: efetiva });
    }
  }
  return resultado;
}

export function horarioLocalDaPartida(partidaLocal: string | null | undefined) {
  const match = partidaLocal?.match(/T(\d{2}:\d{2})/);
  return match?.[1] || null;
}

export function partidaAnteriorAoSolicitado(partidaLocal: string | null | undefined, horarioMinimo: string | null | undefined) {
  const partida = horarioLocalDaPartida(partidaLocal);
  const minimo = horarioMinimo?.slice(0, 5) || null;
  return Boolean(partida && minimo && partida < minimo);
}
