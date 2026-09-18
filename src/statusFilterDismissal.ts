type StatusDetails = Pick<HTMLDetailsElement, "open" | "contains">;
type DismissalDocument = Pick<Document, "addEventListener" | "removeEventListener">;

export function attachStatusFilterDismissal(details: StatusDetails, doc: DismissalDocument = document) {
  const closeOnOutsidePointer = (event: PointerEvent) => {
    if (details.open && !details.contains(event.target as Node)) details.open = false;
  };
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && details.open) details.open = false;
  };
  doc.addEventListener("pointerdown", closeOnOutsidePointer);
  doc.addEventListener("keydown", closeOnEscape);
  return () => {
    doc.removeEventListener("pointerdown", closeOnOutsidePointer);
    doc.removeEventListener("keydown", closeOnEscape);
  };
}
