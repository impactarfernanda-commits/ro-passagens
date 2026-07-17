import type {Motivo,Status} from './types';
export const motivoLabel:Record<Motivo,string>={ferias:'Férias',folga_campo:'Folga de campo',desligamento:'Desligamento'};
export const statusLabel:Record<Status,string>={solicitada:'Solicitada',em_analise:'Em análise',passagem_comprada:'Passagem comprada',finalizada:'Finalizada',cancelada:'Cancelada'};
export const dinheiro=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v||0);
export const data=(v?:string|null)=>v?new Intl.DateTimeFormat('pt-BR').format(new Date(`${v.slice(0,10)}T12:00:00`)):'—';
export const dataHora=(v?:string|null)=>v?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';
