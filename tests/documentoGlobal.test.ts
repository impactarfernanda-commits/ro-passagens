import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { publicarOrientacoesViagem, type DocumentoGlobal } from "../src/documentoGlobal.ts";

const file = () => new File(["%PDF-1.7 documento"], "orientacoes.pdf", { type: "application/pdf" });
const current: DocumentoGlobal = {
  chave: "orientacoes_viagem", titulo: "Orientações de viagem", nome_arquivo: "anterior.pdf",
  storage_path: "orientacoes-viagem/11111111-1111-4111-8111-111111111111.pdf",
  mime_type: "application/pdf", tamanho_bytes: 100, versao: 1, atualizado_em: "2026-10-20T12:00:00Z",
};
const next = (old: string | null = current.storage_path) => ({
  ...current, nome_arquivo: "orientacoes.pdf", storage_path: "orientacoes-viagem/22222222-2222-4222-8222-222222222222.pdf",
  versao: current.versao + 1, storage_path_anterior: old,
});

test("somente PDF de até 10 MB é aceito", async () => {
  const deps = { upload: async () => null, register: async () => ({ data: next(), error: null }), remove: async () => null, uuid: () => "22222222-2222-4222-8222-222222222222" };
  await assert.rejects(publicarOrientacoesViagem(new File(["x"], "arquivo.txt", { type: "text/plain" }), current, deps), /Apenas arquivos PDF/);
  await assert.rejects(publicarOrientacoesViagem({ name: "grande.pdf", type: "application/pdf", size: 10 * 1024 * 1024 + 1, slice: file().slice.bind(file()) } as unknown as File, current, deps), /no máximo 10 MB/);
});

