import type { Session } from "@supabase/supabase-js";
import { createScopedCache } from "./scopedCache";
import { createCacheInvalidationChannel } from "./cacheInvalidationChannel";
import { supabase } from "./supabase";

export type Access = { isRO:boolean; isAdmin:boolean; canViewAll:boolean; canOperateRO:boolean; canManageRO:boolean; canImport:boolean; role:string|null; isRh:boolean; canManageRh:boolean; canApprove:boolean; isDenise:boolean };
export type AccessSnapshot = { access: Access; userName: string };
export const EMPTY_ACCESS: Access = { isRO:false,isAdmin:false,canViewAll:false,canOperateRO:false,canManageRO:false,canImport:false,role:null,isRh:false,canManageRh:false,canApprove:false,isDenise:false };
export const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const cache = createScopedCache<AccessSnapshot>({ maxAgeMs: ACCESS_CACHE_TTL_MS });
const listeners = new Set<(userId?: string) => void>();
const notify = (userId?: string) => listeners.forEach((listener) => listener(userId));
const channel = createCacheInvalidationChannel("portal-tanksbr-access-v1", (userId) => {
  cache.invalidate(userId);
  notify(userId);
});

async function queryAccess(session: Session): Promise<AccessSnapshot> {
  const [roles,profile,ro,systemAdmin,rh,manageRh,approver,denise]=await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id",session.user.id),
    supabase.from("users_profiles").select("full_name").eq("id",session.user.id).maybeSingle(),
    supabase.from("ro_responsaveis").select("id").eq("user_id",session.user.id).eq("ativo",true).maybeSingle(),
    supabase.rpc("ro_is_system_admin",{p_user:session.user.id}), supabase.rpc("ro_is_rh_active",{p_user_id:session.user.id}),
    supabase.rpc("ro_can_manage_rh"), supabase.rpc("ro_is_approval_candidate"), supabase.rpc("ro_is_denise"),
  ]);
  const names=(roles.data||[]).map(row=>String(row.role));
  const role=names.includes("diretor")?"diretor":names.includes("gerente")?"gerente":names[0]||null;
  const isAdmin=names.some(name=>["gerente","diretor"].includes(name)); const isRO=Boolean(ro.data);
  return { userName:profile.data?.full_name||session.user.user_metadata?.full_name||session.user.email||"Usuário", access:{role,isRO,isAdmin,canViewAll:isAdmin||isRO,canOperateRO:isRO,canManageRO:isAdmin,canImport:Boolean(systemAdmin.data),isRh:Boolean(rh.data),canManageRh:Boolean(manageRh.data),canApprove:Boolean(approver.data),isDenise:Boolean(denise.data)} };
}
export function loadAccess(session:Session,force=false){return cache.get(session.user.id,()=>queryAccess(session),force)}
export function invalidateAccess(userId?:string){cache.invalidate(userId);notify(userId);channel.publish(userId)}
export function subscribeAccessInvalidation(listener:(userId?:string)=>void){listeners.add(listener);return()=>listeners.delete(listener)}
