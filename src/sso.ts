import { supabase } from "./supabase";
import { configuredObrasOrigin, validObrasCallbackUrl } from "./obrasBootstrap";

const env=(import.meta as ImportMeta&{env?:Record<string,string|undefined>}).env;
export const OBRAS_ORIGIN = configuredObrasOrigin(env?.VITE_OBRAS_CONTROL_URL);
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
  if (!validObrasCallbackUrl(data.redirect_url, OBRAS_ORIGIN)) throw new Error("SSO_REDIRECT_INVALID");
  return data.redirect_url;
}
