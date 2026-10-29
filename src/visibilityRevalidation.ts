export type VisibilityTarget = {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export function subscribeVisible(target: VisibilityTarget, revalidate: () => void) {
  const listener = () => { if (target.visibilityState === "visible") revalidate(); };
  target.addEventListener("visibilitychange", listener);
  return () => target.removeEventListener("visibilitychange", listener);
}
