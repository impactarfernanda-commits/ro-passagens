import type { Motivo } from "./types";

export const MOTIVOS_COM_RETORNO = ["ferias", "folga_campo", "recesso"] as const;

export function motivoPossuiRetorno(motivo: Motivo | "" | null | undefined): boolean {
  return MOTIVOS_COM_RETORNO.some((item) => item === motivo);
}

export type CamposRetorno = {
  data_retorno: string;
  destino_retorno: string;
  centro_custo_retorno_id: string;
  retorno_indefinido: boolean;
};

export function normalizarCamposRetorno<T extends CamposRetorno>(form: T): T {
  if (!motivoPossuiRetorno((form as T & { motivo?: Motivo | "" }).motivo)) {
    return { ...form, data_retorno: "", destino_retorno: "", centro_custo_retorno_id: "", retorno_indefinido: false };
  }
  if (form.retorno_indefinido) {
    return { ...form, destino_retorno: "", centro_custo_retorno_id: "" };
  }
  return form;
}
