import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration=fs.readFileSync("supabase/migrations/202609110001_expoe_nome_privado_por_solicitacao.sql","utf8");

test("RPC recebe solicitações e retorna somente id e nome de exibição",()=>{
  assert.match(migration,/ro_nomes_colaboradores_solicitacoes\(p_solicitacao_ids uuid\[\]\)/);
  assert.match(migration,/returns table\(solicitacao_id uuid,funcionario_nome_exibicao text\)/);
  const assinatura=migration.slice(migration.indexOf("returns table"),migration.indexOf("language sql"));
  assert.doesNotMatch(assinatura,/\b(cpf|rg|telefone|logradouro|cidade|uf|data_nascimento)\b/i);
});

test("RPC replica visibilidade e protege solicitações excluídas",()=>{
  assert.match(migration,/where auth\.uid\(\) is not null\s+and public\.ro_is_active_internal_user\(\)/);
  assert.match(migration,/public\.ro_is_active_internal_user\(\)/);
  assert.match(migration,/s\.id=any\(coalesce\(p_solicitacao_ids/);
  assert.match(migration,/s\.excluida_em is null[\s\S]*public\.ro_can_operate\(\)/);
});

test("catálogo e resumo privados exigem permissão privada",()=>{
  assert.match(migration,/where e\.ativo and public\.ro_can_view_private_addresses\(\)/);
  assert.match(migration,/ro_obter_colaborador_resumo[\s\S]*e\.id=p_colaborador_id[\s\S]*public\.ro_can_view_private_addresses\(\)/);
});

test("funções têm grants mínimos para authenticated",()=>{
  for(const assinatura of ["ro_nomes_colaboradores_solicitacoes\\(uuid\\[\\]\\)","ro_obter_colaborador_resumo\\(uuid\\)","ro_catalogo_colaboradores_viagem\\(\\)"]){
    assert.match(migration,new RegExp(`revoke all on function public\\.${assinatura} from public,anon`));
    assert.match(migration,new RegExp(`grant execute on function public\\.${assinatura} to authenticated,service_role`));
  }
  assert.doesNotMatch(migration,/grant select[\s\S]*ro_funcionarios_enderecos_privados/i);
});

test("as três funções preservam os search_path esperados",()=>{
  const nomes=migration.slice(migration.indexOf("ro_nomes_colaboradores_solicitacoes"),migration.indexOf("ro_obter_colaborador_resumo"));
  const resumo=migration.slice(migration.indexOf("ro_obter_colaborador_resumo"),migration.indexOf("ro_catalogo_colaboradores_viagem"));
  const catalogo=migration.slice(migration.indexOf("ro_catalogo_colaboradores_viagem"),migration.indexOf("revoke all on function"));
  assert.match(nomes,/security definer\s+set search_path = ''/);
  assert.match(resumo,/security definer\s+set search_path = 'public', 'pg_temp'/);
  assert.match(catalogo,/security definer set search_path = 'public', 'pg_temp'/);
});
