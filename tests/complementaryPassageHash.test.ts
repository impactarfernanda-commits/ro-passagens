import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeComplementaryDraft, sha256BytesHex, sha256TextHex } from "../src/complementaryPassageIdentity.ts";

test("SHA-256 usa bytes reais e produz hex lowercase",async()=>{
 const a=await sha256BytesHex(new Blob([new Uint8Array([1,2,3,4])],{type:"application/pdf"}));
 const igual=await sha256BytesHex(new Blob([new Uint8Array([1,2,3,4])],{type:"application/pdf"}));
 const diferente=await sha256BytesHex(new Blob([new Uint8Array([4,3,2,1])],{type:"application/pdf"}));
 assert.match(a,/^[0-9a-f]{64}$/);assert.equal(a,igual);assert.notEqual(a,diferente);
});

test("mesmo nome e tamanho não mascaram bytes diferentes",async()=>{
 const left=new File([new Uint8Array([1,1,1,1])],"mesmo.pdf");
 const right=new File([new Uint8Array([2,2,2,2])],"mesmo.pdf");
 assert.equal(left.name,right.name);assert.equal(left.size,right.size);
 assert.notEqual(await sha256BytesHex(left),await sha256BytesHex(right));
});

test("canonicalização é determinística e incorpora hash",async()=>{
 const document=(id:string,hash:string)=>({id,nome_arquivo:"arquivo.pdf",conteudo_sha256:hash,tamanho_bytes:4,partida_em:"",valor:"10",observacao:" teste "});
 const base={solicitacaoId:"s",centroCustoId:"c",imprevisto:false,motivo:" motivo   seguro ",custosAdicionais:[{tipo:"uber",valor:2,centro_custo_id:"c"}]};
 const one=canonicalizeComplementaryDraft({...base,groups:[{documents:[document("b","b".repeat(64)),document("a","a".repeat(64))]}]});
 const reordered=canonicalizeComplementaryDraft({...base,groups:[{documents:[document("a","a".repeat(64)),document("b","b".repeat(64))]}]});
 assert.deepEqual(one,reordered);
 const changed=canonicalizeComplementaryDraft({...base,groups:[{documents:[document("a","c".repeat(64)),document("b","b".repeat(64))]}]});
 assert.notEqual(await sha256TextHex(JSON.stringify(one)),await sha256TextHex(JSON.stringify(changed)));
});
