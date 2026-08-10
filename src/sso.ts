import { supabase } from "./supabase";

const env=(import.meta as ImportMeta&{env?:Record<string,string|undefined>}).env;
export const OBRAS_ORIGIN = env?.VITE_OBRAS_CONTROL_URL || "https://obras-control-demo.vercel.app";
export const OBRAS_RETURN_PATHS = new Set(["/alocacoes", "/funcionarios", "/obras", "/dashboard", "/relatorios", "/custos", "/registros", "/configuracoes"]);

export function safeObrasReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || !OBRAS_RETURN_PATHS.has(value)) return "/alocacoes";
  return value;
}

export async function startObrasSso(returnPath = "/alocacoes") {
  const { data, error } = await supabase.functions.invoke("obras-sso-start", {
    body: { target_app: "obras-control", return_path: safeObrasReturnPath(returnPath) },
  });
  if (error || typeof data?.redirect_url !== "string") throw new Error("SSO_START_FAILED");
  const redirect = new URL(data.redirect_url);
  if (redirect.origin !== new URL(OBRAS_ORIGIN).origin || redirect.pathname !== "/sso/callback" || !redirect.searchParams.get("code")) throw new Error("SSO_REDIRECT_INVALID");
  return redirect.toString();
}
