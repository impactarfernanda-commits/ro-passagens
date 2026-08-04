import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql=readFileSync(new URL("../supabase/migrations/202608040001_regras_prazos_rh_desligamentos.sql",import.meta.url),"utf8");
test("migration é transacional",()=>{assert.match(sql,/\bbegin;[\s\S]*commit;\s*$/i);});
test("migration não contém mutações históricas em massa",()=>{assert.doesNotMatch(sql,/\b(delete\s+from|truncate\s+|drop\s+table)\s+public\.ro_passagem_solicitacoes/i);});
test("não contém service_role ou bucket público",()=>{assert.doesNotMatch(sql,/service_role/i);assert.match(sql,/values\('ro-documentos-internos','ro-documentos-internos',false/i);});
test("não cadastra RH ou feriados",()=>{assert.doesNotMatch(sql,/insert\s+into\s+public\.ro_rh_responsaveis\s*\(/i);assert.doesNotMatch(sql,/insert\s+into\s+public\.ro_calendario_nao_util\s*\(/i);});
test("administração usa auth.uid e e-mail case-insensitive",()=>{assert.match(sql,/ro_can_manage_rh\(\)[\s\S]*u\.id=auth\.uid\(\)[\s\S]*lower\(u\.email\)=lower\('fernanda\.souza@tanksbr\.com\.br'\)/i);});
test("insert e updates relevantes possuem triggers",()=>{assert.match(sql,/before insert on public\.ro_passagem_solicitacoes/i);assert.match(sql,/before update of motivo,desligamento_subtipo,data_ida,primeiro_embarque_em,origem,destino/i);});
test("RPC valida objeto real, ownership, mime e tamanho",()=>{assert.match(sql,/storage\.objects[\s\S]*owner_id=auth\.uid\(\)/i);assert.match(sql,/metadata->>'mimetype'/i);assert.match(sql,/metadata->>'size'/i);});
test("limpeza órfã possui policy DELETE sem permitir apagar vinculado",()=>{assert.match(sql,/for delete to authenticated[\s\S]*owner_id=auth\.uid\(\)[\s\S]*not exists\(select 1 from public\.ro_passagem_documentos_internos/i);});
test("RH não recebe custos e RO permanece pela função existente",()=>{assert.match(sql,/ro_child_cost_select[\s\S]*using\(public\.ro_can_view_all\(\)\)/i);assert.doesNotMatch(sql,/create or replace function public\.ro_can_operate/i);});
test("funções definer têm search_path e EXECUTE revogado",()=>{const definers=[...sql.matchAll(/create or replace function ([^(]+)\([^$]+?security definer set search_path=/gi)];assert.ok(definers.length>=8);assert.match(sql,/revoke all on function[\s\S]*ro_validar_nova_solicitacao\(\)/i);});
test("viagem diretoria é histórica e rejeitada na criação",()=>{assert.match(sql,/motivo is null or motivo in \([^)]*'viagem_diretoria'/i);assert.match(sql,/new\.motivo='viagem_diretoria' then raise exception 'MOTIVO_NAO_DISPONIVEL'/i);});
test("compatibilidade histórica usa constraint NOT VALID",()=>assert.match(sql,/ro_desligamento_subtipo_ck[\s\S]*\) not valid;/i));
test("edição preserva origem histórica e registra revalidação",()=>{assert.match(sql,/else new\.origem_solicitacao:=old\.origem_solicitacao/i);assert.match(sql,/solicitacao_revalidada/i);});
