import type { DesligamentoSubtipo, Motivo } from "./types";

export type PrazoTipo = "dias_corridos" | "dias_uteis" | "sem_prazo_minimo";
export type CalendarioAno = { ano: number; completo: boolean };
export type DiaNaoUtil = { data: string; ativo: boolean };
export type DocumentoInternoInput = { categoria: string; mimeType: string; tamanhoBytes: number };
export type ValidacaoInput = {
  motivo: Motivo | null; desligamentoSubtipo?: DesligamentoSubtipo | null; role: string | null; isRh: boolean;
  dataIda: string | null; agora: Date; diasNaoUteis?: DiaNaoUtil[]; anos?: CalendarioAno[];
  solicitarExcecao?: boolean; justificativa?: string; documentos?: DocumentoInternoInput[];
  canUseAdministrativeNull?: boolean;
};
export const RH_MOTIVOS: Motivo[] = ["admissao", "desligamento", "inicio_obra"];
export const MOTIVOS_CRIACAO: Motivo[] = ["ferias", "folga_campo", "desligamento", "transferencia_obra", "admissao", "inicio_obra", "retorno_obra", "recesso"];

export function motivosPermitidos(role: string | null, isRh: boolean) {
  if (role === "gerente" || role === "diretor") return MOTIVOS_CRIACAO;
  if (isRh) return RH_MOTIVOS;
  return MOTIVOS_CRIACAO.filter((motivo) => motivo !== "admissao");
}
export function getPrimeiroEmbarque(datas: Array<string | null | undefined>) {
  return datas.filter((v): v is string => Boolean(v && !Number.isNaN(new Date(v).getTime())))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || null;
}
export function regraPrazo(motivo: Motivo | null, subtipo?: DesligamentoSubtipo | null) {
  if (motivo === "desligamento") {
    if (subtipo === "justa_causa" || subtipo === "pedido_demissao") return { codigo: `desligamento_${subtipo}`, tipo: "sem_prazo_minimo" as const, quantidade: 0 };
    if (subtipo === "ma_conduta") return { codigo: "desligamento_ma_conduta", tipo: "dias_uteis" as const, quantidade: 5 };
    if (subtipo === "programado_outros") return { codigo: "desligamento_programado_outros", tipo: "dias_corridos" as const, quantidade: 15 };
    return { codigo: "desligamento_programado_outros", tipo: "dias_corridos" as const, quantidade: 25 };
  }
  const regras: Partial<Record<Motivo, [PrazoTipo, number]>> = {
    ferias: ["dias_corridos", 25], folga_campo: ["dias_corridos", 15], transferencia_obra: ["dias_corridos", 15],
    admissao: ["dias_corridos", 15], retorno_obra: ["dias_corridos", 15], inicio_obra: ["dias_uteis", 5], recesso: ["dias_corridos", 30],
  };
  const [tipo, quantidade] = regras[motivo || "viagem_diretoria"] || ["sem_prazo_minimo", 0];
  return { codigo: motivo || "administrativo", tipo, quantidade };
}
const zonedParts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
const calendarDate = (d: Date) => { const p=zonedParts(d); return new Date(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),12)); };
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n, 12));
export function calcularDataMinima(agora: Date, tipo: PrazoTipo, quantidade: number, diasNaoUteis: DiaNaoUtil[] = [], anos: CalendarioAno[] = []) {
  const local=calendarDate(agora); const partes=zonedParts(agora); const hora=Number(partes.hour); const minuto=Number(partes.minute);
  if (tipo === "sem_prazo_minimo") return { data: isoDate(local), anosPendentes: [] as number[] };
  if (tipo === "dias_corridos") return { data: isoDate(addDays(local, quantidade)), anosPendentes: [] as number[] };
  const bloqueados = new Set(diasNaoUteis.filter((d) => d.ativo).map((d) => d.data));
  const completos = new Set(anos.filter((a) => a.completo).map((a) => a.ano));
  const usados = new Set<number>(); let cursor = local; let restantes = quantidade; let primeiroDia = true;
  const limite = cursor.getUTCDay() === 5 ? [15, 30] : [16, 30];
  const passouCorte = hora > limite[0] || (hora === limite[0] && minuto > limite[1]);
  while (restantes > 0) {
    const util = cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6 && !bloqueados.has(isoDate(cursor));
    if (util && !(primeiroDia && passouCorte)) { usados.add(cursor.getUTCFullYear()); restantes--; if (!restantes) break; }
    primeiroDia = false;
    cursor = addDays(cursor, 1);
  }
  return { data: isoDate(cursor), anosPendentes: [...usados].filter((ano) => !completos.has(ano)).sort() };
}
export function categoriaDocumento(subtipo?: DesligamentoSubtipo | null) {
  if (subtipo === "justa_causa") return "termo_justa_causa" as const;
  if (subtipo === "pedido_demissao") return "carta_pedido_demissao" as const;
  return null;
}

