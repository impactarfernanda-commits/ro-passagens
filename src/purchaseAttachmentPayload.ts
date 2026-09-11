export type PurchaseAttachmentMetadata = {
  nome_arquivo: string;
  storage_path: string;
  mime_type: string;
  tamanho_bytes: number;
  partida_em: string | null;
  valor: number | null;
  observacao: string | null;
};

export function buildPurchaseAttachmentInsert(
  solicitacaoId: string,
  userId: string,
  metadata: PurchaseAttachmentMetadata,
) {
  return {
    solicitacao_id: solicitacaoId,
    tipo: "passagem_pdf" as const,
    ...metadata,
    uploaded_by: userId,
  };
}
