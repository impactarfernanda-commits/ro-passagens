export type CacheInvalidationMessage = { scope?: string };
type ChannelLike = {
  postMessage(message: CacheInvalidationMessage): void;
  close(): void;
  onmessage: ((event: MessageEvent<CacheInvalidationMessage>) => void) | null;
};
type ChannelFactory = (name: string) => ChannelLike;

function browserChannelFactory(name: string): ChannelLike { return new BroadcastChannel(name); }

export function createCacheInvalidationChannel(name: string, onInvalidate: (scope?: string) => void, factory: ChannelFactory = browserChannelFactory) {
  let channel: ChannelLike | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined" || factory !== browserChannelFactory) {
      channel = factory(name);
      channel.onmessage = (event) => onInvalidate(event.data.scope);
    }
  } catch { channel = null; }
  return {
    publish(scope?: string) { try { channel?.postMessage({ scope }); } catch { /* cache local continua funcional */ } },
    close() { try { channel?.close(); } catch { /* sem ação necessária */ } },
    get supported() { return channel !== null; },
  };
}
