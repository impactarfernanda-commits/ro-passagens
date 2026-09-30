import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { buildPostPurchasePayload, canonicalizePostPurchasePayload, deterministicPostPurchaseStoragePath, isExistingDeterministicUpload, postPurchaseCostCenters, postPurchaseErrorMessage, registerPostPurchaseOperation, sha256Hex, shouldCleanupPostPurchaseUploads } from "../src/postPurchasePassage.ts";
import { isValidFinancialPassageIdentity } from "../src/passagemGrouping.ts";
import { buildPurchaseCosts } from "../src/purchaseCosts.ts";
import type { Custo } from "../src/types.ts";

const cost = (id: string, valor: number, compra_chave: string | null = null): Custo => ({
  id, tipo: "passagem", descricao: null, valor, centro_custo_id: "cc", compra_chave,
});
const cc = "11111111-1111-4111-8111-111111111111";
const document = (patch: Record<string, unknown> = {}) => ({
  ref: "new:1", id: "draft", nome_arquivo: "voucher.pdf", valor: 100,
  partida_em: "2026-10-02T10:00", passageiro: "PESSOA TESTE", origem: "A/SP",
  destino: "B/SP", localizador: "ABC123", tipo_documento: "voucher" as const,
  sha256: "a".repeat(64), mimeType: "application/pdf", size: 100, ...patch,
});

test("documento de apoio não cria grupo financeiro", () => {
  const payload = buildPostPurchasePayload([document()], { "LOC:ABC123": { financial: false, value: 100, manual: false, justification: "" } }, []);
  assert.equal(payload.groups.length, 0);
  assert.equal(payload.attachments.length, 1);
});

test("valor automático cria no máximo um custo por grupo voucher + bilhete", () => {
  const docs = [document(), document({ ref: "new:2", id: "ticket", nome_arquivo: "bilhete.pdf", valor: 80, tipo_documento: "bilhete_embarque" })];
  const payload = buildPostPurchasePayload(docs, { "LOC:ABC123": { financial: true, value: 100, manual: false, justification: "", centro_custo_id: cc } }, []);
  assert.equal(payload.groups.length, 1);
  assert.equal(payload.groups[0].anexo_refs.length, 2);
  assert.equal(payload.groups[0].valor_confirmado, 100);
});

test("valor ausente ou corrigido exige confirmação justificada", () => {
  const noValue = document({ valor: "", localizador: "", tipo_documento: "documento_sem_valor", valor_confirmado_manualmente: true });
  const key = "PESSOA TESTE||A SP|B SP|202610021000|";
  assert.throws(() => buildPostPurchasePayload([noValue], { [key]: { financial: true, value: 120, manual: true, justification: "curta", centro_custo_id: cc } }, []), /justificativa/);
  const payload = buildPostPurchasePayload([noValue], { [key]: { financial: true, value: 120, manual: true, justification: "Valor conferido no documento", centro_custo_id: cc } }, []);
  assert.equal(payload.groups[0].valor_manual, true);
});

test("custo histórico nunca é associado automaticamente apenas pelo valor", () => {
  const payload = buildPostPurchasePayload([document()], { "LOC:ABC123": { financial: true, value: 100, manual: false, justification: "", centro_custo_id: cc } }, [cost("legacy", 100)]);
  assert.equal(payload.groups[0].custo_existente_id, null);
  assert.equal(payload.groups[0].associacao_historica_manual, false);
});

test("revisão sem ação explícita não vira nova passagem nem documento de apoio", () => {
  assert.throws(() => buildPostPurchasePayload([document()], {
    "LOC:ABC123": { value: 100, manual: false, justification: "" },
  }, []), /Escolha uma ação/);
});

test("nova passagem com a mesma compra_chave orienta vínculo explícito", () => {
  assert.throws(() => buildPostPurchasePayload([document()], {
    "LOC:ABC123": { action: "new", value: 100, manual: false, justification: "", centro_custo_id: cc },
  }, [cost("existing", 100, "LOC:ABC123")]), /Vincular a passagem existente/);
});