export function mensagemAntecedencia(motivo: Motivo | null, subtipo?: DesligamentoSubtipo | null) {
  if (!motivo || (motivo === "desligamento" && !subtipo)) return null;
  const regra = regraPrazo(motivo, subtipo);
  if (regra.tipo === "sem_prazo_minimo") return "Sem antecedência mínima.";
  return `Antecedência mínima: ${regra.quantidade} ${regra.tipo === "dias_uteis" ? "dias úteis" : "dias corridos"}.`;
}

export function dataMinimaDoInput(dataMinimaNormal: string, hojeLocal: string, gerencial: boolean, solicitarExcecao: boolean) {
  return gerencial && solicitarExcecao ? hojeLocal : dataMinimaNormal;
}

export function limparDataIdaInvalida(dataIda: string, minimo: string) {
  return dataIda && dataIda < minimo ? "" : dataIda;
}

export function isFernandaAdmin(email?: string | null) { return email?.trim().toLocaleLowerCase("pt-BR") === "fernanda.souza@tanksbr.com.br"; }
export function calendarYearsToInvalidate(operation:"INSERT"|"UPDATE"|"DELETE",oldDate?:string|null,newDate?:string|null){
  const year=(value?:string|null)=>value?Number(value.slice(0,4)):null;
  const years=operation==="INSERT"?[year(newDate)]:operation==="DELETE"?[year(oldDate)]:[year(oldDate),year(newDate)];
  return [...new Set(years.filter((value):value is number=>value!==null&&!Number.isNaN(value)))];
}

export function validarSolicitacao(input: ValidacaoInput) {
  const bloqueios: string[]=[]; const gerencial=input.role==="gerente"||input.role==="diretor";
  if(input.motivo===null&&!input.canUseAdministrativeNull)bloqueios.push("MOTIVO_ADMINISTRATIVO_NAO_PERMITIDO");
  if (input.motivo==="viagem_diretoria" || (input.motivo && !motivosPermitidos(input.role,input.isRh).includes(input.motivo))) bloqueios.push("MOTIVO_NAO_PERMITIDO");
  if(input.motivo==="desligamento"&&!input.desligamentoSubtipo)bloqueios.push("SUBTIPO_DESLIGAMENTO_OBRIGATORIO");
  if(input.motivo!=="desligamento"&&input.desligamentoSubtipo)bloqueios.push("SUBTIPO_DESLIGAMENTO_INVALIDO");
  const hoje=calcularDataMinima(input.agora,"sem_prazo_minimo",0).data;
  const dataIda=input.dataIda||"";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dataIda))bloqueios.push("DATA_IDA_OBRIGATORIA"); else if(dataIda<hoje)bloqueios.push("DATA_IDA_NO_PASSADO");
  const regra=regraPrazo(input.motivo,input.desligamentoSubtipo); const calculo=calcularDataMinima(input.agora,regra.tipo,regra.quantidade,input.diasNaoUteis,input.anos);
  if(calculo.anosPendentes.length)bloqueios.push(`CALENDARIO_INCOMPLETO:${calculo.anosPendentes[0]}`);
  const foraDoPrazo=Boolean(dataIda&&dataIda<calculo.data);
  if(foraDoPrazo&&!gerencial)bloqueios.push("FORA_DO_PRAZO");
  if(foraDoPrazo&&gerencial&&!input.solicitarExcecao)bloqueios.push("EXCECAO_PRAZO_NAO_SOLICITADA");
  if(foraDoPrazo&&gerencial&&input.solicitarExcecao&&(input.justificativa?.trim().length||0)<10)bloqueios.push("JUSTIFICATIVA_EXCECAO_OBRIGATORIA");
  const categoria=categoriaDocumento(input.desligamentoSubtipo); const docs=input.documentos||[];
  if(categoria&&!docs.some((d)=>d.categoria===categoria))bloqueios.push(`DOCUMENTO_INTERNO_OBRIGATORIO:${categoria}`);
  for(const doc of docs){if(doc.mimeType!=="application/pdf")bloqueios.push("DOCUMENTO_NAO_PDF");if(doc.tamanhoBytes<=0||doc.tamanhoBytes>10*1024*1024)bloqueios.push("DOCUMENTO_TAMANHO_INVALIDO");}
  return {bloqueios:[...new Set(bloqueios)],foraDoPrazo,dataMinimaPermitida:calculo.data,regra,categoriaDocumentoObrigatorio:categoria,permiteExcecao:gerencial&&!calculo.anosPendentes.length};
}
