import { useEffect } from "react";
import { supabase } from "./supabase";

export function useAutoFinalization(enabled: boolean, onDone?: () => void) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void supabase
      .rpc("ro_auto_finalizar_solicitacoes")
      .then(({ data, error }) => {
        if (error) {
          console.warn("Não foi possível executar a auto-finalização.", error);
          return;
        }
        if (active && Number(data) > 0) onDone?.();
      });
    return () => {
      active = false;
    };
  }, [enabled, onDone]);
}
