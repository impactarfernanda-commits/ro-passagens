export const OBRAS_READY_MESSAGE = "obras-control-ready";
export const OBRAS_ERROR_MESSAGE = "obras-control-error";

export function obrasBootstrapUrl(redirectUrl: string) {
  const url = new URL(redirectUrl);
  url.searchParams.set("portal_bootstrap", "1");
  return url.toString();
}

export function finalObrasUrl(origin: string, returnPath: string) {
  return new URL(returnPath, origin).toString();
}

export function isTrustedObrasMessage(event: Pick<MessageEvent, "origin" | "data">, expectedOrigin: string) {
  if (event.origin !== new URL(expectedOrigin).origin || !event.data || typeof event.data !== "object") return false;
  return event.data.type === OBRAS_READY_MESSAGE || event.data.type === OBRAS_ERROR_MESSAGE;
}