test("vínculo exige custo selecionado e não altera o valor existente", () => {
  assert.throws(() => buildPostPurchasePayload([document()], {
    "LOC:ABC123": { action: "link", value: 999, manual: true, justification: "Associação histórica conferida" },
  }, [cost("existing", 100)]), /Selecione explicitamente/);
  const payload = buildPostPurchasePayload([document()], {
    "LOC:ABC123": { action: "link", value: 100, manual: true, justification: "Associação histórica conferida", existingCostId: "existing" },
  }, [cost("existing", 100)]);
  assert.equal(payload.groups[0].custo_existente_id, "existing");
});

test("UI histórica não pré-seleciona ação nem custo", () => {
  const component = fs.readFileSync("src/AdicionarAnexo.tsx", "utf8");
  assert.match(component, /action: "link", existingCostId: undefined/);
  assert.match(component, /<option value="">Selecione explicitamente<\/option>/);
  assert.doesNotMatch(component, /financial: hasNew/);
  assert.doesNotMatch(component, /const selected = custos\.find\(\(cost\) => cost\.tipo === "passagem"\)/);
});

test("guarda de banco bloqueia compra_chave existente, preserva vínculo e replay", () => {
  const sql = fs.readFileSync("supabase/migrations/202609300002_exige_vinculo_explicito_pos_compra.sql", "utf8");
  assert.match(sql, /for update/i);
  assert.match(sql, /custo_existente_id/);
  assert.match(sql, /COMPRA_CHAVE_JA_EXISTE_VINCULE_CUSTO/);
  assert.match(sql, /ro_passagem_operacoes_idempotentes/);
  assert.match(sql, /ro_registrar_documentos_pos_compra_20260930_base/);
});

test("anexo existente é enviado por id sem exigir reupload", () => {
  const existing = document({ ref: "existing:a", existingAttachmentId: "a", storagePath: "request/a.pdf", historicalOnly: true, sourceExisting: true });
  const payload = buildPostPurchasePayload([existing], { "LOC:ABC123": { financial: true, value: 100, manual: true, justification: "Associação conferida manualmente", existingCostId: "legacy" } }, [cost("legacy", 100)]);
  assert.equal(payload.attachments[0].id, "a");
  assert.equal("storage_path" in payload.attachments[0], false);
  assert.deepEqual(Object.keys(payload.attachments[0]).sort(), ["client_ref", "conteudo_sha256", "id"]);
  assert.equal(payload.groups[0].custo_existente_id, "legacy");
  assert.equal(payload.groups[0].associacao_historica_manual, true);
  assert.equal(payload.groups[0].centro_custo_id, null);
});

test("migration protege hash, chave, concorrência, estados e auditoria sem alterar solicitação", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  assert.match(sql, /unique index[\s\S]*\(solicitacao_id,compra_chave\)[\s\S]*tipo='passagem'/i);
  assert.match(sql, /unique index[\s\S]*\(solicitacao_id,conteudo_sha256\)/i);
  assert.match(sql, /from public\.ro_passagem_solicitacoes[\s\S]*for update/i);
  assert.match(sql, /status not in\('passagem_comprada','finalizada'\)/i);
  assert.match(sql, /aprovacao_status in\('pendente','reprovada'\)/i);
  assert.match(sql, /primary key\(solicitacao_id,operacao_id\)/i);
  assert.match(sql, /payload_fingerprint/);
  assert.match(sql, /on delete no action/i);
  assert.match(sql, /ro_normalizar_compra_chave/);
  assert.match(sql, /COMPRA_CHAVE_REPETIDA_NO_PAYLOAD/);
  assert.match(sql, /ANEXO_USADO_EM_DOIS_GRUPOS_FINANCEIROS/);
  assert.match(sql, /documento_pos_compra_sem_custo/);
  assert.match(sql, /documento_historico_vinculado_manualmente/);
  assert.match(sql, /ro_passagem_historico/);
  assert.match(sql, /ro_auditoria_interna/);
  assert.doesNotMatch(sql, /update public\.ro_passagem_solicitacoes/i);
  assert.doesNotMatch(sql, /delete from public\.ro_passagem_custos/i);
});

