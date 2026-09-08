import { useRef, useState } from "react";
import { supabase } from "./supabase";
import { appendAttachment } from "./attachmentUpload";

export function AdicionarAnexo({ solicitacaoId, onDone }: { solicitacaoId: string; onDone: () => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function enviar(files: File[]) {
    if (uploading.current || !files.length) return;
    uploading.current = true;
    setBusy(true);
    setMessage("");
    let added = 0;
    const errors: string[] = [];
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw new Error("Sessão expirada. Entre novamente.");
      for (const file of files) {
        try {
          await appendAttachment(supabase, solicitacaoId, data.user.id, file);
          added++;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `Falha ao enviar ${file.name}.`);
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Não foi possível enviar os anexos.");
    } finally {
      setMessage([added ? `${added} anexo(s) adicionado(s).` : "", ...errors].filter(Boolean).join(" "));
      setBusy(false);
      uploading.current = false;
      if (added) onDone();
    }
  }
  return <div>
    <button type="button" className="btn secondary" disabled={busy} onClick={() => picker.current?.click()}>
      {busy ? "Enviando anexos..." : "Adicionar anexo"}
    </button>
    <input ref={picker} type="file" hidden accept="application/pdf,.pdf" multiple disabled={busy}
      onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; void enviar(files); }} />
    <p>PDF de até 10 MB por arquivo. Você pode selecionar vários documentos.</p>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
