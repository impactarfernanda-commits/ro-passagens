export type ScopedCacheOptions = { maxAgeMs?: number; now?: () => number };
type Entry<T> = { value?: T; loadedAt?: number; pending?: Promise<T> };

export function createScopedCache<T>({ maxAgeMs = Number.POSITIVE_INFINITY, now = Date.now }: ScopedCacheOptions = {}) {
  const entries = new Map<string, Entry<T>>();
  const generations = new Map<string, number>();
  let globalGeneration = 0;
  const generation = (scope: string) => `${globalGeneration}:${generations.get(scope) || 0}`;
  function get(scope: string, loader: () => Promise<T>, force = false): Promise<T> {
    const current = entries.get(scope);
    if (!force && current?.pending) return current.pending;
    if (!force && current?.value !== undefined && current.loadedAt !== undefined && now() - current.loadedAt < maxAgeMs) return Promise.resolve(current.value);
    const startedAt = generation(scope);
    const pending = loader().then((value) => {
      if (generation(scope) !== startedAt) return value;
      entries.set(scope, { value, loadedAt: now() });
      return value;
    }).catch((error) => { if (entries.get(scope)?.pending === pending) entries.delete(scope); throw error; });
    entries.set(scope, { pending });
    return pending;
  }
  function invalidate(scope?: string) {
    if (scope === undefined) { globalGeneration += 1; entries.clear(); }
    else { generations.set(scope, (generations.get(scope) || 0) + 1); entries.delete(scope); }
  }
  return { get, invalidate };
}
