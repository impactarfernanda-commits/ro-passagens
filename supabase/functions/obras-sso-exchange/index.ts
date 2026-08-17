import { createClient } from "https://esm.sh/@supabase/supabase-js@2.52.0";
import { handleSsoExchange } from "../_shared/sso-http.ts";

Deno.serve((req) => handleSsoExchange(req, {
  obrasOrigin: Deno.env.get("OBRAS_CONTROL_ORIGIN") ?? "https://obras-control-demo.vercel.app",
  consumeHandoff: async (codeHash) => {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("portal_consumir_sso_handoff", {
      p_code_hash: codeHash,
      p_target_app: "obras-control",
    });
    if (error) throw error;
    return data?.[0] ?? null;
  },
  getUserEmail: async (userId) => {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await admin.auth.admin.getUserById(userId);
    if (error) throw error;
    return user?.email ?? null;
  },
  generateTokenHash: async (email) => {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) throw error ?? new Error("GENERATE_LINK_FAILED");
    return tokenHash;
  },
  log: (entry) => console.error(entry),
}));
