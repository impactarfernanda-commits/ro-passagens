import { useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";
import { validatePdfFile } from "./pdfFileValidation";
import { extractTicketDataFromPdf } from "./pdfPassagem";
import { buildPostPurchasePayload, canonicalizePostPurchasePayload, POST_PURCHASE_COST_CENTER_REQUIRED, postPurchaseCostCenters, postPurchaseErrorMessage, postPurchaseGroups, registerPostPurchaseOperation, sha256Hex, type PostPurchaseDecision, type PostPurchaseDocument } from "./postPurchasePassage";
import { isValidFinancialPassageIdentity } from "./passagemGrouping";
import type { Anexo, Custo, Obra, Solicitacao } from "./types";

const operationStorageKey = (solicitacaoId: string) => `ro:pos-compra:${solicitacaoId}`;

export function AdicionarAnexo({ solicitacaoId, solicitacao, obras, anexos, custos, onDone }: {
  solicitacaoId: string;
  solicitacao: Pick<Solicitacao, "obra_id" | "centro_custo_destino_id" | "centro_custo_retorno_id">;
  obras: Obra[]; anexos: Anexo[]; custos: Custo[]; onDone: () => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [documents, setDocuments] = useState<PostPurchaseDocument[]>([]);
  const [decisions, setDecisions] = useState<Record<string, PostPurchaseDecision>>({});
  const [message, setMessage] = useState("");
  const groups = useMemo(() => postPurchaseGroups(documents), [documents]);
  const eligibleCostCenters = useMemo(() => postPurchaseCostCenters(solicitacao, obras), [solicitacao, obras]);
  const missingCostCenter = groups.some((group) => {
    const decision = decisions[group.key];
    return decision?.action === "new" && !decision.centro_custo_id;
  });
  const missingAction = groups.some((group) => !decisions[group.key]?.action);
  const missingExistingCost = groups.some((group) => decisions[group.key]?.action === "link" && !decisions[group.key]?.existingCostId);

  function initializeDecisions(next: PostPurchaseDocument[]) {
    setDecisions((current) => Object.fromEntries(postPurchaseGroups(next).map((group) => {
      return [group.key, current[group.key] || {
        value: group.value,
        manual: group.needsReview, justification: "",
      }];
    })));
  }

  async function parseFile(file: File, extra: Partial<PostPurchaseDocument> = {}): Promise<PostPurchaseDocument> {
    const [extracted, sha256] = await Promise.all([extractTicketDataFromPdf(file), sha256Hex(file)]);
    return {
      ref: crypto.randomUUID(), id: crypto.randomUUID(), file, nome_arquivo: file.name,
      valor: extracted.valor_passagem || "", partida_em: extracted.partida_em,
      passageiro: extracted.passageiro, documento: extracted.documento,
      origem: extracted.origem, destino: extracted.destino, poltrona: extracted.poltrona,
      localizador: extracted.localizador, numero_bilhete: extracted.numero_bilhete,
      identificadores_texto: extracted.identificadores_texto,
      tipo_documento: extracted.tipo_documento,
      valores_financeiros_divergentes: extracted.valores_financeiros_divergentes,
      valor_confirmado_manualmente: false, sha256, mimeType: "application/pdf",
      size: file.size, ...extra,
    };
  }

  async function loadHistorical() {
    const parsed: PostPurchaseDocument[] = [];
    for (const attachment of anexos.filter((item) => !item.custo_id && item.tipo === "passagem_pdf")) {
      const download = await supabase.storage.from("ro-passagem-anexos").download(attachment.storage_path);
      if (download.error || !download.data) continue;
      const file = new File([download.data], attachment.nome_arquivo, { type: "application/pdf" });
      parsed.push(await parseFile(file, {
        ref: `existing:${attachment.id}`, existingAttachmentId: attachment.id,
        storagePath: attachment.storage_path, historicalOnly: true,
        sourceExisting: true,
        observacao: attachment.observacao || undefined,
      }));
    }
    return parsed;
  }

  async function select(files: File[]) {
    setBusy(true); setMessage("");
    try {
      for (const file of files) {
        const error = validatePdfFile(file);
        if (error) throw new Error(`${file.name}: ${error}`);
      }
      const historical = documents.some((document) => document.historicalOnly) ? [] : await loadHistorical();
      const parsed = await Promise.all(files.map((file) => parseFile(file)));
      const next = [...documents, ...historical, ...parsed];
      setDocuments(next); initializeDecisions(next); setOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível analisar os PDFs.");
    } finally { setBusy(false); }
  }

  async function reviewExisting() {
    setBusy(true); setMessage("");
    try {
      const existing = (await loadHistorical()).map((document) => ({ ...document, historicalOnly: false }));
      if (!existing.length) throw new Error("Não há anexos existentes pendentes de revisão.");
      setDocuments(existing); initializeDecisions(existing); setOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível analisar os anexos existentes.");
    } finally { setBusy(false); }
  }

  function changeDecision(key: string, patch: Partial<PostPurchaseDecision>) {
    setDecisions((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  async function save() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const payload = buildPostPurchasePayload(documents, decisions, custos);
      const fingerprint = await sha256Hex(new Blob([JSON.stringify(canonicalizePostPurchasePayload(payload))]));
      const savedOperation = JSON.parse(localStorage.getItem(operationStorageKey(solicitacaoId)) || "null") as { fingerprint?: string; operationId?: string } | null;
      const operationId = savedOperation?.fingerprint === fingerprint && savedOperation.operationId
        ? savedOperation.operationId : crypto.randomUUID();
      localStorage.setItem(operationStorageKey(solicitacaoId), JSON.stringify({ fingerprint, operationId }));
      await registerPostPurchaseOperation({
        requestId: solicitacaoId, operationId, attachments: payload.attachments, documents,
        upload: async (path, file) => (await supabase.storage.from("ro-passagem-anexos").upload(path, file, { contentType: "application/pdf", upsert: false })).error,
        remove: async (paths) => { await supabase.storage.from("ro-passagem-anexos").remove(paths); },
        register: async (attachments) => await supabase.rpc("ro_registrar_documentos_pos_compra", {
          p_solicitacao_id: solicitacaoId, p_operacao_id: operationId,
          p_anexos: attachments, p_grupos: payload.groups,
        }),
      });
      localStorage.removeItem(operationStorageKey(solicitacaoId));
      setDocuments([]); setDecisions({}); setOpen(false);
      setMessage("Documentos pós-compra registrados com segurança."); onDone();
    } catch (error) {
      setMessage(error instanceof Error ? postPurchaseErrorMessage(error.message) : "Não foi possível registrar os documentos.");
    } finally { setBusy(false); }
  }

  return <div className="post-purchase-attachments">
    <button type="button" className="btn secondary" disabled={busy} onClick={() => picker.current?.click()}>
      {busy ? "Analisando anexos..." : "Adicionar anexo"}
    </button>
    <input ref={picker} type="file" hidden accept="application/pdf,.pdf" multiple disabled={busy}
      onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; void select(files); }} />
    {anexos.some((attachment) => !attachment.custo_id && attachment.tipo === "passagem_pdf") &&
      <button type="button" className="btn secondary" disabled={busy} onClick={() => void reviewExisting()}>Revisar anexos já enviados</button>}
    <p>PDF de até 10 MB. O custo só será registrado depois da revisão.</p>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {open && <section className="card post-purchase-review">
      <h3>Revisar documentos pós-compra</h3>
      {groups.filter((group) => group.documents.some((document) => !document.historicalOnly)).map((group) => {
        const decision = decisions[group.key];
        const validFinancialIdentity = isValidFinancialPassageIdentity(group.key);
        const passageCosts = custos.filter((cost) => cost.tipo === "passagem");
        const sameKey = passageCosts.find((cost) => cost.compra_chave === group.key);
        const sameValue = passageCosts.filter((cost) => Math.abs(Number(cost.valor) - group.value) < 0.005);
        return <article key={group.key} className="pdf-review-card">
          <strong>{group.consolidatedLocator ? `Localizador ${group.consolidatedLocator}` : "Passagem reconhecida"}</strong>
          <span>{group.consolidatedOrigin || "Origem não identificada"} → {group.consolidatedDestination || "Destino não identificado"}</span>
          <small>{group.consolidatedDeparture || "Data não identificada"} · {group.documents.map((document) => document.nome_arquivo).join(", ")}</small>
          <small>Dados reconhecidos: {Array.from(new Set(group.documents.flatMap((document) => [document.passageiro, document.documento].filter(Boolean)))).join(" · ") || "nome/documento não identificados"} · Valor {group.value > 0 ? group.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "não identificado"}</small>
          <span>Ação:</span>
          <label><input type="radio" name={`kind-${group.key}`} disabled={!validFinancialIdentity} checked={decision?.action === "link"}
            onChange={() => changeDecision(group.key, { action: "link", existingCostId: undefined, centro_custo_id: undefined, manual: true })} /> Vincular a passagem existente</label>
          <label><input type="radio" name={`kind-${group.key}`} disabled={!validFinancialIdentity || Boolean(sameKey)} checked={decision?.action === "new"}
            onChange={() => changeDecision(group.key, { action: "new", existingCostId: undefined, centro_custo_id: undefined, value: group.value })} /> Nova passagem com custo</label>
          {!validFinancialIdentity && <small role="alert">Não foi possível identificar esta passagem com segurança. Revise os dados ou mantenha o documento como apoio sem custo.</small>}
          <label><input type="radio" name={`kind-${group.key}`} checked={decision?.action === "support"}
            onChange={() => changeDecision(group.key, { action: "support", existingCostId: undefined, centro_custo_id: undefined })} /> Documento de apoio / sem custo</label>
          {sameKey && <small role="alert">Já existe uma passagem com esta compra_chave. Vincule os anexos ao custo existente.</small>}
          {!sameKey && sameValue.length > 0 && <small role="alert">Possível duplicidade: há {sameValue.length} custo(s) de passagem com o mesmo valor. Confira os demais sinais antes de decidir.</small>}
          {decision?.action === "link" && <>
            <label>Passagem existente *<select required value={decision.existingCostId || ""}
              onChange={(event) => { const selected = custos.find((cost) => cost.id === event.target.value); changeDecision(group.key, { existingCostId: event.target.value || undefined, value: Number(selected?.valor || group.value), manual: true }); }}>
              <option value="">Selecione explicitamente</option>
              {passageCosts.map((cost) => <option key={cost.id} value={cost.id}>{cost.descricao || "Passagem"} — {Number(cost.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}{cost.compra_chave ? ` — ${cost.compra_chave}` : ""}</option>)}
            </select></label>
            <label>Justificativa da associação *<textarea value={decision.justification}
              onChange={(event) => changeDecision(group.key, { justification: event.target.value })} /></label>
            <small>Os anexos existentes serão vinculados sem reupload e sem alterar o valor do custo selecionado.</small>
          </>}
          {decision?.action === "new" && <>
            <label>Centro de custo *<select required value={decision.centro_custo_id || ""}
              onChange={(event) => changeDecision(group.key, { centro_custo_id: event.target.value || undefined })}>
              <option value="">Selecione o centro de custo</option>
              {eligibleCostCenters.map((costCenter) => <option key={costCenter.id} value={costCenter.id}>
                {[costCenter.codigo, costCenter.nome || costCenter.descricao].filter(Boolean).join(" — ")}
              </option>)}
            </select>{!decision.centro_custo_id && <small role="alert">{POST_PURCHASE_COST_CENTER_REQUIRED}</small>}</label>
            <label>Valor confirmado (R$)<input type="number" min="0.01" step="0.01" value={decision.value || ""}
              onChange={(event) => changeDecision(group.key, { value: Number(event.target.value), manual: Number(event.target.value) !== group.value })} /></label>
            {(decision.manual || group.needsReview) && <label>Justificativa da revisão<textarea value={decision.justification}
              onChange={(event) => changeDecision(group.key, { justification: event.target.value })} /></label>}
            <small>Valor extraído: {group.value > 0 ? group.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "não encontrado"}. Um único custo será criado para este grupo.</small>
          </>}
        </article>;
      })}
      <div className="actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => { setOpen(false); setDocuments([]); setDecisions({}); }}>Cancelar</button>
        <button type="button" className="btn primary" disabled={busy || missingAction || missingCostCenter || missingExistingCost} onClick={() => void save()}>{busy ? "Salvando..." : "Salvar após revisão"}</button>
      </div>
    </section>}
  </div>;
}
