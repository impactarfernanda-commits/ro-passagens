import assert from "node:assert/strict";
import test from "node:test";
import { createScopedCache } from "../src/scopedCache.ts";

test("cache reutiliza o resultado ao retornar para uma tela", async () => {
  const cache = createScopedCache<number>();
  let requests = 0;
  const loader = async () => ++requests;
  assert.equal(await cache.get("user-a", loader), 1);
  assert.equal(await cache.get("user-a", loader), 1);
  assert.equal(requests, 1);
});

test("cache deduplica requisições simultâneas", async () => {
  const cache = createScopedCache<string>();
  let resolve!: (value: string) => void;
  let requests = 0;
  const loader = () => { requests += 1; return new Promise<string>((done) => { resolve = done; }); };
  const first = cache.get("user-a", loader);
  const second = cache.get("user-a", loader);
  assert.equal(requests, 1);
  resolve("catálogo");
  assert.deepEqual(await Promise.all([first, second]), ["catálogo", "catálogo"]);
});

test("cache mantém isolamento na troca de usuário", async () => {
  const cache = createScopedCache<string>();
  let requests = 0;
  assert.equal(await cache.get("user-a", async () => { requests += 1; return "A"; }), "A");
  assert.equal(await cache.get("user-b", async () => { requests += 1; return "B"; }), "B");
  assert.equal(await cache.get("user-a", async () => "incorreto"), "A");
  assert.equal(requests, 2);
});

test("logout limpa todos os escopos do cache", async () => {
  const cache = createScopedCache<number>();
  await cache.get("user-a", async () => 1);
  await cache.get("user-b", async () => 2);
  cache.invalidate();
  assert.equal(await cache.get("user-a", async () => 3), 3);
  assert.equal(await cache.get("user-b", async () => 4), 4);
});

test("invalidação após alteração força nova consulta apenas no usuário afetado", async () => {
  const cache = createScopedCache<number>();
  let a = 0; let b = 0;
  await cache.get("user-a", async () => ++a);
  await cache.get("user-b", async () => ++b);
  cache.invalidate("user-a");
  assert.equal(await cache.get("user-a", async () => ++a), 2);
  assert.equal(await cache.get("user-b", async () => ++b), 1);
});

test("falha não fica armazenada e permite nova tentativa", async () => {
  const cache = createScopedCache<string>();
  await assert.rejects(cache.get("user-a", async () => { throw new Error("offline"); }));
  assert.equal(await cache.get("user-a", async () => "recuperado"), "recuperado");
});

test("TTL reutiliza antes do limite e revalida ao expirar", async () => {
  let now = 0;
  let requests = 0;
  const cache = createScopedCache<number>({ maxAgeMs: 300_000, now: () => now });
  const loader = async () => ++requests;
  assert.equal(await cache.get("user-a", loader), 1);
  now = 299_999;
  assert.equal(await cache.get("user-a", loader), 1);
  now = 300_000;
  assert.equal(await cache.get("user-a", loader), 2);
});

test("resposta anterior à invalidação não sobrescreve o valor mais recente", async () => {
  const cache = createScopedCache<string>();
  let resolveOld!: (value: string) => void;
  const oldRequest = cache.get("user-a", () => new Promise<string>((resolve) => { resolveOld = resolve; }));
  cache.invalidate("user-a");
  assert.equal(await cache.get("user-a", async () => "novo"), "novo");
  resolveOld("antigo");
  assert.equal(await oldRequest, "antigo");
  assert.equal(await cache.get("user-a", async () => "incorreto"), "novo");
});
