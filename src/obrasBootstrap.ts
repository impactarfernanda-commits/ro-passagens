export const LEGACY_OBRAS_ORIGIN = "https://obras-control-demo.vercel.app";

export function configuredObrasOrigin(value?: string) {
  return new URL(value || LEGACY_OBRAS_ORIGIN).origin;
}

const TEMPORARY_AUTH_PARAMS = new Set(["portal_bootstrap", "token_hash", "type", "code"]);

export function finalObrasUrl(origin: string, returnPath: string) {
  const canonicalOrigin = new URL(origin).origin;
  if (!returnPath.startsWith("/") || returnPath.startsWith("//")) return null;
  const destination = new URL(returnPath, canonicalOrigin);
  if (destination.origin !== canonicalOrigin || destination.pathname === "/sso/callback" || [...TEMPORARY_AUTH_PARAMS].some((param) => destination.searchParams.has(param))) return null;
  return destination.toString();
}

export function validObrasCallbackUrl(value: string, origin: string) {
  try {
    const callback = new URL(value);
    return callback.origin === new URL(origin).origin && callback.pathname === "/sso/callback" && /^[A-Za-z0-9_-]{43}$/u.test(callback.searchParams.get("code") || "") && callback.searchParams.size === 1;
  } catch {
    return false;
  }
}
