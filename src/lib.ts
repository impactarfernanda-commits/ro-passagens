import type {Motivo,Obra,Status} from './types';
export const motivoLabel:Record<Motivo,string>={ferias:'Férias',folga_campo:'Folga de campo',desligamento:'Desligamento',transferencia_obra:'Transferência de obra',viagem_diretoria:'Viagem diretoria'};
export const statusLabel:Record<Status,string>={solicitada:'Solicitada',em_analise:'Em andamento',em_andamento:'Em andamento',passagem_comprada:'Passagem comprada',finalizada:'Finalizada',cancelada:'Cancelada'};
export const statusOptions:ReadonlyArray<{value:Exclude<Status,'em_analise'>;label:string}>=[
  {value:'solicitada',label:'Solicitada'},
  {value:'em_andamento',label:'Em andamento'},
  {value:'passagem_comprada',label:'Passagem comprada'},
  {value:'finalizada',label:'Finalizada'},
  {value:'cancelada',label:'Cancelada'},
];
export const dinheiro=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v||0);
export const data=(v?:string|null)=>v?new Intl.DateTimeFormat('pt-BR').format(new Date(`${v.slice(0,10)}T12:00:00`)):'—';
export const dataHora=(v?:string|null)=>v?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';
export function formatCentroCustoLabel(centro?: Pick<Obra,'codigo'|'nome'|'descricao'>|null){
  if(!centro)return '';
  const nome=(centro.nome||centro.descricao||'').trim().toLocaleUpperCase('pt-BR');
  const codigo=centro.codigo?.trim();
  return codigo?`${codigo} - ${nome}`:nome;
}
export function centroCustoMatches(centro:Pick<Obra,'codigo'|'nome'|'descricao'>,busca:string){
  const termo=busca.trim().toLocaleLowerCase('pt-BR');
  if(!termo)return true;
  return [centro.codigo,centro.nome,centro.descricao,formatCentroCustoLabel(centro)]
    .some((valor)=>valor?.toLocaleLowerCase('pt-BR').includes(termo));
}
