export const MAX_PDF_BYTES=10*1024*1024;
export function validatePdfFile(file:{name:string;type:string;size:number}){
  const extensaoPdf=file.name.toLocaleLowerCase('pt-BR').endsWith('.pdf');
  if((file.type&&file.type!=='application/pdf')||!extensaoPdf)return 'Apenas arquivos PDF são permitidos.';
  if(file.size>MAX_PDF_BYTES)return 'O PDF deve ter no máximo 10 MB.';
  return null;
}
export async function validatePdfSignature(file:Blob){
  const signature=new TextDecoder("ascii").decode(await file.slice(0,5).arrayBuffer());
  return signature==="%PDF-"?null:"O conteúdo do arquivo não corresponde a um PDF válido.";
}
