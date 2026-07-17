export const MAX_PDF_BYTES=10*1024*1024;
export function validatePdfFile(file:{type:string;size:number}){
  if(file.type!=='application/pdf')return 'Selecione um arquivo PDF válido.';
  if(file.size>MAX_PDF_BYTES)return 'O PDF deve ter no máximo 10 MB.';
  return null;
}
