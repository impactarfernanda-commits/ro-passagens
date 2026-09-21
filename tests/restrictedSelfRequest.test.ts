import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const infrastructure=readFileSync("supabase/migrations/202609210001_autossolicitacao_funcionario_restrito.sql","utf8");
const correction=readFileSync("supabase/migrations/202609210002_corrige_disponibilidade_viajantes_restrito_ro.sql","utf8");
const approval=readFileSync("supabase/migrations/202609100002_dispensa_aprovacao_desligamentos_urgentes.sql","utf8");

type Scope="comum"|"restrito_ro"|"indisponivel";
const disponivel=(scope:Scope,active=true,visible=true,deleted=false,userPresent=true)=>
  userPresent&&active&&!deleted&&visible&&(scope==="comum"||scope==="restrito_ro");

test("comum e restrito_ro são elegíveis para qualquer solicitante autenticado",()=>{
  assert.equal(disponivel("comum"),true);
  assert.equal(disponivel("restrito_ro"),true);
  for(const perfil of ["comum","coordenador","ro","admin"]){
    assert.equal(disponivel("restrito_ro"),true,perfil);
  }
});

test("um usuário pode selecionar outro restrito_ro sem vínculo canônico",()=>{
  assert.equal(disponivel("restrito_ro"),true);
  assert.doesNotMatch(correction,/ro_can_view_all|ro_usuario_funcionario_vinculos/i);
});

test("indisponível, invisível, inativo, excluído e usuário ausente falham fechados",()=>{
  assert.equal(disponivel("indisponivel"),false);
  assert.equal(disponivel("restrito_ro",true,false),false);
  assert.equal(disponivel("restrito_ro",false),false);
  assert.equal(disponivel("restrito_ro",true,true,true),false);
  assert.equal(disponivel("restrito_ro",true,true,false,false),false);
});

test("helper corretivo preserva assinatura e aplica somente a elegibilidade do viajante",()=>{
  assert.match(correction,/ro_funcionario_disponivel_para_usuario\(\s*p_user_id uuid,\s*p_funcionario_id uuid\s*\)/i);
  assert.match(correction,/p_user_id is not null[\s\S]*p_funcionario_id is not null/i);
  assert.match(correction,/f\.id=p_funcionario_id[\s\S]*f\.ativo[\s\S]*f\.deleted_at is null[\s\S]*f\.visivel_passagens/i);
  assert.match(correction,/f\.escopo_passagens in \('comum','restrito_ro'\)/i);
  assert.doesNotMatch(correction,/escopo_passagens\s*=\s*'indisponivel'/i);
});

test("catálogo e trigger continuam alinhados pelo mesmo helper",()=>{
  const catalogCalls=infrastructure.match(/ro_funcionario_disponivel_para_usuario\(auth\.uid\(\),f\.id\)/gi)??[];
  assert.equal(catalogCalls.length,2);
  assert.match(infrastructure,/elsif not public\.ro_funcionario_disponivel_para_usuario\(auth\.uid\(\),new\.funcionario_id\) then/i);
  assert.match(infrastructure,/raise exception 'Funcionário indisponível para este solicitante'/i);
});

test("correção não altera catálogo, trigger, payload nem centros de custo",()=>{
  assert.doesNotMatch(correction,/create or replace function public\.ro_catalogo_colaboradores_viagem/i);
  assert.doesNotMatch(correction,/create or replace function public\.ro_validar_solicitacao_visibilidade/i);
  assert.doesNotMatch(correction,/ro_passagem_solicitacoes|p_solicitacao|public\.obras/i);
});

test("infraestrutura de vínculo permanece sem participar da autorização",()=>{
  assert.match(infrastructure,/create table public\.ro_usuario_funcionario_vinculos/i);
  assert.match(infrastructure,/enable row level security/i);
  assert.match(infrastructure,/revoke all on table public\.ro_usuario_funcionario_vinculos from public,anon,authenticated,service_role/i);
  assert.doesNotMatch(correction,/\b(?:drop|alter|insert|update|delete)\b[\s\S]*ro_usuario_funcionario_vinculos/i);
});

test("dados privados e permissões administrativas permanecem fora da correção",()=>{
  assert.doesNotMatch(correction,/ro_funcionarios_enderecos_privados|ro_can_view_private_addresses|cpf|endereco|ro_can_view_all/i);
  assert.match(correction,/revoke all on function public\.ro_funcionario_disponivel_para_usuario\(uuid,uuid\)[\s\S]*from public,anon,authenticated/i);
  assert.match(correction,/grant execute on function public\.ro_funcionario_disponivel_para_usuario\(uuid,uuid\)[\s\S]*to service_role/i);
});

test("catálogo privado continua protegido pela permissão específica",()=>{
  assert.match(infrastructure,/from public\.ro_funcionarios_enderecos_privados e[\s\S]*where e\.ativo and public\.ro_can_view_private_addresses\(\)/i);
  assert.doesNotMatch(correction,/ro_can_view_private_addresses|ro_can_manage_private_addresses/i);
});

test("autoaprovação do coordenador permanece inalterada",()=>{
  assert.doesNotMatch(correction,/aprovador_id|aprovacao_status|autoaprova/i);
  assert.match(approval,/v_auto:=v_aprovador=auth\.uid\(\)[\s\S]*r\.role::text='coordenador'/i);
});

test("migration corretiva é mínima, posterior e transacional",()=>{
  assert.match(correction,/^begin;/i);
  assert.match(correction,/commit;\s*$/i);
  assert.equal((correction.match(/create or replace function/gi)??[]).length,1);
  assert.doesNotMatch(correction,/de6616a4|060e3ccd|yordan/i);
  assert.doesNotMatch(correction,/insert\s+into|update\s+public|delete\s+from|drop\s+/i);
});
