import { createScopedCache } from "./scopedCache";
import { createCacheInvalidationChannel } from "./cacheInvalidationChannel";
import { supabase } from "./supabase";
import type { Funcionario, Obra } from "./types";
export type CatalogSnapshot={funcionarios:Funcionario[];obras:Obra[]};
export const CATALOG_CACHE_TTL_MS=15*60*1000;
const cache=createScopedCache<CatalogSnapshot>({maxAgeMs:CATALOG_CACHE_TTL_MS}); let activeUserId:string|null=null;
const listeners=new Set<(userId?:string)=>void>();
const notify=(userId?:string)=>listeners.forEach(listener=>listener(userId));
const channel=createCacheInvalidationChannel("portal-tanksbr-catalogs-v1",(userId)=>{cache.invalidate(userId);notify(userId)});
export function setCatalogCacheUser(userId:string|null){if(activeUserId!==userId){cache.invalidate();notify()}activeUserId=userId}
export function invalidateCatalogs(userId=activeUserId){if(userId){cache.invalidate(userId);notify(userId);channel.publish(userId)}}
export function subscribeCatalogInvalidation(listener:(userId?:string)=>void){listeners.add(listener);return()=>listeners.delete(listener)}
export function getCatalogCacheUser(){return activeUserId}
export async function loadCatalogs():Promise<CatalogSnapshot>{
  if(!activeUserId)throw new Error("Catálogos exigem uma sessão autenticada."); const userId=activeUserId;
  return cache.get(userId,async()=>{const[funcionariosResult,centrosResult]=await Promise.all([supabase.rpc("ro_catalogo_colaboradores_viagem"),supabase.rpc("ro_catalogo_centros_custo")]);const funcionarios=(funcionariosResult.data||[]) as Funcionario[];const catalogo=(centrosResult.data||[]) as Obra[];if(!catalogo.length)return{funcionarios,obras:[]};const{data:detalhes}=await supabase.from("obras").select("id,codigo,descricao,visivel_passagens,escopo_passagens").in("id",catalogo.map(obra=>obra.id));const porId=new Map((detalhes||[]).map(obra=>[obra.id,obra]));return{funcionarios,obras:catalogo.map(obra=>({...obra,...porId.get(obra.id)}))}});
}
