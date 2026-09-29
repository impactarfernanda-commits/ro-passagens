import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { approvalBadgePresentation } from "../src/approvalVisibility.ts";

const styles = fs.readFileSync("src/styles.css", "utf8");

test("recusa operacional RO sempre usa o badge laranja, independentemente da aprovação anterior", () => {
  for (const approvalStatus of ["aprovada", "pendente", "dispensada", undefined] as const) {
    assert.deepEqual(approvalBadgePresentation("recusada", approvalStatus), {
      className: "approval-recusada-ro",
      label: "Interrompida por recusa RO",
    });
  }
  assert.match(styles, /\.badge\.approval-recusada-ro\{background:#fdeedc;color:#b45309\}/);
});

test("reprovação pelo aprovador permanece vermelha", () => {
  assert.deepEqual(approvalBadgePresentation("recusada", "reprovada"), {
    className: "approval-reprovada",
    label: "Reprovada pelo aprovador",
  });
  assert.match(styles, /\.badge\.approval-reprovada\{background:#faeaea;color:#a34040\}/);
});

test("aprovação normal permanece verde", () => {
  assert.deepEqual(approvalBadgePresentation("solicitada", "aprovada"), {
    className: "approval-aprovada",
    label: "Aprovada",
  });
  assert.match(styles, /\.badge\.approval-aprovada\{background:#e4f6ed;color:#347f5d\}/);
});

test("aprovação pendente permanece âmbar", () => {
  assert.deepEqual(approvalBadgePresentation("solicitada", "pendente"), {
    className: "approval-pendente",
    label: "Aguardando aprovação",
  });
  assert.match(styles, /\.badge\.approval-pendente\{background:#fff1da;color:#875f0d\}/);
});

test("status RECUSADA continua usando somente o badge neutro de status", () => {
  const page = fs.readFileSync("src/pages.tsx", "utf8");
  assert.match(page, /<StatusBadge status=\{statusLabel\[r\.status\]\} \/>/);
  assert.match(page, /<StatusBadge status=\{statusLabel\[row\.status\]\} \/>/);
});
