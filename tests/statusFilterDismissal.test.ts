import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { attachStatusFilterDismissal } from "../src/statusFilterDismissal.ts";

function setup() {
  const listeners = new Map<string, (event: { target?: object; key?: string }) => void>();
  const doc = {
    addEventListener(type: string, listener: (event: { target?: object; key?: string }) => void) { listeners.set(type, listener); },
    removeEventListener(type: string, listener: (event: { target?: object; key?: string }) => void) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const checkbox = {};
  const summary = {};
  const details = { open: false, contains: (target: object) => target === checkbox || target === summary };
  const cleanup = attachStatusFilterDismissal(details as never, doc as never);
  const pointer = (target: object) => listeners.get("pointerdown")?.({ target });
  const key = (value: string) => listeners.get("keydown")?.({ key: value });
  return { details, checkbox, summary, listeners, pointer, key, cleanup };
}

test("campo Status usa details nativo para abrir, fechar e reabrir preservando checkboxes", () => {
  const page = fs.readFileSync("src/pages.tsx", "utf8");
  assert.match(page, /<details className="status-filter" ref=\{statusFilterRef\}>/);
  assert.match(page, /<summary>\{resumoStatusSolicitacao\(filters.status\)\}<\/summary>/);
  assert.match(page, /checked=\{filters.status.includes\(value\)\}/);
  assert.match(page, /status: filters.status.includes\(value\)[\s\S]*?\[\.\.\.filters.status, value\]/);
});

test("cliques dentro mantêm menu aberto para múltiplas seleções", () => {
  const { details, checkbox, summary, pointer, cleanup } = setup();
  details.open = true;
  pointer(checkbox);
  pointer(summary);
  pointer(checkbox);
  assert.equal(details.open, true);
  cleanup();
});

test("clique fora, inclusive em outro filtro, fecha sem alterar seleção ou persistência", () => {
  const { details, pointer, cleanup } = setup();
  const selected = ["solicitada", "em_andamento"];
  for (const target of ["motivo", "aprovação", "obra", "busca", "fora"]) {
    details.open = true;
    pointer({ target });
    assert.equal(details.open, false);
    assert.deepEqual(selected, ["solicitada", "em_andamento"]);
  }
  cleanup();
});

test("Escape fecha, outras teclas não fecham e cleanup remove listeners", () => {
  const { details, listeners, key, cleanup } = setup();
  details.open = true;
  key("Enter");
  assert.equal(details.open, true);
  key("Escape");
  assert.equal(details.open, false);
  cleanup();
  assert.equal(listeners.size, 0);
});
