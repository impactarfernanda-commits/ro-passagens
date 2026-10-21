import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePdfFile, validatePdfSignature } from "./pdfFileValidation.ts";

export const DOCUMENTO_GLOBAL_BUCKET = "ro-documentos-globais";
export const ORIENTACOES_VIAGEM_CHAVE = "orientacoes_viagem";

export type DocumentoGlobal = {
  chave: typeof ORIENTACOES_VIAGEM_CHAVE;
  titulo: string;
  nome_arquivo: string;
  storage_path: string;
  mime_type: string;
  tamanho_bytes: number;
  versao: number;
  atualizado_em: string;
};

type RpcResult<T> = { data: T | null; error: { message?: string } | null };
type StorageError = { message?: string } | null;

let orientacoesCache: Promise<DocumentoGlobal | null> | null = null;

function firstRow(value: unknown): DocumentoGlobal | null {
  if (Array.isArray(value)) return (value[0] as DocumentoGlobal | undefined) || null;
  return (value as DocumentoGlobal | null) || null;
}

export function clearDocumentoGlobalCache() {
  orientacoesCache = null;
}

export function obterOrientacoesViagem(client: SupabaseClient, force = false) {
  if (!force && orientacoesCache) return orientacoesCache;
  orientacoesCache = Promise.resolve(client.rpc("ro_obter_documento_global", {
    p_chave: ORIENTACOES_VIAGEM_CHAVE,
  })).then(({ data, error }) => {
    if (error) throw new Error(error.message || "Não foi possível consultar as orientações.");
    return firstRow(data);
  }).catch((error) => {
    orientacoesCache = null;
    throw error;
  });
  return orientacoesCache;
}

export async function criarUrlOrientacoes(client: SupabaseClient, documento: DocumentoGlobal) {
  const { data, error } = await client.storage
    .from(DOCUMENTO_GLOBAL_BUCKET)
    .createSignedUrl(documento.storage_path, 300, { download: documento.nome_arquivo });
  if (error || !data?.signedUrl) throw new Error("Não foi possível gerar o download das orientações.");
  return data.signedUrl;
}

export type PublicarDocumentoDeps = {
  upload: (path: string, file: File) => Promise<StorageError>;
  register: (path: string, fileName: string) => Promise<RpcResult<unknown>>;
  remove: (paths: string[]) => Promise<StorageError>;
  uuid?: () => string;
};

export type PublicarDocumentoResultado = {
  documento: DocumentoGlobal;
  aviso: string | null;
};

export async function publicarOrientacoesViagem(
  file: File,
  anterior: DocumentoGlobal | null,
  deps: PublicarDocumentoDeps,
): Promise<PublicarDocumentoResultado> {
  const validation = validatePdfFile(file) || await validatePdfSignature(file);
  if (validation) throw new Error(validation);
  const uuid = deps.uuid ? deps.uuid() : crypto.randomUUID();
  const path = `orientacoes-viagem/${uuid}.pdf`;
  const uploadError = await deps.upload(path, file);
  if (uploadError) throw new Error("Não foi possível enviar o PDF. O documento vigente foi preservado.");

  let registered: RpcResult<unknown>;
  try {
    registered = await deps.register(path, file.name);
  } catch (error) {
    await deps.remove([path]);
    throw error;
  }
  if (registered.error) {
    await deps.remove([path]);
    throw new Error(registered.error.message || "Não foi possível ativar o documento. O documento vigente foi preservado.");
  }

  const payload = Array.isArray(registered.data) ? registered.data[0] : registered.data;
  const result = payload as (DocumentoGlobal & { storage_path_anterior?: string | null }) | null;
  if (!result?.storage_path) {
    await deps.remove([path]);
    throw new Error("A atualização não retornou o documento ativo. O documento vigente foi preservado.");
  }

  const oldPath = result.storage_path_anterior || anterior?.storage_path || null;
  let aviso: string | null = null;
  if (oldPath && oldPath !== path) {
    const removeError = await deps.remove([oldPath]);
    if (removeError) aviso = "A nova versão está ativa, mas o arquivo anterior não pôde ser removido do armazenamento.";
  }
  clearDocumentoGlobalCache();
  const documento: DocumentoGlobal = {
    chave: result.chave,
    titulo: result.titulo,
    nome_arquivo: result.nome_arquivo,
    storage_path: result.storage_path,
    mime_type: result.mime_type,
    tamanho_bytes: result.tamanho_bytes,
    versao: result.versao,
    atualizado_em: result.atualizado_em,
  };
  return { documento, aviso };
}
