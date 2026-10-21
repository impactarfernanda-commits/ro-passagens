import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileText, Upload } from "lucide-react";
import { dataHora } from "./lib";
import { supabase } from "./supabase";
import {
  criarUrlOrientacoes,
  DOCUMENTO_GLOBAL_BUCKET,
  obterOrientacoesViagem,
  publicarOrientacoesViagem,
  type DocumentoGlobal,
} from "./documentoGlobal";

export function OrientacoesViagemConfig() {
  const [documento, setDocumento] = useState<DocumentoGlobal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const carregar = useCallback(async (force = false) => {
    try {
      setDocumento(await obterOrientacoesViagem(supabase, force));
      setErro("");
    } catch {
      setErro("Não foi possível consultar o documento de orientações.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function abrir() {
    if (!documento) return;
    try {
      window.open(await criarUrlOrientacoes(supabase, documento), "_blank", "noopener,noreferrer");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível abrir o PDF.");
    }
  }

  async function selecionar(file?: File) {
    if (!file || busy) return;
    setBusy(true); setErro(""); setMensagem("");
    const storage = supabase.storage.from(DOCUMENTO_GLOBAL_BUCKET);
    try {
      const result = await publicarOrientacoesViagem(file, documento, {
        upload: async (path, pdf) => (await storage.upload(path, pdf, { contentType: "application/pdf", upsert: false })).error,
        register: async (path, fileName) => supabase.rpc("ro_registrar_documento_global", {
          p_chave: "orientacoes_viagem", p_storage_path: path, p_nome_arquivo: fileName,
        }),
        remove: async (paths) => (await storage.remove(paths)).error,
      });
      setDocumento(result.documento);
      setMensagem(result.aviso || "Documento de orientações atualizado com sucesso.");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível atualizar o documento.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="card global-document-config">
    <div className="attachment-title"><FileText/><div><h2>Orientações de viagem</h2><p>Este documento fica disponível automaticamente nas solicitações com passagem comprada. Substitua o arquivo aqui sempre que houver uma nova versão.</p></div></div>
    {erro && <div className="error">{erro}</div>}
    {mensagem && <div className={mensagem.startsWith("A nova versão") ? "pdf-message warning" : "pdf-message success"}>{mensagem}</div>}
    {loading ? <p className="attachment-empty">Carregando...</p> : documento ? <div className="global-document-current">
      <div><strong>{documento.nome_arquivo}</strong><small>Versão {documento.versao} · última atualização em {dataHora(documento.atualizado_em)}</small></div>
      <button type="button" className="btn secondary" onClick={() => void abrir()}><ExternalLink size={16}/>Abrir PDF</button>
    </div> : <p className="attachment-empty">Nenhum documento de orientação cadastrado.</p>}
    <label className={`pdf-picker global-document-picker${busy ? " disabled" : ""}`}><Upload size={18}/><strong>{busy ? "Enviando..." : documento ? "Substituir documento" : "Cadastrar documento"}</strong><input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void selecionar(file); }}/></label>
    <small className="global-document-limit">Somente PDF, com no máximo 10 MB.</small>
  </div>;
}
