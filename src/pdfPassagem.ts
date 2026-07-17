import {extractTicketDataFromText} from './pdfPassagemHeuristics';
export type {PurchaseData} from './pdfPassagemHeuristics';

export async function extractTicketDataFromPdf(file:File){
  const [{GlobalWorkerOptions,getDocument},{default:workerUrl}]=await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc=workerUrl;
  const document=await getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;const pages:string[]=[];
  for(let index=1;index<=document.numPages;index+=1){const page=await document.getPage(index);const content=await page.getTextContent();pages.push(content.items.map(item=>'str'in item?item.str:'').join(' '))}
  return extractTicketDataFromText(pages.join('\n'));
}
