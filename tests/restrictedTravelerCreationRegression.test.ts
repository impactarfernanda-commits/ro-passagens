import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration=readFileSync("supabase/migrations/202610140001_corrige_regressao_disponibilidade_restrito_ro.sql","utf8");
const previous=readFileSync("supabase/migrations/202610060001_regras_especiais_rh.sql","utf8");
const helper=readFileSync("supabase/migrations/202609210002_corrige_disponibilidade_viajantes_restrito_ro.sql","utf8");
const catalog=readFileSync("supabase/migrations/202609220001_corrige_visibilidade_catalogo_viajantes.sql","utf8");
const frontend=readFileSync("src/pages.tsx","utf8");
const errors=readFileSync("src/creationErrorMessages.ts","utf8");
const dryRun=readFileSync("supabase/manual/DRY_RUN_202610140001_corrige_regressao_disponibilidade_restrito_ro.sql","utf8");
const prevalidator=readFileSync("supabase/manual/prevalidar_correcao_restrito_ro_20261014.sql","utf8");
const rollbackValidator=readFileSync("supabase/manual/validar_rollback_correcao_restrito_ro_20261014.sql","utf8");
const postValidator=readFileSync("supabase/manual/validar_correcao_restrito_ro_pos_instalacao_20261014.sql","utf8");

type Scope="comum"|"restrito_ro"|"indisponivel";
const eligible=(scope:Scope,active=true,deleted=false,visible=true)=>active&&!deleted&&visible&&["comum","restrito_ro"].includes(scope);

test("catálogo e criação usam o mesmo helper canônico",()=>{
  assert.match(catalog,/ro_funcionario_disponivel_para_usuario\(auth\.uid\(\),f\.id\)/i);
  assert.match(migration,/ro_funcionario_disponivel_para_usuario\(auth\.uid\(\),new\.funcionario_id\)/i);
  assert.match(helper,/f\.escopo_passagens in \('comum','restrito_ro'\)/i);
});

test("solicitante comum aceita viajantes comum e restrito_ro",()=>{
  assert.equal(eligible("comum"),true);
  assert.equal(eligible("restrito_ro"),true);
  assert.doesNotMatch(migration,/f\.escopo_passagens='comum'\s+or\s+\(v_restrito/i);
});

test("funcionários realmente indisponíveis continuam bloqueados",()=>{
  assert.equal(eligible("restrito_ro",false),false);
  assert.equal(eligible("restrito_ro",true,true),false);
  assert.equal(eligible("restrito_ro",true,false,false),false);
  assert.equal(eligible("indisponivel"),false);
  for(const guard of [/f\.ativo/i,/f\.deleted_at is null/i,/f\.visivel_passagens/i,/escopo_passagens in \('comum','restrito_ro'\)/i]) assert.match(helper,guard);
});

test("alteração é mínima e preserva viajante manual, colaborador e RH",()=>{
  assert.equal((migration.match(/create or replace function/gi)??[]).length,1);
  assert.match(migration,/viajante_nome_informado[\s\S]*ro_is_rh_active\(auth\.uid\(\)\)[\s\S]*VIAJANTE_MANUAL_APENAS_RH/i);
  assert.match(migration,/colaborador_id[\s\S]*ro_funcionarios_enderecos_privados[\s\S]*Colaborador indisponível/i);
  assert.match(previous,/viajante_nome_informado[\s\S]*VIAJANTE_MANUAL_APENAS_RH/i);
});

test("validação independente de centro de custo permanece idêntica",()=>{
  const cc=/if not exists\(select 1 from public\.obras[^\n]+Centro de custo indisponível para este solicitante';end if;/i;
  assert.equal(migration.match(cc)?.[0],previous.match(cc)?.[0]);
  assert.match(dryRun,/cc_invalido_continua_bloqueado/);
});

test("dry run cobre fluxo canônico, negativos, RH e alinhamento",()=>{
  assert.match(dryRun,/ro_criar_solicitacao_com_aprovador/g);
  for(const indicador of ["helper_restrito_ro_disponivel","solicitante_comum_pode_restrito_ro","funcionario_comum_preservado","inativo_bloqueado","excluido_bloqueado","invisivel_passagens_bloqueado","indisponivel_bloqueado","cc_invalido_continua_bloqueado","regras_rh_preservadas","catalogo_trigger_alinhados"]) assert.match(dryRun,new RegExp(indicador));
  assert.match(dryRun,/^begin;[\s\S]*rollback;\s*$/i);
});

test("fixture reutiliza a role automática e exige um único coordenador",()=>{
  assert.doesNotMatch(dryRun,/insert into public\.user_roles/i);
  assert.match(dryRun,/update public\.user_roles set role='coordenador' where user_id=v_user/i);
  assert.match(dryRun,/select count\(\*\),min\(role::text\) into v_role_count,v_role[\s\S]*where user_id=v_user/i);
  assert.match(dryRun,/v_role_count<>1 or v_role is distinct from 'coordenador'[\s\S]*FIXTURE_ROLE_INVALIDA/i);
  assert.doesNotMatch(dryRun,/insert into public\.users_profiles/i);
});

test("dry run incorpora literalmente a redefinição da migration",()=>{
  const functionBlock=(sql:string)=>sql.match(/create or replace function public\.ro_validar_solicitacao_visibilidade\(\)[\s\S]*?end \$\$;/i)?.[0];
  assert.equal(functionBlock(dryRun),functionBlock(migration));
});

test("validadores são somente leitura e cobrem pré, rollback e pós-instalação",()=>{
  assert.match(prevalidator,/pronto_para_dry_run/);
  assert.match(rollbackValidator,/funcao_regressiva_restaurada[\s\S]*nenhuma_solicitacao_fixture/);
  assert.match(postValidator,/funcionario_usa_helper[\s\S]*catalogo_trigger_alinhados/);
  for(const validator of [prevalidator,rollbackValidator,postValidator]){
    assert.doesNotMatch(validator,/\b(insert|update|delete|merge|create|alter|drop|truncate)\b/i);
  }
});

test("frontend e tradução do erro permanecem inalterados",()=>{
  assert.match(frontend,/rpc\("ro_catalogo_colaboradores_viagem"\)/);
  assert.match(frontend,/rpc\("ro_criar_solicitacao_com_aprovador"/);
  assert.match(errors,/FUNCIONARIO_INDISPONIVEL[\s\S]*O funcionário selecionado não está mais disponível/i);
  assert.doesNotMatch(migration,/src\/|pages\.tsx|creationErrorMessages/i);
});

test("migration é transacional e não toca dados nem objetos fora da função",()=>{
  assert.match(migration,/^begin;/i);
  assert.match(migration,/commit;\s*$/i);
  assert.doesNotMatch(migration,/\b(insert|update|delete|alter table|drop|create trigger)\b/i);
  assert.doesNotMatch(migration,/ro_email|smtp|cron|vault|ro_denise_autorizados|passagem_complementar/i);
});
