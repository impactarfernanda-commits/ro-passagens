export function normalizeNeighborhoodForDisplay(value:string|null|undefined){
  return String(value??"").replace(/^\s*bairro(?:\s*[:–—-]\s*|\s+)/i,"").trim();
}

export function normalizeStreetForDisplay(value:string|null|undefined){
  const text=String(value??"").trim();
  return text.replace(/^\s*(rua|avenida|travessa|rodovia|estrada)\s+(\1\b.*)$/i,"$2").trim();
}

const BRAZILIAN_UFS=new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);

export type ParsedCityUf={ok:true;cidade:string;uf:string}|{ok:false;reason:"missing"|"invalid"};

export function parseCityUf(value:string|null|undefined):ParsedCityUf{
  const match=String(value??"").trim().match(/^(.+?)\s*[-/]\s*([a-z]{2})\s*$/i);
  if(!match)return {ok:false,reason:"missing"};
  const cidade=match[1].trim(),uf=match[2].toUpperCase();
  if(!cidade)return {ok:false,reason:"missing"};
  if(!BRAZILIAN_UFS.has(uf))return {ok:false,reason:"invalid"};
  return {ok:true,cidade,uf};
}

export function formatCityUf(cidade:string|null|undefined,uf:string|null|undefined){
  const city=String(cidade??"").trim(),explicitUf=String(uf??"").trim().toUpperCase();
  const embedded=parseCityUf(city);
  if(BRAZILIAN_UFS.has(explicitUf))return `${embedded.ok?embedded.cidade:city} - ${explicitUf}`.trim();
  return embedded.ok?`${embedded.cidade} - ${embedded.uf}`:city;
}

