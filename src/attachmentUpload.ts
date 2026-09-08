import type { SupabaseClient } from "@supabase/supabase-js";
import type { Solicitacao } from "./types";
import { validatePdfFile } from "./pdfFileValidation";

export function canAddAttachment(canOperateRO: boolean, row: Pick<Solicitacao, "status" | "excluida_em" | "aprovacao_status" | "folga_antecipacao_status">) {
  return canOperateRO && !row.excluida_em
    && ["passagem_comprada", "finalizada"].includes(row.status)
    && !["pendente", "reprovada"].includes(row.aprovacao_status || "")
    && row.folga_antecipacao_status !== "pendente";
}

// Each file is independent: a failed upload never removes previously linked PDFs.
export async function appendAttachment(client: SupabaseClient, solicitacaoId: string, userId: string, file: File) {
  const validation = validatePdfFile(file);
  if (validation) throw new Error(`${file.name}: ${validation}`);
  const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${solicitacaoId}/${crypto.randomUUID()}-${safeName}`;
  const storage = client.storage.from("ro-passagem-anexos");
  const upload = await storage.upload(path, file, { contentType: "application/pdf", upsert: false });
  if (upload.error) throw new Error(`Não foi possível enviar ${file.name}. Tente novamente.`);
  const attachment = await client.from("ro_passagem_anexos").insert({
    solicitacao_id: solicitacaoId, tipo: "passagem_pdf", nome_arquivo: file.name,
    storage_path: path, mime_type: "application/pdf", tamanho_bytes: file.size,
    uploaded_by: userId, criado_por: userId,
  });
  if (attachment.error) {
    const cleanup = await storage.remove([path]);
    throw new Error(`Não foi possível vincular ${file.name} à solicitação.${cleanup.error ? " O arquivo enviado não pôde ser limpo do armazenamento; informe a equipe de suporte." : " Tente novamente."}`);
  }
}
