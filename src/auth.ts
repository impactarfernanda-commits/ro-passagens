import type { AuthError } from "@supabase/supabase-js";

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_RECOVERY_MESSAGE =
  "Se houver uma conta vinculada a este e-mail, enviaremos as instruções para redefinir sua senha.";
export const INVALID_RECOVERY_MESSAGE =
  "Este link de recuperação é inválido ou expirou. Solicite um novo link.";
export const PASSWORD_RESET_SUCCESS_MESSAGE =
  "Senha redefinida com sucesso. Entre com sua nova senha.";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const PORTAL_ORIGIN = env?.VITE_PORTAL_URL || "https://portal-tks-br.vercel.app";
export const PASSWORD_RECOVERY_REDIRECT = new URL("/redefinir-senha", PORTAL_ORIGIN).toString();

export function isRateLimitError(error: Pick<AuthError, "status" | "message">) {
  return error.status === 429 || /rate.?limit|too many requests/i.test(error.message);
}

export function recoveryParams(location: Location) {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return {
    code: query.get("code"),
    tokenHash: query.get("token_hash"),
    type: query.get("type") || hash.get("type"),
    hasImplicitSession: Boolean(hash.get("access_token") && hash.get("refresh_token")),
  };
}

export function clearRecoveryUrl() {
  globalThis.history.replaceState({}, document.title, "/redefinir-senha");
}
