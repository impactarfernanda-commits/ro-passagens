import assert from "node:assert/strict";import fs from "node:fs";import test from "node:test";
const m=fs.readFileSync("supabase/migrations/202610080003_autorizacao_denise_configuravel.sql","utf8");
const d=fs.readFileSync("supabase/manual/DRY_RUN_202610080003_autorizacao_denise_configuravel.sql","utf8");
test("seed preserva somente identidade atual",()=>{assert.equal((m.match(/d6081413-3730-41f0-981d-935a44303993/g)||[]).length,1);assert.match(m,/values\('d6081413-3730-41f0-981d-935a44303993',true\)/);});
test("helper usa associação ativa e null falha fechado",()=>{assert.match(m,/p_user is not null and exists/);assert.match(m,/d\.user_id=p_user and d\.ativo/);assert.doesNotMatch(m,/p_user='d608/);});
test("tabela é backend only",()=>{assert.match(m,/enable row level security/);assert.match(m,/revoke all on table public\.ro_denise_autorizados from public,anon,authenticated/);assert.doesNotMatch(m,/grant .* on table/i);});
test("dry run cria remove e reverte fixture sintética",()=>{assert.match(d,/insert into public\.ro_denise_autorizados\(user_id\) values\(v_teste\)/);assert.match(d,/set_config\('request\.jwt\.claim\.sub',v_teste::text,true\)/);assert.match(d,/public\.ro_is_denise\(\)/);assert.match(d,/set ativo=false/);assert.match(d,/^begin;/i);assert.match(d,/rollback;\s*$/i);assert.doesNotMatch(d,/commit;/i);});
