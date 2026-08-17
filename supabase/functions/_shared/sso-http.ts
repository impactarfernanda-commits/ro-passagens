const LOCAL_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];
export const RETURN_PATHS = new Set([
  "/alocacoes",
  "/funcionarios",
  "/obras",
  "/dashboard",
  "/relatorios",
  "/custos",
  "/registros",
  "/configuracoes",
]);

type SafeLog = {
  operation: string;
  name: string;
  code?: string;
  status?: number;
  message: string;
};
type Logger = (entry: SafeLog) => void;
type Handoff = { user_id: string; return_path: string };

export type StartDependencies = {
  authenticate: (authorization: string) => Promise<string | null>;
  canAccessObras: (userId: string) => Promise<boolean>;
  persistHandoff: (input: {
    codeHash: string;
    userId: string;
    returnPath: string;
    expiresAt: string;
  }) => Promise<void>;
  obrasOrigin: string;
  portalOrigin: string;
  log?: Logger;
};

export type ExchangeDependencies = {
  obrasOrigin: string;
  consumeHandoff: (codeHash: string) => Promise<Handoff | null>;
  getUserEmail: (userId: string) => Promise<string | null>;
  generateTokenHash: (email: string) => Promise<string>;
  log?: Logger;
};

function corsHeaders(origin: string | null, origins: Set<string>, productionOrigin: string) {
  return {
    "access-control-allow-origin": origin && origins.has(origin) ? origin : productionOrigin,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

function json(origin: string | null, origins: Set<string>, productionOrigin: string, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin, origins, productionOrigin), "content-type": "application/json" },
  });
}

function preflight(origin: string | null, origins: Set<string>, productionOrigin: string) {
  return new Response(null, { status: 204, headers: corsHeaders(origin, origins, productionOrigin) });
}

function safeLog(operation: string, error: unknown): SafeLog {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawMessage = error instanceof Error ? error.message : String(source.message ?? "Unknown error");
  return {
    operation,
    name: error instanceof Error ? error.name : String(source.name ?? "Error"),
    code: typeof source.code === "string" ? source.code : undefined,
    status: typeof source.status === "number" ? source.status : undefined,
    message: rawMessage
      .replace(/(?:token_hash|code_hash|access_token|refresh_token|authorization|service_role)/giu, "[redacted-field]")
      .replace(/eyJ[A-Za-z0-9._-]+/gu, "[redacted]")
      .replace(/[A-Za-z0-9_-]{32,}/gu, "[redacted]"),
  };
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function readJson(req: Request) {
  try {
    return await req.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function handleSsoStart(req: Request, deps: StartDependencies) {
  const origin = req.headers.get("origin");
  const allowedOrigins = new Set([deps.portalOrigin, ...LOCAL_ORIGINS]);
  if (req.method === "OPTIONS") return preflight(origin, allowedOrigins, deps.portalOrigin);
  if (req.method !== "POST" || (origin && !allowedOrigins.has(origin))) {
    return json(origin, allowedOrigins, deps.portalOrigin, { error: "REQUEST_NOT_ALLOWED" }, 403);
  }
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json(origin, allowedOrigins, deps.portalOrigin, { error: "AUTH_REQUIRED" }, 401);
  }
  try {
    const userId = await deps.authenticate(authorization);
    if (!userId) return json(origin, allowedOrigins, deps.portalOrigin, { error: "AUTH_INVALID" }, 401);
    const body = await readJson(req);
    if (body?.target_app !== "obras-control") {
      return json(origin, allowedOrigins, deps.portalOrigin, { error: "TARGET_INVALID" }, 400);
    }
    if (typeof body.return_path !== "string" || !RETURN_PATHS.has(body.return_path)) {
      return json(origin, allowedOrigins, deps.portalOrigin, { error: "RETURN_PATH_INVALID" }, 400);
    }
    if (!await deps.canAccessObras(userId)) {
      return json(origin, allowedOrigins, deps.portalOrigin, { error: "OBRAS_ACCESS_DENIED" }, 403);
    }
    const code = base64url(crypto.getRandomValues(new Uint8Array(32)));
    await deps.persistHandoff({
      codeHash: await sha256(code),
      userId,
      returnPath: body.return_path,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const redirect = new URL("/sso/callback", deps.obrasOrigin);
    redirect.searchParams.set("code", code);
    return json(origin, allowedOrigins, deps.portalOrigin, { redirect_url: redirect.toString() });
  } catch (error) {
    deps.log?.(safeLog("sso_start", error));
    return json(origin, allowedOrigins, deps.portalOrigin, { error: "SSO_START_FAILED" }, 500);
  }
}

export async function handleSsoExchange(req: Request, deps: ExchangeDependencies) {
  const origin = req.headers.get("origin");
  const allowedOrigins = new Set([deps.obrasOrigin, ...LOCAL_ORIGINS]);
  if (req.method === "OPTIONS") return preflight(origin, allowedOrigins, deps.obrasOrigin);
  if (req.method !== "POST" || (origin && !allowedOrigins.has(origin))) {
    return json(origin, allowedOrigins, deps.obrasOrigin, { error: "REQUEST_NOT_ALLOWED" }, 403);
  }
  const body = await readJson(req);
  if (typeof body?.code !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(body.code)) {
    return json(origin, allowedOrigins, deps.obrasOrigin, { error: "SSO_CODE_INVALID" }, 400);
  }
  try {
    const handoff = await deps.consumeHandoff(await sha256(body.code));
    if (!handoff) {
      return json(origin, allowedOrigins, deps.obrasOrigin, { error: "SSO_CODE_INVALID" }, 400);
    }
    const email = await deps.getUserEmail(handoff.user_id);
    if (!email) {
      return json(origin, allowedOrigins, deps.obrasOrigin, { error: "SSO_CODE_INVALID" }, 400);
    }
    const tokenHash = await deps.generateTokenHash(email);
    return json(origin, allowedOrigins, deps.obrasOrigin, {
      token_hash: tokenHash,
      return_path: handoff.return_path,
    });
  } catch (error) {
    deps.log?.(safeLog("sso_exchange", error));
    return json(origin, allowedOrigins, deps.obrasOrigin, { error: "SSO_EXCHANGE_FAILED" }, 500);
  }
}