test("proteção de recompra é FK restritiva e não apaga silenciosamente custo vinculado", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  assert.match(sql, /foreign key\(custo_id\)[\s\S]*on delete no action/i);
  assert.doesNotMatch(sql, /on delete set null/i);
});

test("frontend persiste operation id pelo fingerprint até sucesso", () => {
  const component = fs.readFileSync("src/AdicionarAnexo.tsx", "utf8");
  assert.match(component, /localStorage\.getItem\(operationStorageKey/);
  assert.match(component, /savedOperation\?\.fingerprint === fingerprint/);
  assert.match(component, /localStorage\.removeItem\(operationStorageKey/);
});

test("retry reutiliza path determinístico e conflito de objeto existente não bloqueia a RPC", () => {
  const path = deterministicPostPurchaseStoragePath("sol", "op", "a".repeat(64), "voucher.pdf");
  assert.equal(path, deterministicPostPurchaseStoragePath("sol", "op", "a".repeat(64), "voucher.pdf"));
  assert.equal(isExistingDeterministicUpload({ statusCode: 409, message: "Duplicate" }), true);
  assert.equal(isExistingDeterministicUpload({ message: "The resource already exists" }), true);
  assert.equal(isExistingDeterministicUpload({ statusCode: 500, message: "failure" }), false);
});

test("política de limpeza distingue fase anterior e posterior ao início da RPC", () => {
  assert.equal(shouldCleanupPostPurchaseUploads(false), true);
  assert.equal(shouldCleanupPostPurchaseUploads(true), false);
});

test("fluxo real continua até replay quando o objeto determinístico já existe e não remove Storage", async () => {
  const docs = [document({ file: new File(["%PDF-1.7 retry"], "voucher.pdf", { type: "application/pdf" }) })];
  const payload = buildPostPurchasePayload(docs, { "LOC:ABC123": { financial: true, value: 100, manual: false, justification: "", centro_custo_id: cc } }, []);
  const calls = { upload: 0, rpc: 0, remove: 0 };
  const result = await registerPostPurchaseOperation({
    requestId: "request", operationId: "operation", attachments: payload.attachments, documents: docs,
    upload: async () => { calls.upload++; return { statusCode: 409, message: "The resource already exists" }; },
    remove: async () => { calls.remove++; },
    register: async (attachments) => {
      calls.rpc++;
      assert.match("storage_path" in attachments[0] ? String(attachments[0].storage_path) : "", /^request\/pos-compra\/operation-/);
      return { data: { idempotent_replay: true }, error: null };
    },
  });
  assert.deepEqual(calls, { upload: 1, rpc: 1, remove: 0 });
  assert.deepEqual(result, { idempotent_replay: true });
});

test("resposta ambígua depois que a RPC começou preserva upload novo", async () => {
  const docs = [document({ file: new File(["%PDF-1.7 ambiguous"], "voucher.pdf", { type: "application/pdf" }) })];
  const payload = buildPostPurchasePayload(docs, { "LOC:ABC123": { financial: true, value: 100, manual: false, justification: "", centro_custo_id: cc } }, []);
  let removeCalls = 0;
  await assert.rejects(registerPostPurchaseOperation({
    requestId: "request", operationId: "operation", attachments: payload.attachments, documents: docs,
    upload: async () => null,
    remove: async () => { removeCalls++; },
    register: async () => { throw new Error("transport interrupted"); },
  }), /transport interrupted/);
  assert.equal(removeCalls, 0);
});

test("divergência de CC retornada pela RPC preserva o upload para reconciliação", async () => {
  const docs = [document({ file: new File(["%PDF-1.7 cc conflict"], "voucher.pdf", { type: "application/pdf" }) })];
  const payload = buildPostPurchasePayload(docs, { "LOC:ABC123": { financial: true, value: 100, manual: false, justification: "", centro_custo_id: cc } }, []);
  let removeCalls = 0;
  await assert.rejects(registerPostPurchaseOperation({
    requestId: "request", operationId: "operation-2", attachments: payload.attachments, documents: docs,
    upload: async () => null,
    remove: async () => { removeCalls++; },
    register: async () => ({ data: null, error: { message: "COMPRA_CHAVE_CENTRO_CUSTO_DIVERGENTE" } }),
  }), /COMPRA_CHAVE_CENTRO_CUSTO_DIVERGENTE/);
  assert.equal(removeCalls, 0);
});

test("falha definitiva antes da RPC limpa somente upload criado nesta tentativa", async () => {
  const docs = [
    document({ ref: "new:1", nome_arquivo: "first.pdf", file: new File(["%PDF-1.7 first"], "first.pdf", { type: "application/pdf" }), sha256: "a".repeat(64) }),
    document({ ref: "new:2", id: "second", nome_arquivo: "second.pdf", file: new File(["%PDF-1.7 second"], "second.pdf", { type: "application/pdf" }), sha256: "b".repeat(64) }),
  ];
  const payload = buildPostPurchasePayload(docs, { "LOC:ABC123": { financial: true, value: 100, manual: false, justification: "", centro_custo_id: cc } }, []);
  const removed: string[][] = [];
  let uploads = 0;
  let rpcCalls = 0;
  await assert.rejects(registerPostPurchaseOperation({
    requestId: "request", operationId: "operation", attachments: payload.attachments, documents: docs,
    upload: async () => (++uploads === 1 ? null : { statusCode: 500, message: "definitive failure" }),
    remove: async (paths) => { removed.push(paths); },
    register: async () => { rpcCalls++; return { data: null, error: null }; },
  }), /Não foi possível enviar second.pdf/);
  assert.equal(rpcCalls, 0);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].length, 1);
  assert.match(removed[0][0], /^request\/pos-compra\/operation-a{64}-first.pdf$/);
});

