import { createClient } from "https://esm.sh/@supabase/supabase-js@2.52.0";
import { handleSsoStart } from "../_shared/sso-http.ts";

Deno.serve((req) => handleSsoStart(req, {
  obrasOrigin: Deno.env.get("OBRAS_CONTROL_ORIGIN") ?? "https://obras-control-demo.vercel.app",
  authenticate: async (authorization) => {
    const auth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await auth.auth.getUser();
    if (error) return null;
    return user?.id ?? null;
  },
  canAccessObras: async (userId) => {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.from("user_roles").select("role").eq("user_id", userId).limit(1);
    if (error) throw error;
    return Boolean(data?.length);
  },
  persistHandoff: async ({ codeHash, userId, returnPath, expiresAt }) => {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.from("portal_sso_handoffs").insert({
      code_hash: codeHash,
      user_id: userId,
      target_app: "obras-control",
      return_path: returnPath,
      expires_at: expiresAt,
    });
    if (error) throw error;
    void admin.rpc("portal_limpar_sso_handoffs");
  },
  log: (entry) => console.error(entry),
}));
