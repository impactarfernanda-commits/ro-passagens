import type { DesligamentoSubtipo, Motivo } from "./types";

export function dispensaAprovacaoDesligamentoUrgente(
  motivo: Motivo | "" | null | undefined,
  subtipo: DesligamentoSubtipo | "" | null | undefined,
) {
  return motivo === "desligamento"
    && (subtipo === "pedido_demissao" || subtipo === "justa_causa");
}
