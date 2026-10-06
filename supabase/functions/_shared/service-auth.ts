export type SecretAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 500; error: "SECRET_REQUIRED" | "FORBIDDEN" | "SERVER_CONFIGURATION_ERROR" };

const encoder = new TextEncoder();

const timingSafeEqual = async (left: string, right: string): Promise<boolean> => {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash), rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
};

const configuredSecretKeys = (getEnv: (name: string) => string | undefined): string[] | null => {
  const plural = getEnv("SUPABASE_SECRET_KEYS");
  if (plural) {
    try {
      const parsed: unknown = JSON.parse(plural);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null;
      const keys = Object.values(parsed).filter((value): value is string => typeof value === "string" && value.length > 0);
      return keys.length > 0 ? keys : null;
    } catch {
      return null;
    }
  }
  const singular = getEnv("SUPABASE_SECRET_KEY");
  return singular ? [singular] : null;
};

export const authorizeSecretRequest = async (
  request: Request,
  getEnv: (name: string) => string | undefined,
): Promise<SecretAuthorization> => {
  const supplied = request.headers.get("apikey");
  if (!supplied) return { ok: false, status: 401, error: "SECRET_REQUIRED" };
  const configured = configuredSecretKeys(getEnv);
  if (!configured) return { ok: false, status: 500, error: "SERVER_CONFIGURATION_ERROR" };
  const matches = await Promise.all(configured.map((candidate) => timingSafeEqual(supplied, candidate)));
  return matches.some(Boolean) ? { ok: true } : { ok: false, status: 403, error: "FORBIDDEN" };
};
