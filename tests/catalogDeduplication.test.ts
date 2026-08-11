import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("supabase/migrations/202608110006_deduplica_catalogo_passagens_ro.sql","utf8");
const dry=fs.readFileSync("supabase/manual/DRY_RUN_202608110006_deduplica_catalogo_passagens_ro.sql","utf8");
const diagnostic=fs.readFileSync("supabase/manual/diagnosticar_duplicidades_catalogo_passagens_ro.sql","utf8");
const page=fs.readFileSync("src/pages.tsx","utf8");
const particles=new Set(["DE","DA","DO","DAS","DOS","E"]);
const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim().replace(/\s+/g," ");
const significant=(value:string)=>normalize(value).split(" ").filter(token=>!particles.has(token));
function classify(a:string,b:string){
 const na=normalize(a),nb=normalize(b),ta=significant(a),tb=significant(b);
 if(na===nb)return "DUPLICIDADE_EXATA";
 if(ta.join(" ")===tb.join(" "))return "PARTICULA_DIVERGENTE";
 if(ta.length===tb.length&&ta.length>1&&ta.slice(0,-1).every((x,i)=>x===tb[i])&&Math.min(ta.at(-1)!.length,tb.at(-1)!.length)>=5&&(ta.at(-1)!.startsWith(tb.at(-1)!)||tb.at(-1)!.startsWith(ta.at(-1)!)))return "SOBRENOME_TRUNCADO";
 const [small,big]=ta.length<tb.length?[ta,tb]:[tb,ta];let i=0;for(const token of big)if(token===small[i])i++;
 return small.length!==big.length&&small[0]===big[0]&&small.at(-1)===big.at(-1)&&i===small.length?"NOME_INTERMEDIARIO_AUSENTE":null;
}
const suppress=(legacy:string,privates:string[])=>privates.filter(name=>classify(legacy,name)).length===1;

test("nome exato privado prevalece",()=>assert.equal(classify("ANA SOUZA","ana souza"),"DUPLICIDADE_EXATA"));
test("Vitor real é correspondência forte",()=>assert.equal(classify("VITOR FERRI","VITOR PENATTI FERRI"),"NOME_INTERMEDIARIO_AUSENTE"));
test("Yuri real reconhece partícula",()=>assert.equal(classify("YURI VIEIRA NASCIMENTO","YURI VIEIRA DO NASCIMENTO"),"PARTICULA_DIVERGENTE"));
test("Yordan real reconhece truncamento",()=>assert.equal(classify("YORDAN ALISSON DE CASTRO BONAC","YORDAN ALISSON DE CASTRO BONACCORSI"),"SOBRENOME_TRUNCADO"));
test("acentos caixa pontuação e espaços são normalizados",()=>assert.equal(classify("  Vítor, FERRI ","vitor ferri"),"DUPLICIDADE_EXATA"));
test("truncamento curto não é aceito",()=>assert.equal(classify("ANA S","ANA SA"),null));
test("dois privados plausíveis preservam legado",()=>assert.equal(suppress("JOAO SILVA",["JOAO CARLOS SILVA","JOAO PEDRO SILVA"]),false));
test("sem privado legado permanece",()=>assert.equal(suppress("WENDELL JOVIANO DA SILVA",[]),false));
test("Wendell não é ocultado apenas por ser legado",()=>assert.match(migration,/having count\(\*\)=1/));
test("funcionário normal do Obras não entra no escopo de supressão",()=>assert.match(migration,/f\.escopo_passagens='restrito_ro' and not f\.visivel_obras_control/));
test("restrito RO sem candidato continua disponível",()=>assert.match(migration,/exists\(select 1 from unicos u where u\.legado_id=f\.id\)/));
test("cadastro privado ativo sempre continua no catálogo",()=>assert.match(migration,/from privados p left join public\.funcionarios/));
test("RPC mantém assinatura e autenticação",()=>{assert.match(migration,/create or replace function public\.ro_catalogo_colaboradores_viagem\(\)/);assert.match(migration,/auth\.uid\(\) is not null/);assert.match(migration,/grant execute on function public\.ro_catalogo_colaboradores_viagem\(\) to authenticated/)});
test("não há mutação de public.funcionarios",()=>assert.doesNotMatch(migration,/\b(update|insert into|delete from)\s+public\.funcionarios\b/i));
test("não preenche funcionario_id privado",()=>assert.doesNotMatch(migration,/update public\.ro_funcionarios_enderecos_privados|set\s+funcionario_id/i));
test("não migra histórico nem exclui pessoas",()=>assert.doesNotMatch(migration,/ro_passagem_solicitacoes|\bdelete\b|set\s+ativo/i));
test("comparação é limitada a legados e pré-filtrada pelo primeiro nome",()=>{assert.match(migration,/from public\.funcionarios f\s+where f\.ativo[\s\S]*escopo_passagens='restrito_ro'/);assert.match(migration,/join privados p on p\.primeiro_nome=l\.primeiro_nome/)});
test("diagnóstico pré-migration é autônomo e sem PII",()=>{assert.doesNotMatch(diagnostic,/ro_correspondencia_nome_catalogo_ro|ro_catalogo_colaboradores_viagem/);assert.doesNotMatch(diagnostic,/\b(insert|update|delete|create|alter|drop)\b/i);assert.doesNotMatch(diagnostic,/\bcpf\b|\brg\b|telefone|logradouro|data_nascimento/i)});
test("diagnóstico compara legado com privado e sinaliza ação",()=>{assert.match(diagnostic,/from public\.funcionarios f/);assert.match(diagnostic,/from public\.ro_funcionarios_enderecos_privados e/);assert.match(diagnostic,/SUPRIMIR_LEGADO_DO_CATALOGO/);assert.match(diagnostic,/AMBIGUO/)});
test("dry run replica a migration com rollback",()=>assert.equal(dry,migration.replace(/^commit;$/im,"rollback;")));
test("frontend não contém deduplicação ou revisão paralela",()=>{assert.doesNotMatch(page,/ro_listar_duplicidades_nome_privado|Possíveis cadastros duplicados|confirmDuplicate/)});
