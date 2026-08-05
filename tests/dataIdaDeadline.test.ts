import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page=readFileSync(new URL("../src/pages.tsx",import.meta.url),"utf8");
const form=page.slice(page.indexOf("export function NovaSolicitacao"),page.indexOf("export function ConfiguracoesRH"));
const sql=readFileSync(new URL("../supabase/migrations/202608050001_usa_data_ida_nas_regras_prazo.sql",import.meta.url),"utf8");
const dry=readFileSync(new URL("../supabase/manual/DRY_RUN_202608050001_usa_data_ida_nas_regras_prazo.sql",import.meta.url),"utf8");
const verify=readFileSync(new URL("../supabase/manual/verificar_regra_data_ida.sql",import.meta.url),"utf8");

test("formulário não exibe primeiro embarque nem datetime-local",()=>{assert.doesNotMatch(form,/Primeiro embarque/i);assert.doesNotMatch(form,/type="datetime-local"/i);});
test("data de ida tem min dinâmico",()=>assert.match(page,/min=\{dataMinimaInput\}/));
test("submit bloqueia data inválida antes da RPC",()=>assert.match(page,/form\.data_ida < dataMinimaInput[\s\S]*return;[\s\S]*supabase\.rpc\("ro_criar_solicitacao_validada"/));
test("interface não mostra explicações antigas",()=>{assert.doesNotMatch(page,/Primeira data permitida/i);assert.doesNotMatch(page,/embarque precisa estar no futuro/i);});
test("exceção gerencial é opt-in e enviada explicitamente",()=>{assert.match(page,/Solicitar exceção de prazo/);assert.match(page,/solicitar_excecao_prazo:gerencial&&solicitarExcecao/);});
test("migration é complementar e transacional",()=>{assert.match(sql,/^begin;/i);assert.match(sql,/commit;\s*$/i);assert.doesNotMatch(sql,/drop\s+(?:column|table)|truncate|delete\s+from\s+public\.ro_passagem_solicitacoes/i);});
test("banco valida exclusivamente new.data_ida",()=>{assert.match(sql,/if new\.data_ida is null/);assert.match(sql,/if new\.data_ida<v_hoje/);assert.match(sql,/if new\.data_ida<v_min/);assert.doesNotMatch(sql,/v_primeiro|primeiro_embarque_em\s*[<>=]/i);});
test("RPC ignora primeiro embarque do cliente",()=>assert.match(sql,/data_ida,primeiro_embarque_em[\s\S]*nullif\(p_solicitacao->>'data_ida',''\)::date,null,/i));
test("compatibilidade usa meio-dia de São Paulo",()=>assert.match(sql,/new\.primeiro_embarque_em:=\(new\.data_ida\+time '12:00'\) at time zone 'America\/Sao_Paulo'/i));
test("triggers de inserção e revalidação são recriados",()=>{assert.match(sql,/before insert on public\.ro_passagem_solicitacoes/i);assert.match(sql,/before update of motivo,desligamento_subtipo,data_ida,primeiro_embarque_em,origem,destino/i);});
test("dry run está sincronizado e termina em rollback",()=>{const normalize=(v:string)=>v.replace(/(?:commit|rollback);\s*$/i,"END;").replace(/\s+/g," ").trim();assert.equal(normalize(dry),normalize(sql));assert.match(dry,/rollback;\s*$/i);assert.doesNotMatch(dry,/commit;\s*$/i);});
test("verificação é somente leitura",()=>{assert.match(verify,/pg_get_functiondef/i);assert.match(verify,/pg_get_triggerdef/i);assert.match(verify,/primeiro_embarque_em/i);assert.doesNotMatch(verify,/\b(insert|update|delete|truncate|alter|drop|create)\b/i);});
