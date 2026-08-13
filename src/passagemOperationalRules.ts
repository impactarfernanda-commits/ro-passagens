export const COMPRA_HORARIO_ALERTA = "Horário anterior ao solicitado. Confirmar mesmo assim?";

export function horarioLocalDaPartida(partidaLocal: string | null | undefined) {
  const match = partidaLocal?.match(/T(\d{2}:\d{2})/);
  return match?.[1] || null;
}

export function partidaAnteriorAoSolicitado(partidaLocal: string | null | undefined, horarioMinimo: string | null | undefined) {
  const partida = horarioLocalDaPartida(partidaLocal);
  const minimo = horarioMinimo?.slice(0, 5) || null;
  return Boolean(partida && minimo && partida < minimo);
}
