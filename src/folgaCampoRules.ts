export type CicloFolga={possui_historico:boolean;ultima_solicitacao_id:string|null;ultima_folga_realizada:string|null;ultima_data_prevista_ciclo:string|null;proxima_folga_prevista:string|null;data_limite_recomendada:string|null;solicitacao_futura_existente_id:string|null;solicitacao_futura_data:string|null;solicitacao_futura_status:string|null};
export const SEM_HISTORICO_FOLGA="Não há registro de folga de campo anterior para este funcionário. O ciclo de 90 dias será iniciado após a primeira folga registrada no sistema.";
export const dataAntecipaCiclo=(dataIda:string,proxima?:string|null)=>Boolean(dataIda&&proxima&&dataIda<proxima);
export const justificativaAntecipacaoValida=(valor:string)=>valor.trim().length>=10;
export const compraFolgaLiberada=(status?:string|null)=>status!=="pendente";
export const folgaFuturaBloqueia=(ciclo?:CicloFolga|null)=>Boolean(ciclo?.solicitacao_futura_existente_id);