test("identidade financeira aceita LOC, BIL e estrutura suficiente", () => {
  assert.equal(isValidFinancialPassageIdentity("LOC:ABC123"), true);
  assert.equal(isValidFinancialPassageIdentity("BIL:5770009771544"), true);
  assert.equal(isValidFinancialPassageIdentity("PESSOA|12345678900|A SP|B SP|202610021000|"), true);
  assert.equal(isValidFinancialPassageIdentity("||A SP|B SP|202610021000|"), true);
});

test("identidade financeira rejeita vazio, pendente, assinatura vazia e evidência isolada", () => {
  for (const key of ["", "PENDENTE:0", "|||||", "PESSOA|||||", "|||||12A"])
    assert.equal(isValidFinancialPassageIdentity(key), false, key);
});

test("mesma identidade fraca aceita na compra normal é bloqueada no pós-compra", () => {
  const onlyValue = document({ localizador: "", passageiro: "", origem: "", destino: "", partida_em: "", valor_confirmado_manualmente: true });
  assert.throws(() => buildPostPurchasePayload([onlyValue], { "|||||": { financial: true, value: 100, manual: true, justification: "Valor revisado manualmente" } }, []), /identificar esta passagem/);
  assert.equal(buildPurchaseCosts("s", [onlyValue], { uber: "", refeicao: "", outros: "" }, "cc").length, 1);
});

test("payload canônico iguala formatos numéricos, ausências, booleanos, espaços e ordens", () => {
  const first = buildPostPurchasePayload([
    document({ ref: "b", sha256: "b".repeat(64) }),
    document({ ref: "a", id: "ticket", nome_arquivo: "ticket.pdf", sha256: "a".repeat(64), tipo_documento: "bilhete_embarque" }),
  ], { "LOC:ABC123": { financial: true, value: 100, manual: true, justification: "  conferido   pela equipe  ", centro_custo_id: cc } }, []);
  type Group = (typeof first.groups)[number];
  type MutableGroup = Omit<Group, "valor_confirmado" | "valor_extraido" | "valor_manual" | "associacao_historica_manual" | "custo_existente_id"> & {
    valor_confirmado: string; valor_extraido: string; valor_manual?: boolean;
    associacao_historica_manual?: boolean; custo_existente_id?: string | null;
  };
  const second = structuredClone(first) as unknown as { attachments: typeof first.attachments; groups: MutableGroup[] };
  second.attachments.reverse();
  second.groups[0].anexo_refs.reverse();
  second.groups[0].valor_confirmado = "100.00";
  second.groups[0].valor_extraido = "100.0";
  second.groups[0].valor_manual = true;
  second.groups[0].associacao_historica_manual = undefined;
  second.groups[0].justificativa = "conferido pela equipe";
  delete second.groups[0].custo_existente_id;
  assert.deepEqual(canonicalizePostPurchasePayload(first), canonicalizePostPurchasePayload(second as unknown as typeof first));
});