test("upload e RPC bem-sucedidos ativam nova versão e removem a anterior", async () => {
  const removed: string[][] = [];
  const result = await publicarOrientacoesViagem(file(), current, {
    upload: async () => null, register: async () => ({ data: next(), error: null }),
    remove: async (paths) => { removed.push(paths); return null; }, uuid: () => "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(result.documento.versao, 2); assert.deepEqual(removed, [[current.storage_path]]); assert.equal(result.aviso, null);
});

test("fallback usa crypto.randomUUID ligado ao receiver quando deps.uuid não é fornecido", async () => {
  let uploadedPath = "";
  const result = await publicarOrientacoesViagem(file(), null, {
    upload: async (path) => { uploadedPath = path; return null; },
    register: async (path) => ({ data: { ...next(null), storage_path: path }, error: null }),
    remove: async () => null,
  });
  assert.match(uploadedPath, /^orientacoes-viagem\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i);
  assert.equal(result.documento.storage_path, uploadedPath);

  const source = fs.readFileSync("src/documentoGlobal.ts", "utf8");
  assert.match(source, /deps\.uuid \? deps\.uuid\(\) : crypto\.randomUUID\(\)/);
  assert.doesNotMatch(source, /\(deps\.uuid \|\| crypto\.randomUUID\)\(\)/);
});

test("falha no upload não chama RPC nem remove o documento vigente", async () => {
  let rpc = 0; let remove = 0;
  await assert.rejects(publicarOrientacoesViagem(file(), current, {
    upload: async () => ({ message: "falhou" }), register: async () => { rpc++; return { data: next(), error: null }; },
    remove: async () => { remove++; return null; }, uuid: () => "22222222-2222-4222-8222-222222222222",
  }), /documento vigente foi preservado/);
  assert.deepEqual({ rpc, remove }, { rpc: 0, remove: 0 });
});

test("falha na RPC limpa apenas o upload novo", async () => {
  const removed: string[][] = [];
  await assert.rejects(publicarOrientacoesViagem(file(), current, {
    upload: async () => null, register: async () => ({ data: null, error: { message: "negado" } }),
    remove: async (paths) => { removed.push(paths); return null; }, uuid: () => "22222222-2222-4222-8222-222222222222",
  }), /negado/);
  assert.deepEqual(removed, [[next().storage_path]]);
});

test("falha ao remover anterior mantém a nova versão ativa e gera aviso", async () => {
  const result = await publicarOrientacoesViagem(file(), current, {
    upload: async () => null, register: async () => ({ data: next(), error: null }),
    remove: async () => ({ message: "falhou" }), uuid: () => "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(result.documento.versao, 2); assert.match(result.aviso || "", /nova versão está ativa/);
});

test("migration cria singleton, bucket privado, ACLs, policies e RPCs seguras", () => {
  const sql = fs.readFileSync("supabase/migrations/202610210001_documento_global_orientacoes_viagem.sql", "utf8");
  assert.match(sql, /create table public\.ro_documentos_globais/i);
  assert.match(sql, /check \(chave = 'orientacoes_viagem'\)/i);
  assert.match(sql, /alter table public\.ro_documentos_globais enable row level security/i);
  assert.match(sql, /revoke all on table public\.ro_documentos_globais from public, anon, authenticated/i);
  assert.match(sql, /'ro-documentos-globais'[\s\S]*false, 10485760, array\['application\/pdf'\]/i);
  assert.match(sql, /ro_global_documents_select[\s\S]*for select to authenticated/i);
  assert.match(sql, /ro_global_documents_insert[\s\S]*ro_is_system_admin/i);
  assert.match(sql, /owner_id = \(select auth\.uid\(\)\)::text/i);
  assert.match(sql, /security definer/g);
  assert.match(sql, /OBJETO_DOCUMENTO_GLOBAL_INEXISTENTE/);
  assert.match(sql, /v_obj\.metadata->>'size'/);
  assert.match(sql, /v_obj\.metadata->>'mimetype'/);
  assert.match(sql, /versao = public\.ro_documentos_globais\.versao \+ 1/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('ro_documentos_globais:orientacoes_viagem', 0\)\)/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete) on table public\.ro_documentos_globais/i);
});

test("migrations preservam o bucket correto na policy de update e bloqueiam regressão do typo", () => {
  const featureFiles = [
    "src/documentoGlobal.ts",
    "src/OrientacoesViagemConfig.tsx",
    "src/pages.tsx",
    "tests/documentoGlobal.test.ts",
    "supabase/migrations/202610210001_documento_global_orientacoes_viagem.sql",
    "supabase/migrations/202610210002_corrige_policy_documento_global_orientacoes_viagem.sql",
    "supabase/manual/DRY_RUN_202610210001_documento_global_orientacoes_viagem.sql",
  ];
  const typo = new RegExp(`ro-documentos-${"gllobais"}`);
  for (const path of featureFiles)
    assert.doesNotMatch(fs.readFileSync(path, "utf8"), typo, path);
  for (const path of featureFiles.filter((path) => path.includes("migrations/"))) {
    const sql = fs.readFileSync(path, "utf8");
    const policy = sql.slice(sql.indexOf("create policy ro_global_documents_update"));
    assert.match(policy, /for update to authenticated[\s\S]*bucket_id = 'ro-documentos-globais'[\s\S]*ro_is_system_admin[\s\S]*owner_id[\s\S]*orientacoes-viagem\//i, path);
    assert.doesNotMatch(policy, /bucket_id = 'ro-documentos-(?!globais)/i, path);
  }
});

test("detalhe mostra orientação separada dos anexos e sem criar custo ou anexo", () => {
  const pages = fs.readFileSync("src/pages.tsx", "utf8");
  const passagem = pages.slice(pages.indexOf("function PassagemComprada"));
  const orientacao = passagem.indexOf("Orientações para a viagem");
  const anexos = passagem.indexOf("Documentos anexados");
  assert.ok(orientacao > 0 && orientacao < anexos);
  assert.match(passagem, /Baixe o informativo e encaminhe ao colaborador junto com as passagens/);
  assert.match(passagem, /Baixar orientações/);
  assert.match(passagem, /criarUrlOrientacoes/);
  assert.doesNotMatch(passagem.slice(orientacao, anexos), /ro_passagem_anexos|ro_passagem_custos|\.insert\(/);
});

test("scripts defensivos incluem prevalidar, dry run transacional, pós-instalação e rollback", () => {
  for (const name of ["prevalidar_documento_global_orientacoes_20261021.sql", "validar_pos_instalacao_documento_global_orientacoes_20261021.sql", "validar_rollback_documento_global_orientacoes_20261021.sql"])
    assert.equal(fs.existsSync(`supabase/manual/${name}`), true, name);
  const dry = fs.readFileSync("supabase/manual/DRY_RUN_202610210001_documento_global_orientacoes_viagem.sql", "utf8");
  assert.match(dry, /^begin;/i); assert.match(dry, /rollback;/i); assert.match(dry, /tabela_revertida/);
  const migration = fs.readFileSync("supabase/migrations/202610210001_documento_global_orientacoes_viagem.sql", "utf8").replace(/\r\n/g, "\n").trim();
  const structural = dry.replace(/\r\n/g, "\n").slice(dry.indexOf("create table public.ro_documentos_globais"), dry.indexOf("do $dry$")).trim();
  assert.equal(structural, migration);
  const harness = dry.slice(dry.indexOf("do $dry$"));
  assert.match(harness, /from public\.user_roles ur[\s\S]*join auth\.users u/i);
  assert.doesNotMatch(harness, /from public\.ro_responsaveis/i);
  assert.match(harness, /v_admin_count <> 1/);
  assert.match(harness, /set_config\('request\.jwt\.claim\.sub', v_admin::text, true\)/);
  assert.match(harness, /auth\.uid\(\) is distinct from v_admin/);
  assert.match(harness, /ro_is_system_admin\(auth\.uid\(\)\)/);
  assert.match(harness, /DRY_RUN_NAO_ADMIN_NAO_FOI_REJEITADO/);
});
