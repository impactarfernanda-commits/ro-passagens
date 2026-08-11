export type CollaboratorField = "nome"|"data_nascimento"|"cpf"|"rg"|"telefone"|"cep"|"logradouro"|"numero"|"complemento"|"bairro"|"cidade"|"uf"|"estado";
export type AddressField = CollaboratorField;
export type ColumnMapping = Partial<Record<CollaboratorField, number>>;
export type SpreadsheetCell = string|number|boolean|Date|null;
export type SpreadsheetRows = SpreadsheetCell[][];
export const MAX_RH_XLSX_BYTES = 10 * 1024 * 1024;

export function isSpreadsheetRows(value: unknown): value is SpreadsheetRows {
  if(!Array.isArray(value)||value.length===0||!value.every(Array.isArray))return false;
  const header=value[0];
  return header.length>0&&header.some((cell)=>cell instanceof Date||typeof cell==="number"||typeof cell==="boolean"||(typeof cell==="string"&&cell.trim()!==""));
}

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
export type ImportMatchStatus="atualizacao"|"novo_vinculado"|"novo_externo"|"possivel_duplicidade"|"conflito";
export type ImportMatchReason="cpf_exato"|"funcionario_vinculado"|"nome_privado_exato"|"nome_obras_exato"|"ambiguo"|"externo"|"cpf_conflitante";
export type ImportMatch<TPrivate,TObras>={status:ImportMatchStatus;reason:ImportMatchReason;privateRecord:TPrivate|null;obrasRecord:TObras|null;candidates:TObras[];privateCandidates?:TPrivate[];obrasCandidates?:TObras[]};
export type CollaboratorSuggestion={origem:"privado"|"obras";id:string;nome:string;funcionario_id?:string|null;motivo:"nome_exato"|"nome_semelhante"|"dados_auxiliares"};
export function isEligibleObrasMatch(employee:{ativo:boolean;deleted_at?:string|null}){return employee.ativo&&employee.deleted_at==null}
export function canKeepAsExternal<TPrivate,TObras>(match:ImportMatch<TPrivate,TObras>){return match.reason==="externo"}
/** Ordem conservadora: CPF privado, vínculo privado, nome privado e só então nome exato único no Obras. */
export function matchCollaborator<
  TPrivate extends {id:string;nome:string;cpf?:string|null;funcionario_id?:string|null},
  TObras extends {id:string;nome:string}
>(input:{nome:string;cpf?:string|null;funcionario_id?:string|null},privateRecords:TPrivate[],obrasRecords:TObras[]):ImportMatch<TPrivate,TObras>{
  const byCpf=cpfMatches(input.cpf||"",privateRecords);
  if(byCpf.length===1)return{status:"atualizacao",reason:"cpf_exato",privateRecord:byCpf[0],obrasRecord:null,candidates:[]};
  if(byCpf.length>1)return{status:"possivel_duplicidade",reason:"ambiguo",privateRecord:null,obrasRecord:null,candidates:[]};
  const byLink=input.funcionario_id?privateRecords.filter(record=>record.funcionario_id===input.funcionario_id):[];
  if(byLink.length===1)return{status:"atualizacao",reason:"funcionario_vinculado",privateRecord:byLink[0],obrasRecord:null,candidates:[]};
  if(byLink.length>1)return{status:"possivel_duplicidade",reason:"ambiguo",privateRecord:null,obrasRecord:null,candidates:[]};
  const byPrivateName=safeMatches(input.nome,privateRecords);
  if(byPrivateName.length===1){const existingCpf=normalizeCpf(byPrivateName[0].cpf);const incomingCpf=normalizeCpf(input.cpf);if(existingCpf&&incomingCpf&&existingCpf!==incomingCpf)return{status:"conflito",reason:"cpf_conflitante",privateRecord:byPrivateName[0],obrasRecord:null,candidates:[]};return{status:"atualizacao",reason:"nome_privado_exato",privateRecord:byPrivateName[0],obrasRecord:null,candidates:[]}}
  if(byPrivateName.length>1)return{status:"possivel_duplicidade",reason:"ambiguo",privateRecord:null,obrasRecord:null,candidates:[],privateCandidates:byPrivateName};
  const byObrasName=safeMatches(input.nome,obrasRecords);
  if(byObrasName.length===1)return{status:"novo_vinculado",reason:"nome_obras_exato",privateRecord:null,obrasRecord:byObrasName[0],candidates:byObrasName};
  if(byObrasName.length>1)return{status:"possivel_duplicidade",reason:"ambiguo",privateRecord:null,obrasRecord:null,candidates:byObrasName,obrasCandidates:byObrasName};
  return{status:"novo_externo",reason:"externo",privateRecord:null,obrasRecord:null,candidates:[]};
}
export function possibleMatches<T extends {id:string;nome:string}>(sheetName:string,employees:T[]):T[]{const tokens=new Set(normalizeText(sheetName).split(" ").filter(x=>x.length>1));if(tokens.size<2)return[];return employees.filter(employee=>{const candidate=new Set(normalizeText(employee.nome).split(" ").filter(x=>x.length>1));const common=[...tokens].filter(x=>candidate.has(x)).length;return common>=2&&common/Math.max(tokens.size,candidate.size)>=0.5}).slice(0,5)}
export function strongAuxiliaryMatches<T extends {data_nascimento?:string|null;telefone?:string|null;cidade?:string|null;uf?:string|null}>(input:{data_nascimento?:string|null;telefone?:string|null;cidade?:string|null;uf?:string|null},records:T[]):T[]{return records.filter(record=>{let score=0;if(input.data_nascimento&&record.data_nascimento===input.data_nascimento)score++;if(normalizePhone(input.telefone)&&normalizePhone(input.telefone)===normalizePhone(record.telefone))score++;if(normalizeText(input.cidade)&&normalizeText(input.cidade)===normalizeText(record.cidade)&&String(input.uf||"").toUpperCase()===String(record.uf||"").toUpperCase())score++;return score>=2})}
export function buildCollaboratorSuggestions<
  TPrivate extends {id:string;nome:string;funcionario_id?:string|null},TObras extends {id:string;nome:string}
