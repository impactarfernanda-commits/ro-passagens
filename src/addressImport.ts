export type CollaboratorField = "nome"|"data_nascimento"|"cpf"|"rg"|"telefone"|"cep"|"logradouro"|"numero"|"complemento"|"bairro"|"cidade"|"uf"|"estado";
export type AddressField = CollaboratorField;
export type ColumnMapping = Partial<Record<CollaboratorField, number>>;

const aliases: Record<CollaboratorField,string[]> = {
  nome:["nome","colaborador","funcionario","nome do colaborador","nome do funcionario","nome colaborador","nome funcionario"],
  data_nascimento:["nascimento","data nascimento","data de nascimento","dt nascimento","dt. nascimento"],
  cpf:["cpf","cpf colaborador"], rg:["rg","identidade"],
  telefone:["telefone","celular","fone","telefone celular"],
  cep:["cep","c e p"],logradouro:["logradouro","endereco","rua"],numero:["numero","nº","n°","num"],complemento:["complemento","compl"],bairro:["bairro"],
  cidade:["cidade","municipio"], uf:["uf"],estado:["estado"],
};

export function normalizeText(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .trim().replace(/[._:\-/\\]+/g," ").replace(/\s+/g," ").trim().toLocaleLowerCase("pt-BR");
}
export function autoMapHeaders(headers: unknown[]): ColumnMapping {
  const normalized=headers.map(normalizeText); const result:ColumnMapping={};
  (Object.keys(aliases) as CollaboratorField[]).forEach((field)=>{
    const accepted=aliases[field].map(normalizeText);
    const index=normalized.findIndex((header)=>accepted.includes(header));
    if(index>=0) result[field]=index;
  });
  return result;
}
export function digits(value: unknown){return String(value??"").replace(/\D/g,"")}
export function normalizeCpf(value: unknown){const cpf=digits(value);return cpf.length===11&&!/^(\d)\1{10}$/.test(cpf)?cpf:""}
export function isValidCpf(value: unknown){return normalizeCpf(value)!==""}
export function formatCpf(value: unknown){const cpf=digits(value);return cpf.length===11?cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"):String(value??"")}
export function normalizePhone(value: unknown){return digits(value)}
export function formatPhone(value: unknown){const phone=digits(value);if(phone.length===11)return phone.replace(/(\d{2})(\d{5})(\d{4})/,"($1) $2-$3");if(phone.length===10)return phone.replace(/(\d{2})(\d{4})(\d{4})/,"($1) $2-$3");return String(value??"")}
export function parseBirthDate(value: unknown): string|null {
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
  const raw=String(value??"").trim();if(!raw)return null;
  let year:number,month:number,day:number;let match:RegExpMatchArray|null;
  if((match=raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/))){day=+match[1];month=+match[2];year=+match[3]}
  else if((match=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/))){year=+match[1];month=+match[2];day=+match[3]}
  else return null;
  const parsed=new Date(Date.UTC(year,month-1,day));
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day?`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`:null;
}
export function validUf(value: unknown) {return ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].includes(String(value??"").trim().toUpperCase())}
export function safeMatches<T extends {id:string;nome:string}>(sheetName:string, employees:T[]):T[] {const key=normalizeText(sheetName);return employees.filter((employee)=>normalizeText(employee.nome)===key)}
export function cpfMatches<T extends {cpf?:string|null}>(cpf:string,records:T[]):T[]{const key=normalizeCpf(cpf);return key?records.filter(record=>normalizeCpf(record.cpf)===key):[]}
export function possibleMatches<T extends {id:string;nome:string}>(sheetName:string,employees:T[]):T[]{const tokens=new Set(normalizeText(sheetName).split(" ").filter(x=>x.length>1));if(tokens.size<2)return[];return employees.filter(employee=>{const candidate=new Set(normalizeText(employee.nome).split(" ").filter(x=>x.length>1));const common=[...tokens].filter(x=>candidate.has(x)).length;return common>=2&&common/Math.max(tokens.size,candidate.size)>=0.5}).slice(0,5)}
export function mergePreservingExisting<T extends Record<string,unknown>>(current:T,incoming:Partial<T>):T{return Object.fromEntries(Object.entries({...current,...incoming}).map(([key,value])=>[key,value===""||value==null?current[key]:value])) as T}
export function duplicateCpfRows(rows:Array<{cpf?:string|null}>){const counts=new Map<string,number>();rows.forEach(row=>{const cpf=normalizeCpf(row.cpf);if(cpf)counts.set(cpf,(counts.get(cpf)||0)+1)});return new Set([...counts].filter(([,count])=>count>1).map(([cpf])=>cpf))}
