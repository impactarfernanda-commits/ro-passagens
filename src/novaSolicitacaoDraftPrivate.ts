export const NOVA_SOLICITACAO_PRIVATE_DB = "ro-nova-solicitacao-drafts";
const STORE = "draft-private";
const DB_VERSION = 1;

export type DraftPrivateRecord = {
  ref: string;
  userId: string;
  pix?: string;
  documento?: Blob;
  updatedAt: string;
};

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(NOVA_SOLICITACAO_PRIVATE_DB, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "ref" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try { return await requestResult(run(db.transaction(STORE, mode).objectStore(STORE))); }
  finally { db.close(); }
}

export async function readDraftPrivate(ref: string, userId: string) {
  const record = await withStore<DraftPrivateRecord | undefined>("readonly", (store) => store.get(ref));
  return record?.userId === userId ? record : null;
}

async function patchDraftPrivate(ref: string, userId: string, patch: Partial<Pick<DraftPrivateRecord, "pix" | "documento">>) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const get = store.get(ref);
      get.onsuccess = () => {
        const found = get.result as DraftPrivateRecord | undefined;
        const current = found?.userId === userId ? found : undefined;
        store.put({ ...current, ref, userId, ...patch, updatedAt: new Date().toISOString() });
      };
      get.onerror = () => reject(get.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export const saveDraftPix = (ref: string, userId: string, pix: string) => patchDraftPrivate(ref, userId, { pix });
export const saveDraftDocument = (ref: string, userId: string, documento: Blob) => patchDraftPrivate(ref, userId, { documento });

export async function removeDraftDocument(ref: string, userId: string) {
  const current = await readDraftPrivate(ref, userId);
  if (!current) return;
  delete current.documento;
  current.updatedAt = new Date().toISOString();
  await withStore("readwrite", (store) => store.put(current));
}

export async function deleteDraftPrivate(ref: string) {
  await withStore("readwrite", (store) => store.delete(ref));
}

export async function cleanupExpiredDraftPrivate(maxAgeMs: number, now = Date.now()) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const request = transaction.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const updatedAt = Date.parse((cursor.value as DraftPrivateRecord).updatedAt);
        if (!Number.isFinite(updatedAt) || now - updatedAt > maxAgeMs) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
