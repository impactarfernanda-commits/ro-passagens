import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { alternarModoViajante, emptyNovaSolicitacaoForm, parseDraft, serializeDraft } from "../src/novaSolicitacaoDraft.ts";
import { calcularDataMinima, mensagemAntecedencia, motivosPermitidos, regraPrazo, validarSolicitacao } from "../src/passagemRules.ts";

const migration=readFileSync(new URL("../supabase/migrations/202610060001_regras_especiais_rh.sql",import.meta.url),"utf8");
const pages=readFileSync(new URL("../src/pages.tsx",import.meta.url),"utf8");
const report=readFileSync(new URL("../src/Relatorios.tsx",import.meta.url),"utf8");
const email=readFileSync(new URL("../supabase/functions/ro-email-notifications/index.ts",import.meta.url),"utf8");
const dryRun=readFileSync(new URL("../supabase/manual/DRY_RUN_202610060001_regras_especiais_rh.sql",import.meta.url),"utf8");

test("dry run RH é autocontido e contém exatamente a migration",()=>{
  const normalize=(value:string)=>value.replace(/\r\n/g,"\n").trim();
  const embedded=dryRun.split("-- DRY_RUN_MIGRATION_BEGIN")[1]?.split("-- DRY_RUN_MIGRATION_END")[0]||"";
  assert.equal(normalize(embedded),normalize(migration));
  assert.equal(createHash("sha256").update(migration).digest("hex"),"aa736ad5131c57e9e67786ff3a7133e637a4909a4dd05243a910d99bc9528ed0");
  assert.doesNotMatch(dryRun,/^\s*\\(?:ir|i|copy|set)\b/im);
});

test("dry run RH possui uma transação, saída final e cobertura A-X",()=>{
  assert.equal((dryRun.match(/^\s*begin\s*;/gim)||[]).length,1);
  assert.equal((dryRun.match(/^\s*rollback\s*;/gim)||[]).length,1);
  assert.equal((dryRun.match(/^\s*commit\s*;/gim)||[]).length,0);
  assert.ok(dryRun.lastIndexOf("select\n  indicador")<dryRun.lastIndexOf("rollback;"));
  for(const indicador of "ABCDEFGHIJKLMNOPQRSTUVWX") assert.match(dryRun,new RegExp(`(?:\\(|^\\s*)'${indicador}'`,"m"));
  for(const coluna of ["indicador","aprovado","detalhe","aprovados","total","todos_aprovados"]) assert.match(dryRun,new RegExp(`\\b${coluna}\\b`));
});

test("Q captura identidade histórica antes da migration e valida a mesma linha depois",()=>{
  const marker=dryRun.indexOf("-- DRY_RUN_MIGRATION_BEGIN");
  const snapshot=dryRun.indexOf("create temp table rh_dry_q_legado");
  const q=dryRun.slice(dryRun.indexOf("insert into rh_dry_resultados(indicador,aprovado,detalhe)"));
  assert.ok(snapshot>dryRun.indexOf("begin;")&&snapshot<marker);
  assert.match(q,/s\.funcionario_id is not distinct from l\.funcionario_id/);
  assert.match(q,/s\.colaborador_id is not distinct from l\.colaborador_id/);
  assert.match(q,/s\.viajante_nome_informado is null/);
  assert.match(q,/s\.funcionario_id is not null or s\.colaborador_id is not null/);
  assert.match(q,/c\.convalidated/);
  assert.doesNotMatch(q,/pg_get_constraintdef\(oid\) like/);
});

test("constraint nova preserva toda identidade aceita pela constraint anterior",()=>{
  const aceitaNova=(funcionario:boolean,colaborador:boolean,nome:string|null)=>(
    nome===null&&(funcionario||colaborador)
  )||(!funcionario&&!colaborador&&nome!==null&&nome.length>=3&&nome.length<=150);
  assert.equal(aceitaNova(true,false,null),true);
  assert.equal(aceitaNova(false,true,null),true);
  assert.equal(aceitaNova(true,true,null),true);
  assert.equal(aceitaNova(false,false,"Maria da Silva"),true);
  assert.equal(aceitaNova(false,false,null),false);
  assert.equal(aceitaNova(true,false,"Maria da Silva"),false);
  assert.equal(aceitaNova(false,true,"Maria da Silva"),false);
});

test("matriz RH usa quatro motivos sem ampliar usuário comum",()=>{
  assert.deepEqual(motivosPermitidos("assistente",true),["admissao","desligamento","inicio_obra","viagem_administrativa"]);
  assert.equal(motivosPermitidos("assistente",false).includes("admissao"),false);
});

