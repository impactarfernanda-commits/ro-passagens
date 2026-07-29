import type { Notificacao } from "./types";

const DUPLICATE_WINDOW_MS = 60_000;

export function deduplicateNotifications(
  notifications: Notificacao[],
): Notificacao[] {
  const oldestFirst = [...notifications].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const firstByEvent = new Map<string, number>();

  return oldestFirst.filter((notification) => {
    const recipient =
      notification.canal === "interno" &&
      notification.destinatario_tipo === "ro"
        ? ""
        : notification.destinatario || "";
    const eventKey = [
      notification.canal,
      notification.destinatario_tipo,
      recipient,
      notification.mensagem,
      notification.status,
    ].join("\u0000");
    const createdAt = new Date(notification.created_at).getTime();
    const firstCreatedAt = firstByEvent.get(eventKey);

    if (
      firstCreatedAt !== undefined &&
      Math.abs(createdAt - firstCreatedAt) <= DUPLICATE_WINDOW_MS
    ) {
      return false;
    }

    firstByEvent.set(eventKey, createdAt);
    return true;
  });
}