>(match:ImportMatch<TPrivate,TObras>,similarPrivate:TPrivate[]=[],auxiliaryPrivate:TPrivate[]=[],similarObras:TObras[]=[]):CollaboratorSuggestion[]{
  const suggestions:CollaboratorSuggestion[]=[];
  const add=(suggestion:CollaboratorSuggestion)=>{if(!suggestions.some(item=>item.origem===suggestion.origem&&item.id===suggestion.id))suggestions.push(suggestion)};
  match.privateCandidates?.forEach(item=>add({origem:"privado",id:item.id,nome:item.nome,funcionario_id:item.funcionario_id??null,motivo:"nome_exato"}));
  (match.obrasCandidates||match.candidates).forEach(item=>add({origem:"obras",id:item.id,nome:item.nome,motivo:"nome_exato"}));
  auxiliaryPrivate.forEach(item=>add({origem:"privado",id:item.id,nome:item.nome,funcionario_id:item.funcionario_id??null,motivo:"dados_auxiliares"}));
  similarPrivate.forEach(item=>add({origem:"privado",id:item.id,nome:item.nome,funcionario_id:item.funcionario_id??null,motivo:"nome_semelhante"}));
  similarObras.forEach(item=>add({origem:"obras",id:item.id,nome:item.nome,motivo:"nome_semelhante"}));
  return suggestions;
}
export function resolveCollaboratorSuggestion<T extends {colaborador_id:string|null;funcionario_id:string|null;status:string;mensagem:string}>(item:T,suggestion:CollaboratorSuggestion|null):T{
  if(!suggestion)return{...item,colaborador_id:null,funcionario_id:null,status:"novo_externo",mensagem:"Novo colaborador externo — opção confirmada manualmente."} as T;
  if(suggestion.origem==="privado")return{...item,colaborador_id:suggestion.id,funcionario_id:suggestion.funcionario_id??null,status:"atualizacao",mensagem:"Cadastro privado existente selecionado manualmente."} as T;
  return{...item,colaborador_id:null,funcionario_id:suggestion.id,status:"novo_vinculado",mensagem:"Novo cadastro privado — vínculo com Obras confirmado manualmente."} as T;
}
export function mergePreservingExisting<T extends Record<string,unknown>>(current:T,incoming:Partial<T>):T{return Object.fromEntries(Object.entries({...current,...incoming}).map(([key,value])=>[key,value===""||value==null?current[key]:value])) as T}
export function duplicateCpfRows(rows:Array<{cpf?:string|null}>){const counts=new Map<string,number>();rows.forEach(row=>{const cpf=normalizeCpf(row.cpf);if(cpf)counts.set(cpf,(counts.get(cpf)||0)+1)});return new Set([...counts].filter(([,count])=>count>1).map(([cpf])=>cpf))}