test("payload canônico distingue alteração financeira material", () => {
  const first = buildPostPurchasePayload([document()], { "LOC:ABC123": { financial: true, value: 100, manual: false, justification: "", centro_custo_id: cc } }, []);
  const second = structuredClone(first);
  second.groups[0].valor_confirmado = 101;
  assert.notDeepEqual(canonicalizePostPurchasePayload(first), canonicalizePostPurchasePayload(second));
});

test("nova passagem exige CC explícito, mas apoio e vínculo histórico não", () => {
  assert.throws(() => buildPostPurchasePayload([document()], {
    "LOC:ABC123": { financial: true, value: 100, manual: false, justification: "" },
  }, []), /Selecione o centro de custo da nova passagem/);
  assert.equal(buildPostPurchasePayload([document()], {
    "LOC:ABC123": { financial: false, value: 100, manual: false, justification: "" },
  }, []).groups.length, 0);
  const historical = buildPostPurchasePayload([document()], {
    "LOC:ABC123": { financial: true, value: 100, manual: true, justification: "Associação histórica confirmada", existingCostId: "legacy" },
  }, [cost("legacy", 100)]);
  assert.equal(historical.groups[0].centro_custo_id, null);
});

test("catálogo pós-compra aceita somente IDs vinculados, visíveis e de escopo permitido", () => {
  const request = { obra_id: "obra", centro_custo_destino_id: "destino", centro_custo_retorno_id: "retorno-invisivel" };
  const catalog = [
    { id: "obra", nome: "Obra", visivel_passagens: true, escopo_passagens: "comum" },
    { id: "obra", nome: "Obra duplicada", visivel_passagens: true, escopo_passagens: "comum" },
    { id: "destino", nome: "Destino", visivel_passagens: true, escopo_passagens: "restrito_ro" },
    { id: "retorno-invisivel", nome: "Retorno", visivel_passagens: false, escopo_passagens: "comum" },
    { id: "externo", nome: "Externo", visivel_passagens: true, escopo_passagens: "comum" },
    { id: "indisponivel", nome: "Indisponível", visivel_passagens: true, escopo_passagens: "indisponivel" },
  ];
  assert.deepEqual(postPurchaseCostCenters(request, catalog).map(({ id }) => id), ["obra", "destino"]);
  assert.deepEqual(postPurchaseCostCenters({ ...request, centro_custo_retorno_id: "indisponivel" }, catalog).map(({ id }) => id), ["obra", "destino"]);
});

test("CC integra fingerprint e escolhas de múltiplos grupos são independentes", async () => {
  const cc2 = "22222222-2222-4222-8222-222222222222";
  const docs = [
    document(),
    document({ ref: "new:2", id: "draft-2", localizador: "DEF456", sha256: "b".repeat(64), nome_arquivo: "segundo.pdf" }),
  ];
  const decisions = {
    "LOC:ABC123": { financial: true, value: 100, manual: false, justification: "", centro_custo_id: cc },
    "LOC:DEF456": { financial: true, value: 100, manual: false, justification: "", centro_custo_id: cc2 },
  };
  const first = canonicalizePostPurchasePayload(buildPostPurchasePayload(docs, decisions, []));
  const replay = canonicalizePostPurchasePayload(buildPostPurchasePayload([...docs].reverse(), decisions, []));
  assert.deepEqual(first, replay);
  assert.deepEqual(first.groups.map((group) => group.centro_custo_id), [cc, cc2]);
  const changed = canonicalizePostPurchasePayload(buildPostPurchasePayload(docs, {
    ...decisions,
    "LOC:DEF456": { ...decisions["LOC:DEF456"], centro_custo_id: cc },
  }, []));
  assert.notDeepEqual(first, changed);
  assert.equal(await sha256Hex(new Blob([JSON.stringify(first)])), await sha256Hex(new Blob([JSON.stringify(replay)])));
  assert.notEqual(await sha256Hex(new Blob([JSON.stringify(first)])), await sha256Hex(new Blob([JSON.stringify(changed)])));
});

