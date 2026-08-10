export type AddressField = "nome"|"cep"|"logradouro"|"numero"|"complemento"|"bairro"|"cidade"|"uf";
export type ColumnMapping = Partial<Record<AddressField, number>>;

const aliases: Record<AddressField,string[]> = {
  nome:["nome","funcionario","colaborador","nome do funcionario","nome funcionario","nome colaborador"],
  cep:["cep","c.e.p."], logradouro:["endereco","logradouro","rua"],
  numero:["numero","nº","n°","num"], complemento:["complemento","compl."],
  bairro:["bairro"], cidade:["cidade","municipio"], uf:["uf","estado"],
};

export function normalizeText(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .trim().replace(/\s+/g," ").toLocaleLowerCase("pt-BR");
}
export function autoMapHeaders(headers: unknown[]): ColumnMapping {
  const normalized=headers.map(normalizeText); const result:ColumnMapping={};
  (Object.keys(aliases) as AddressField[]).forEach((field)=>{
    const index=normalized.findIndex((h)=>aliases[field].map(normalizeText).includes(h));
    if(index>=0) result[field]=index;
  });
  return result;
}
export function validUf(value: unknown) {
  return ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].includes(String(value??"").trim().toUpperCase());
}
export function safeMatches<T extends {id:string;nome:string}>(sheetName:string, employees:T[]):T[] {
  const key=normalizeText(sheetName); return employees.filter((employee)=>normalizeText(employee.nome)===key);
}
export function possibleMatches<T extends {id:string;nome:string}>(sheetName:string,employees:T[]):T[]{const tokens=new Set(normalizeText(sheetName).split(" ").filter(x=>x.length>1));if(tokens.size<2)return[];return employees.filter(employee=>{const candidate=new Set(normalizeText(employee.nome).split(" ").filter(x=>x.length>1));const common=[...tokens].filter(x=>candidate.has(x)).length;return common>=2&&common/Math.max(tokens.size,candidate.size)>=0.5}).slice(0,5)}
