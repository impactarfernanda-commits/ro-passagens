import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/202609300004_dados_emissao_passagem_ro.sql",
  "utf8",
);
const pages = fs.readFileSync("src/pages.tsx", "utf8");
const rpc = migration.slice(
  migration.indexOf("create or replace function public.ro_obter_dados_emissao_passagem"),
  migration.indexOf("revoke all on function public.ro_obter_dados_emissao_passagem"),
);
const retorno = rpc.slice(rpc.indexOf("returns table("), rpc.indexOf(")\nlanguage"));
const detalhe = pages.slice(
  pages.indexOf("export function Detalhe"),
  pages.indexOf("function AcoesOperacionaisBloqueadas"),
);

test("RPC aceita somente solicitacao_id e retorna os cinco campos de emissão", () => {
  assert.match(rpc, /ro_obter_dados_emissao_passagem\(\s*p_solicitacao_id uuid\s*\)/);
  for (const campo of ["nome text", "data_nascimento date", "cpf text", "rg text", "telefone text"])
    assert.match(retorno, new RegExp(campo.replace("_", "_")));
  for (const campo of ["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "atualizado_em", "funcionario_id", "colaborador_id"])
    assert.doesNotMatch(retorno, new RegExp(`\\b${campo}\\b`));
});

test("backend exige autenticação e operador RO ativo", () => {
  assert.match(rpc, /auth\.uid\(\) is null[\s\S]*AUTENTICACAO_OBRIGATORIA/);
  assert.match(rpc, /ro_is_operador_ativo\(auth\.uid\(\)\)[\s\S]*APENAS_OPERADOR_RO_ATIVO/);
  assert.doesNotMatch(rpc, /denise|email|@|[0-9a-f]{8}-[0-9a-f]{4}-/i);
});

test("solicitação inexistente ou excluída é rejeitada", () => {
  assert.match(rpc, /s\.id=p_solicitacao_id and s\.excluida_em is null/);
  assert.match(rpc, /if not found then[\s\S]*SOLICITACAO_NAO_ENCONTRADA_OU_EXCLUIDA/);
});

test("colaborador_id exato tem precedência e funcionario_id é fallback", () => {
  assert.match(rpc, /v_colaborador_id is not null and e\.id=v_colaborador_id/);
  assert.match(rpc, /v_colaborador_id is null and v_funcionario_id is not null and e\.funcionario_id=v_funcionario_id/);
  assert.match(rpc, /where e\.ativo/);
  assert.doesNotMatch(rpc, /p_(funcionario|colaborador|cpf|nome)/i);
});

test("RPC usa SECURITY DEFINER, search_path e grants mínimos", () => {
  assert.match(rpc, /stable\s+security definer\s+set search_path='public','pg_temp'/);
  assert.match(migration, /revoke all on function public\.ro_obter_dados_emissao_passagem\(uuid\) from public,anon/);
  assert.match(migration, /grant execute on function public\.ro_obter_dados_emissao_passagem\(uuid\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to public|grant select/i);
});

test("SELECT direto fica restrito a gestão privada, sem alterar helper compatível", () => {
  assert.match(migration, /drop policy if exists ro_endereco_select_restrito/);
  assert.match(migration, /create policy ro_endereco_select_restrito[\s\S]*using\(public\.ro_can_manage_private_addresses\(auth\.uid\(\)\)\)/);
  assert.doesNotMatch(migration, /create or replace function public\.ro_can_view_private_addresses/);
});

test("frontend não possui SELECT direto da tabela privada", () => {
  const arquivos = fs
    .readdirSync("src", { recursive: true })
    .filter((arquivo) => typeof arquivo === "string" && /\.(ts|tsx)$/.test(arquivo))
    .map((arquivo) => fs.readFileSync(`src/${arquivo}`, "utf8"))
    .join("\n");
  assert.doesNotMatch(arquivos, /\.from\(["']ro_funcionarios_enderecos_privados["']\)/);
});

test("frontend consulta por solicitação somente para operador RO", () => {
  assert.match(detalhe, /if\(!row\|\|!access\.canOperateRO\)return;supabase\.rpc\("ro_obter_dados_emissao_passagem",\{p_solicitacao_id:row\.id\}\)/);
  assert.doesNotMatch(detalhe, /ro_obter_dados_emissao_passagem[\s\S]{0,120}console\./);
  assert.doesNotMatch(detalhe, /[?&](cpf|rg|telefone|data_nascimento)=/i);
});

test("card RO contém somente dados necessários para emissão", () => {
  const card = detalhe.slice(
    detalhe.indexOf("Dados para emissão da passagem") - 100,
    detalhe.indexOf("Dados cadastrais do passageiro"),
  );
  assert.match(card, /access\.canOperateRO&&dadosEmissao/);
  for (const rotulo of ["Nome", "Data de nascimento", "CPF", "RG", "Telefone"])
    assert.match(card, new RegExp(`t="${rotulo}"`));
  for (const rotulo of ["CEP", "Logradouro", "Número", "Complemento", "Bairro", "Cidade / UF", "Atualizado em"])
    assert.doesNotMatch(card, new RegExp(rotulo));
});

test("RH e administração preservam o fluxo cadastral completo", () => {
  assert.match(detalhe, /if\(!row\|\|!\(access\.isRh\|\|access\.canImport\)\)return/);
  assert.match(detalhe, /ro_obter_colaborador_detalhe/);
  assert.match(detalhe, /ro_obter_endereco_residencial_completo/);
  assert.match(detalhe, /\(access\.isRh\|\|access\.canImport\)&&enderecoResidencial/);
  assert.match(detalhe, /Dados cadastrais do passageiro[\s\S]*Logradouro[\s\S]*Bairro[\s\S]*Cidade \/ UF/);
});

test("migration não altera dados, destino residencial ou auditoria", () => {
  assert.doesNotMatch(migration, /\b(insert|update|delete|truncate)\b/i);
  assert.doesNotMatch(migration, /ro_aplicar_destino_residencial|ro_auditoria_interna|ro_colaboradores_auditoria/);
  assert.doesNotMatch(migration, /jsonb_build_object|raise notice|log\s/i);
});

test("migration é transacional e limitada à RPC, grants e policy", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.equal((migration.match(/create or replace function/gi) || []).length, 1);
  assert.equal((migration.match(/create policy/gi) || []).length, 1);
  assert.doesNotMatch(migration, /\b(create|alter|drop)\s+table\b/i);
});

test("destino residencial e helpers cadastrais não são redefinidos", () => {
  assert.doesNotMatch(migration, /create or replace function public\.ro_aplicar_destino_residencial/);
  assert.doesNotMatch(migration, /create or replace function public\.ro_obter_colaborador_detalhe/);
  assert.doesNotMatch(migration, /create or replace function public\.ro_obter_endereco_residencial_completo/);
});