test("migration valida CC por grupo antes da idempotência e usa o canônico no INSERT", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  const beforeIdempotency = sql.slice(0, sql.indexOf("insert into public.ro_passagem_operacoes_idempotentes"));
  assert.match(beforeIdempotency, /v_cc:=nullif\(btrim\(v_grupo->>'centro_custo_id'\),''\)::uuid/i);
  assert.match(beforeIdempotency, /v_cc is not distinct from v_sol\.obra_id/i);
  assert.match(beforeIdempotency, /v_cc is not distinct from v_sol\.centro_custo_destino_id/i);
  assert.match(beforeIdempotency, /v_cc is not distinct from v_sol\.centro_custo_retorno_id/i);
  assert.match(beforeIdempotency, /o\.id=v_cc and o\.visivel_passagens and o\.escopo_passagens in\('comum','restrito_ro'\)/i);
  assert.match(beforeIdempotency, /'centro_custo_id',v_cc/i);
  assert.match(sql, /v_cc:=nullif\(v_grupo->>'centro_custo_id',''\)::uuid[\s\S]*values\(p_solicitacao_id,'passagem','Passagem adicionada após a compra',v_valor,v_cc/i);
  assert.doesNotMatch(sql, /select c\.centro_custo_id into v_cc/i);
  assert.doesNotMatch(sql, /v_cc:=coalesce/i);
});

test("reutilização por compra_chave exige valor e CC canônicos antes de qualquer efeito", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  const lookup = sql.indexOf("select * into v_custo from public.ro_passagem_custos c where c.solicitacao_id=p_solicitacao_id and c.tipo='passagem' and c.compra_chave=v_chave for update");
  const valueGuard = sql.indexOf("abs(v_custo.valor-v_valor)>=0.005", lookup);
  const ccGuard = sql.indexOf("v_custo.centro_custo_id is distinct from v_cc", valueGuard);
  const ccError = sql.indexOf("COMPRA_CHAVE_CENTRO_CUSTO_DIVERGENTE", ccGuard);
  const attachmentLink = sql.indexOf("update public.ro_passagem_anexos set custo_id=v_custo.id", ccError);
  const successHistory = sql.indexOf("insert into public.ro_passagem_historico", attachmentLink);
  const successResult = sql.indexOf("set status='concluida',resultado=v_resultado", successHistory);
  assert.ok(lookup > 0, "custo existente é localizado e bloqueado");
  assert.ok(valueGuard > lookup, "valor divergente continua rejeitado");
  assert.ok(ccGuard > valueGuard, "CC é comparado após o valor no ramo não histórico");
  assert.ok(ccError > ccGuard, "divergência possui erro funcional específico");
  assert.ok(attachmentLink > ccError, "erro ocorre antes do vínculo de anexos");
  assert.ok(successHistory > attachmentLink, "histórico de sucesso ocorre depois das validações");
  assert.ok(successResult > successHistory, "resultado idempotente só é concluído ao final");
  assert.match(sql.slice(lookup, attachmentLink), /elsif v_custo\.centro_custo_id is distinct from v_cc then\s+raise exception 'COMPRA_CHAVE_CENTRO_CUSTO_DIVERGENTE'/i);
});

test("frontend apresenta seletor sem default, bloqueia ausência e traduz erro do backend", () => {
  const component = fs.readFileSync("src/AdicionarAnexo.tsx", "utf8");
  assert.match(component, /Centro de custo \*/);
  assert.match(component, /<option value="">Selecione o centro de custo<\/option>/);
  assert.match(component, /disabled=\{busy \|\| missingAction \|\| missingCostCenter \|\| missingExistingCost\}/);
  assert.match(component, /decision\?\.action === "new" && <>/);
  assert.match(component, /centro_custo_id: undefined/);
  assert.equal(postPurchaseErrorMessage("CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO"), "O centro de custo selecionado não está disponível para esta solicitação.");
  assert.equal(postPurchaseErrorMessage("COMPRA_CHAVE_CENTRO_CUSTO_DIVERGENTE"), "Esta passagem já foi registrada com outro centro de custo. Revise a seleção antes de continuar.");
});

