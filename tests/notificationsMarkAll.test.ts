import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const components = fs.readFileSync("src/components.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610010002_marcar_todas_notificacoes_lidas.sql", "utf8");
const previousMigration = fs.readFileSync("supabase/migrations/202610010001_notificacoes_usuario.sql", "utf8");

type Notification = { id: string; kind: "requester" | "ro"; recipient?: string };
function visible(notification: Notification, userId: string, activeRO: Set<string>) {
  return notification.kind === "requester"
    ? notification.recipient === userId
    : activeRO.has(userId);
}
function markAll(notifications: Notification[], reads: Set<string>, userId: string, activeRO: Set<string>) {
  let inserted = 0;
  for (const notification of notifications) {
    if (visible(notification, userId, activeRO) && !reads.has(`${notification.id}:${userId}`)) {
      reads.add(`${notification.id}:${userId}`);
      inserted += 1;
    }
  }
  return inserted;
}

test("usuário com dez não lidas marca dez e zera seu contador", () => {
  const notifications = Array.from({ length: 10 }, (_, index) => ({ id: String(index), kind: "requester" as const, recipient: "a" }));
  const reads = new Set<string>();
  assert.equal(markAll(notifications, reads, "a", new Set()), 10);
  assert.equal(notifications.filter((item) => visible(item, "a", new Set()) && !reads.has(`${item.id}:a`)).length, 0);
});

test("botão aparece somente quando há não lidas", () => {
  assert.match(components, /\{unread > 0 && <div className="notification-head-actions">/);
});

test("RPC marca somente notificações visíveis", () => {
  assert.match(migration, /n\.canal='interno'[\s\S]*?n\.destinatario_tipo='solicitante'[\s\S]*?n\.destinatario=v_user_id::text/);
  assert.match(migration, /n\.destinatario_tipo='ro'[\s\S]*?n\.destinatario is null[\s\S]*?r\.user_id=v_user_id and r\.ativo/);
});

test("notificações de outro solicitante não são afetadas", () => {
  const notifications: Notification[] = [{ id: "a", kind: "requester", recipient: "a" }, { id: "b", kind: "requester", recipient: "b" }];
  const reads = new Set<string>();
  markAll(notifications, reads, "a", new Set());
  assert.deepEqual([...reads], ["a:a"]);
});

test("notificação coletiva RO mantém leitura individual entre operadores", () => {
  const notifications: Notification[] = [{ id: "n", kind: "ro" }];
  const reads = new Set<string>();
  const activeRO = new Set(["a", "b"]);
  markAll(notifications, reads, "a", activeRO);
  assert.equal(reads.has("n:a"), true);
  assert.equal(reads.has("n:b"), false);
  assert.equal(visible(notifications[0], "b", activeRO), true);
});

test("RO inativo não usa o acesso coletivo", () => {
  assert.equal(markAll([{ id: "n", kind: "ro" }], new Set(), "inativo", new Set(["ativo"])), 0);
});

test("usuário comum não marca notificações RO", () => {
  assert.equal(markAll([{ id: "n", kind: "ro" }], new Set(), "comum", new Set()), 0);
});

test("RPC sem auth.uid é bloqueada e não aceita user_id", () => {
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /if v_user_id is null then[\s\S]*?AUTENTICACAO_OBRIGATORIA/);
  assert.match(migration, /ro_marcar_todas_notificacoes_lidas\(\)/);
  assert.doesNotMatch(migration, /p_user_id|p_destinatario/);
});

test("segunda execução é idempotente", () => {
  const notifications: Notification[] = [{ id: "n", kind: "requester", recipient: "a" }];
  const reads = new Set<string>();
  assert.equal(markAll(notifications, reads, "a", new Set()), 1);
  assert.equal(markAll(notifications, reads, "a", new Set()), 0);
  assert.match(migration, /on conflict\(notificacao_id,user_id\) do nothing/);
});

test("marcação individual existente permanece intacta", () => {
  assert.match(previousMigration, /ro_marcar_notificacao_lida\(p_notificacao_id uuid\)/);
  assert.doesNotMatch(migration, /create or replace function public\.ro_marcar_notificacao_lida\(/);
  assert.match(components, /ro_marcar_notificacao_lida/);
});

test("sucesso mantém dropdown aberto e atualiza somente o estado local", () => {
  const markAllBody = components.slice(components.indexOf("async function markAllAsRead"), components.indexOf("async function openNotification"));
  assert.doesNotMatch(markAllBody, /setOpen\(false\)/);
  assert.match(markAllBody, /setItems\([\s\S]*?lida_em: readAt/);
});

test("falha preserva contador e permite nova tentativa", () => {
  const markAllBody = components.slice(components.indexOf("async function markAllAsRead"), components.indexOf("async function openNotification"));
  assert.match(markAllBody, /if \(markError\)[\s\S]*?setMarkAllError/);
  assert.match(markAllBody, /else \{[\s\S]*?setItems/);
  assert.match(markAllBody, /markingAllRef\.current = false[\s\S]*?setMarkingAll\(false\)/);
});
