import assert from "node:assert/strict";
import test from "node:test";
import { createCacheInvalidationChannel, type CacheInvalidationMessage } from "../src/cacheInvalidationChannel.ts";
import { createScopedCache } from "../src/scopedCache.ts";
import { subscribeVisible, type VisibilityTarget } from "../src/visibilityRevalidation.ts";

class FakeChannel {
  static groups = new Map<string, Set<FakeChannel>>();
  onmessage: ((event: MessageEvent<CacheInvalidationMessage>) => void) | null = null;
  private name: string;
  constructor(name: string) {
    this.name = name;
    const group = FakeChannel.groups.get(name) || new Set<FakeChannel>();
    group.add(this); FakeChannel.groups.set(name, group);
  }
  postMessage(message: CacheInvalidationMessage) {
    for (const peer of FakeChannel.groups.get(this.name) || []) {
      if (peer !== this) peer.onmessage?.({ data: message } as MessageEvent<CacheInvalidationMessage>);
    }
  }
  close() { FakeChannel.groups.get(this.name)?.delete(this); }
}

class FakeVisibility implements VisibilityTarget {
  visibilityState: DocumentVisibilityState = "hidden";
  private listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: "visibilitychange", listener: () => void) { this.listeners.delete(listener); }
  emit(state: DocumentVisibilityState) { this.visibilityState = state; this.listeners.forEach((listener) => listener()); }
}

test("BroadcastChannel comunica invalidação entre abas sem eco local", () => {
  const receivedA: Array<string | undefined> = [];
  const receivedB: Array<string | undefined> = [];
  const factory = (name: string) => new FakeChannel(name);
  const tabA = createCacheInvalidationChannel("catalogs-test", (scope) => receivedA.push(scope), factory);
  const tabB = createCacheInvalidationChannel("catalogs-test", (scope) => receivedB.push(scope), factory);
  tabA.publish("user-a");
  assert.deepEqual(receivedA, []);
  assert.deepEqual(receivedB, ["user-a"]);
  tabA.close(); tabB.close();
});

test("indisponibilidade de BroadcastChannel preserva o cache local", () => {
  const channel = createCacheInvalidationChannel("unavailable", () => assert.fail(), () => { throw new Error("unsupported"); });
  assert.equal(channel.supported, false);
  assert.doesNotThrow(() => channel.publish("user-a"));
});

test("retorno à aba revalida somente após o TTL", async () => {
  let now = 0; let requests = 0;
  const cache = createScopedCache<number>({ maxAgeMs: 100, now: () => now });
  const visibility = new FakeVisibility();
  const revalidate = () => { void cache.get("user-a", async () => ++requests); };
  const unsubscribe = subscribeVisible(visibility, revalidate);
  await cache.get("user-a", async () => ++requests);
  visibility.emit("visible");
  await Promise.resolve();
  assert.equal(requests, 1);
  now = 100;
  visibility.emit("hidden");
  assert.equal(requests, 1);
  visibility.emit("visible");
  await Promise.resolve();
  assert.equal(requests, 2);
  unsubscribe();
});
