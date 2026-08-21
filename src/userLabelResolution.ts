export type UserLabelRow = { id: string; label: string };
export type UserLabelResolution = { status: "resolved"; label: string } | { status: "missing" } | { status: "error" };

export function resolveUserLabel(userId: string, rows: UserLabelRow[] | null, failed: boolean): UserLabelResolution {
  if (failed) return { status: "error" };
  const label = rows?.find((row) => row.id === userId)?.label.trim();
  return label ? { status: "resolved", label } : { status: "missing" };
}