test("frontend desabilita custo sem identidade e apresenta mensagem antes da RPC", () => {
  const component = fs.readFileSync("src/AdicionarAnexo.tsx", "utf8");
  assert.match(component, /disabled=\{!validFinancialIdentity \|\| Boolean\(sameKey\)\}/);
  assert.match(component, /Não foi possível identificar esta passagem com segurança/);
});

test("migration canonicaliza antes do fingerprint e execução reutiliza estruturas canônicas", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  assert.match(sql, /v_valor:=round\(nullif\(v_grupo->>'valor_confirmado',''\)::numeric,2\)[\s\S]*v_grupo:=jsonb_build_object[\s\S]*v_grupos_fingerprint:=v_grupos/i);
  assert.match(sql, /v_justificativa:=nullif\(btrim\(regexp_replace[\s\S]*'justificativa',v_justificativa/i);
  assert.match(sql, /jsonb_agg\(value order by value->>'client_ref'\)/i);
  assert.match(sql, /jsonb_agg\(value order by value->>'compra_chave'\)/i);
  assert.doesNotMatch(sql.slice(sql.indexOf("for v_grupo in select value from jsonb_array_elements(v_grupos)")), /round\(nullif\(v_grupo->>'valor_confirmado'/i);
  assert.match(sql, /Apenas desserializa a estrutura já canonicalizada e fingerprintada; não renormaliza/i);
});

test("migration preserva referências canonicalizadas dos anexos para validar todos os grupos", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  const attachmentsStart = sql.indexOf("-- Canonicaliza anexos antes do fingerprint/DML");
  const groupsStart = sql.indexOf("-- Canonicaliza grupos integralmente", attachmentsStart);
  const fingerprintStart = sql.indexOf("v_anexos_fingerprint:=v_anexos", groupsStart);
  const attachmentPhase = sql.slice(attachmentsStart, groupsStart);
  const groupPhase = sql.slice(groupsStart, fingerprintStart);

  assert.ok(attachmentsStart > 0 && groupsStart > attachmentsStart && fingerprintStart > groupsStart);
  assert.match(attachmentPhase, /v_refs:=array_append\(v_refs,v_ref\)/i, "H1, H2 e H3 entram no conjunto canônico");
  assert.doesNotMatch(attachmentPhase, /v_refs:=array\[\]::text\[\]/i, "v_refs não é zerado após canonicalizar anexos");
  assert.match(groupPhase, /for v_ref in select jsonb_array_elements_text\(v_refs_ordenadas\)[\s\S]*array_position\(v_refs,v_ref\) is null[\s\S]*REFERENCIA_ANEXO_DO_GRUPO_INVALIDA/i);
  assert.match(groupPhase, /v_usadas:=array_append\(v_usadas,v_ref\)/i, "subconjuntos válidos de múltiplos grupos são aceitos e rastreados");
  assert.equal((sql.match(/REFERENCIA_ANEXO_DO_GRUPO_INVALIDA/g) || []).length, 2, "referência H4 inexistente permanece bloqueada na canonicalização e na execução");
});

test("fingerprint qualifica pgcrypto sem ampliar o search_path da RPC", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  const rpcStart = sql.indexOf("create or replace function public.ro_registrar_documentos_pos_compra");
  const rpcEnd = sql.indexOf("end $$;", rpcStart);
  const rpc = sql.slice(rpcStart, rpcEnd);

  assert.equal((sql.match(/extensions\.digest\s*\(/gi) || []).length, 1);
  assert.doesNotMatch(sql, /(^|[^.\w])digest\s*\(/im);
  assert.match(rpc, /security definer set search_path=public,storage,pg_temp/i);
  assert.match(rpc, /extensions\.digest\([\s\S]*'sha256'::text\)/i);
});

test("RPC busca metadata histórica persistida e não a sobrescreve", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  assert.match(sql, /where a\.id=v_id::uuid and a\.solicitacao_id=p_solicitacao_id for update/i);
  assert.match(sql, /'nome_arquivo',v_anexo\.nome_arquivo[\s\S]*'storage_path',v_anexo\.storage_path[\s\S]*'mime_type',v_anexo\.mime_type/i);
  assert.match(sql, /ANEXO_REPRESENTADO_POR_ID_E_STORAGE_PATH/);
  assert.doesNotMatch(sql, /update public\.ro_passagem_anexos set (nome_arquivo|storage_path|mime_type|tamanho_bytes)/i);
});

test("replay histórico consulta idempotência antes de rejeitar anexo já vinculado", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  const canonicalStart = sql.indexOf("-- Canonicaliza anexos antes do fingerprint/DML");
  const idempotencyInsert = sql.indexOf("insert into public.ro_passagem_operacoes_idempotentes", canonicalStart);
  const fingerprintConflict = sql.indexOf("OPERACAO_ID_REUTILIZADA_COM_PAYLOAD_DIFERENTE", idempotencyInsert);
  const replayReturn = sql.indexOf("idempotent_replay',true", fingerprintConflict);
  const executionStart = sql.indexOf("for v_item in select value from jsonb_array_elements(v_anexos)", replayReturn);
  const linkedGuard = sql.indexOf("ANEXO_EXISTENTE_JA_VINCULADO", executionStart);
  assert.ok(canonicalStart > 0 && idempotencyInsert > canonicalStart);
  assert.doesNotMatch(sql.slice(canonicalStart, idempotencyInsert), /ANEXO_EXISTENTE_JA_VINCULADO/);
  assert.ok(fingerprintConflict > idempotencyInsert, "payload divergente é rejeitado pela idempotência");
  assert.ok(replayReturn > fingerprintConflict, "replay concluído retorna antes da execução");
  assert.ok(linkedGuard > executionStart && executionStart > replayReturn, "operação nova ainda valida anexo vinculado");
  assert.equal((sql.match(/ANEXO_EXISTENTE_JA_VINCULADO/g) || []).length, 1);
});

test("migration rejeita duplicidades antes do DML e aplica limites operacionais", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  for (const marker of ["CLIENT_REF_REPETIDO_OU_INVALIDO", "ID_ANEXO_HISTORICO_REPETIDO", "HASH_ANEXO_REPETIDO_NO_PAYLOAD", "STORAGE_PATH_REPETIDO_NO_PAYLOAD", "ANEXO_REPRESENTADO_POR_ID_E_STORAGE_PATH", "ANEXO_USADO_EM_DOIS_GRUPOS_FINANCEIROS"])
    assert.ok(sql.indexOf(marker) > 0 && sql.indexOf(marker) < sql.indexOf("insert into public.ro_passagem_operacoes_idempotentes"), marker);
  for (const marker of ["LIMITE_ANEXOS_EXCEDIDO", "LIMITE_GRUPOS_EXCEDIDO", "LIMITE_REFERENCIAS_GRUPO_EXCEDIDO", "NOME_ARQUIVO_INVALIDO_OU_ACIMA_DO_LIMITE", "JUSTIFICATIVA_ACIMA_DO_LIMITE", "OBSERVACAO_ACIMA_DO_LIMITE", "LIMITE_JSON_OPERACAO_EXCEDIDO"])
    assert.match(sql, new RegExp(marker));
});

test("auditoria de apoio usa somente IDs não consumidos por grupos financeiros", () => {
  const sql = fs.readFileSync("supabase/migrations/202609240001_passagens_pos_compra_seguras.sql", "utf8");
  assert.match(sql, /array_agg\(v_anexo_ids\[array_position\(v_refs,r\)\][\s\S]*not\(r=any\(v_usadas\)\)[\s\S]*'anexo_ids',to_jsonb\(v_apoio_ids\)/i);
  assert.doesNotMatch(sql, /'documento_pos_compra_sem_custo'[\s\S]{0,400}'anexo_ids',to_jsonb\(v_anexo_ids\)/i);
});
