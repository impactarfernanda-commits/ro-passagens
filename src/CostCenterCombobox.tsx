import { useEffect, useMemo, useRef, useState } from "react";
import { formatCentroCustoLabel } from "./lib";
import type { Obra } from "./types";
import { filterCostCenters } from "./costCenterSearch";

export function CostCenterCombobox({ options, value, onChange, required, placeholder = "Digite código ou nome" }: {
  options: Obra[]; value: string; onChange: (id: string) => void; required?: boolean; placeholder?: string;
}) {
  const selected = options.find((option) => option.id === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => filterCostCenters(options, query), [options, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const choose = (option: Obra) => { onChange(option.id); setQuery(""); setOpen(false); };
  return <div className="cost-center-combobox" ref={root}>
    <input role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="cost-center-options"
      aria-activedescendant={open && filtered[active] ? `cost-center-${filtered[active].id}` : undefined}
      required={required} value={open ? query : selected ? formatCentroCustoLabel(selected) : ""} placeholder={placeholder}
      onFocus={() => { setQuery(""); setOpen(true); }}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); if (value) onChange(""); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, filtered.length - 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
        if (event.key === "Enter" && open && filtered[active]) { event.preventDefault(); choose(filtered[active]); }
        if (event.key === "Escape") { event.preventDefault(); setQuery(""); setOpen(false); }
      }}/>
    {open && <div id="cost-center-options" className="cost-center-options" role="listbox">
      {filtered.length ? filtered.map((option, index) => <button type="button" role="option" aria-selected={option.id === value}
        id={`cost-center-${option.id}`} className={index === active ? "active" : ""} key={option.id}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>
        {formatCentroCustoLabel(option)}
      </button>) : <div className="cost-center-empty">Nenhum centro de custo encontrado.</div>}
    </div>}
  </div>;
}
