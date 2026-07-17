export type TicketCostInput={nome_arquivo:string;valor:string|number};
export type ManualCostInput={uber:string|number;refeicao:string|number;outros:string|number};
export function buildPurchaseCosts(solicitacaoId:string,pdfs:TicketCostInput[],manual:ManualCostInput){return [...pdfs.filter(pdf=>Number(pdf.valor)>0).map(pdf=>({solicitacao_id:solicitacaoId,tipo:'passagem' as const,descricao:'PDF: '+pdf.nome_arquivo,valor:Number(pdf.valor)})),...(['uber','refeicao','outros'] as const).filter(tipo=>Number(manual[tipo])>0).map(tipo=>({solicitacao_id:solicitacaoId,tipo,valor:Number(manual[tipo])}))]}
export function totalTicketValues(pdfs:TicketCostInput[]){return pdfs.reduce((total,pdf)=>total+Number(pdf.valor||0),0)}
