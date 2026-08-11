export function normalizeNeighborhoodForDisplay(value:string|null|undefined){
  return String(value??"").replace(/^\s*bairro(?:\s*[:–—-]\s*|\s+)/i,"").trim();
}

export function normalizeStreetForDisplay(value:string|null|undefined){
  const text=String(value??"").trim();
  return text.replace(/^\s*(rua|avenida|travessa|rodovia|estrada)\s+(\1\b.*)$/i,"$2").trim();
}