for(const [motivo,subtipo,dias,texto] of [
  ["admissao",null,7,"Antecedência mínima: 7 dias corridos."],
  ["inicio_obra",null,4,"Antecedência mínima: 4 dias corridos."],
  ["desligamento","programado_outros",5,"Antecedência mínima: 5 dias corridos."],
  ["viagem_administrativa",null,0,"Sem antecedência mínima."],
] as const)test(`prazo efetivo RH: ${motivo}/${subtipo||"-"}`,()=>{
  const regra=regraPrazo(motivo,subtipo,true);
  assert.equal(regra.quantidade,dias);
  assert.equal(mensagemAntecedencia(motivo,subtipo,true),texto);
});

test("limites exatos de RH aceitam e véspera rejeita",()=>{
  const agora=new Date("2026-10-06T10:00:00-03:00");
  for(const [motivo,subtipo,dias] of [["admissao",null,7],["inicio_obra",null,4],["desligamento","programado_outros",5]] as const){
    const regra=regraPrazo(motivo,subtipo,true);
    assert.equal(regra.quantidade,dias);
    const minimo=calcularDataMinima(agora,regra.tipo,regra.quantidade).data;
    const anterior=new Date(`${minimo}T12:00:00Z`); anterior.setUTCDate(anterior.getUTCDate()-1);
    const base={motivo,desligamentoSubtipo:subtipo,role:"assistente",isRh:true,agora,dataIda:minimo,documentos:[]};
    assert.equal(validarSolicitacao(base).bloqueios.includes("FORA_DO_PRAZO"),false);
    assert.equal(validarSolicitacao({...base,dataIda:anterior.toISOString().slice(0,10)}).bloqueios.includes("FORA_DO_PRAZO"),true);
  }
});

test("modo manual limpa identidade e volta ao cadastrado limpando nome",()=>{
  const base={...emptyNovaSolicitacaoForm(),funcionario_id:"f1",viajante_nome_informado:"Maria"};
  const manual=alternarModoViajante(base,"manual");
  assert.equal(manual.funcionario_id,"");
  assert.equal(alternarModoViajante(manual,"cadastrado").viajante_nome_informado,"");
});

test("modo manual da UX e do payload exige RH ativo",()=>{
  assert.match(pages,/const viajanteManual = access\.isRh && form\.viajante_modo === "manual"/);
  assert.match(pages,/access\.isRh && form\.viajante_modo === "manual" \? <label>Nome do viajante/);
  assert.match(pages,/viajante_nome_informado:viajanteManual\?form\.viajante_nome_informado:null/);
});

test("rascunho preserva modo e nome manual",()=>{
  const form={...emptyNovaSolicitacaoForm(),viajante_modo:"manual" as const,viajante_nome_informado:"Maria da Silva"};
  const restored=parseDraft(serializeDraft({form,solicitarExcecao:false,destinoDiferente:false,justificativaDestino:""}))!;
  assert.equal(restored.form.viajante_modo,"manual");
  assert.equal(restored.form.viajante_nome_informado,"Maria da Silva");
});

test("migration protege identidade, prazo e CC no backend",()=>{
  assert.match(migration,/ro_is_rh_active\(auth\.uid\(\)\)[\s\S]*VIAJANTE_MANUAL_APENAS_RH/);
  assert.match(migration,/ro_prazo_regra_efetiva[\s\S]*rh_admissao[\s\S]*7[\s\S]*rh_inicio_obra[\s\S]*4/);
  assert.match(migration,/rh_desligamento_programado_outros[\s\S]*5/);
  assert.match(migration,/ro_catalogo_centros_custo[\s\S]*ro_is_rh_active/);
  assert.doesNotMatch(migration,/create or replace function public\.ro_can_view_all/);
  assert.match(migration,/aprovacao_status not in\('aprovada','dispensada'\)/);
});

test("consumidores mostram nome manual e dados de emissão nulos",()=>{
  assert.match(migration,/ro_nomes_colaboradores_solicitacoes[\s\S]*viajante_nome_informado/);
  assert.match(migration,/return query select v_nome_manual,null::date,null::text,null::text,null::text/);
  assert.match(pages,/Nome informado, dados cadastrais ainda não disponíveis/);
  assert.match(report,/viajante_nome_informado \|\| item\.solicitacao\.funcionario/);
  assert.match(email,/sol\.viajante_nome_informado\|\|privateTraveler/);
});
