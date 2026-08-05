import type { Motivo, Solicitacao } from "./types";

export const RECUSA_TERMINAIS=["passagem_comprada","finalizada","cancelada","recusada"] as const;
export function solicitacaoFoiComprada(row:Pick<Solicitacao,"status"|"comprado_em"|"comprado_por"|"custos"|"anexos">){
  return ["passagem_comprada","finalizada"].includes(row.status)||Boolean(row.comprado_em||row.comprado_por)||(row.custos||[]).some((c)=>c.tipo==="passagem"&&Number(c.valor)>0)||(row.anexos||[]).length>0;
}
export function podeRecusarSolicitacao(isRoAtivo:boolean,row:Pick<Solicitacao,"status"|"comprado_em"|"comprado_por"|"custos"|"anexos">){
  return isRoAtivo&&["solicitada","em_andamento","em_analise"].includes(row.status)&&!solicitacaoFoiComprada(row);
}
export const motivoRecusaValido=(motivo:string)=>motivo.trim().length>=10;
export function motivoPrefillPermitido(motivo:Motivo|null|undefined,permitidos:Motivo[]){return motivo&&permitidos.includes(motivo)?motivo:"";}
export const statusContaComoAberto=(status:string)=>!["passagem_comprada","finalizada","cancelada","recusada"].includes(status);
