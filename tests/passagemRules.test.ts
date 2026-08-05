import assert from "node:assert/strict";
import test from "node:test";
import { calcularDataMinima, calendarYearsToInvalidate, categoriaDocumento, dataMinimaDoInput, getPrimeiroEmbarque, isFernandaAdmin, limparDataIdaInvalida, mensagemAntecedencia, motivosPermitidos, regraPrazo, validarSolicitacao, type ValidacaoInput } from "../src/passagemRules.ts";
import { validatePdfFile, validatePdfSignature } from "../src/pdfFileValidation.ts";

const sp=(value:string)=>new Date(`${value}-03:00`);
const anos2026=[{ano:2026,completo:true}];
const base:ValidacaoInput={motivo:"ferias",role:"assistente",isRh:false,agora:sp("2026-08-03T10:00:00"),dataIda:"2026-09-01",anos:anos2026,documentos:[]};
const validar=(patch:Partial<ValidacaoInput>)=>validarSolicitacao({...base,...patch});

for(const [nome,motivo,subtipo,tipo,quantidade] of [
  ["férias","ferias",null,"dias_corridos",25],["folga","folga_campo",null,"dias_corridos",15],
  ["transferência","transferencia_obra",null,"dias_corridos",15],["admissão","admissao",null,"dias_corridos",15],
  ["retorno","retorno_obra",null,"dias_corridos",15],["recesso","recesso",null,"dias_corridos",30],
  ["desligamento programado","desligamento","programado_outros","dias_corridos",25],
  ["má conduta","desligamento","ma_conduta","dias_uteis",5],
  ["justa causa","desligamento","justa_causa","sem_prazo_minimo",0],
  ["pedido de demissão","desligamento","pedido_demissao","sem_prazo_minimo",0],
] as const)test(`prazo: ${nome}`,()=>{const r=regraPrazo(motivo,subtipo);assert.equal(r.tipo,tipo);assert.equal(r.quantidade,quantidade);});

test("dias corridos 04/08/2026 + 25 = 29/08/2026",()=>assert.equal(calcularDataMinima(sp("2026-08-04T12:00:00"),"dias_corridos",25).data,"2026-08-29"));
for(const [nome,agora,quantidade,esperada] of [
  ["segunda 16:30 conta","2026-08-03T16:30:00",5,"2026-08-07"],
  ["segunda 16:31 não conta","2026-08-03T16:31:00",5,"2026-08-10"],
  ["sexta 15:30 conta","2026-08-07T15:30:00",1,"2026-08-07"],
  ["sexta 15:31 não conta","2026-08-07T15:31:00",1,"2026-08-10"],
  ["sábado inicia segunda","2026-08-08T10:00:00",1,"2026-08-10"],
  ["domingo inicia segunda","2026-08-09T10:00:00",1,"2026-08-10"],
] as const)test(nome,()=>assert.equal(calcularDataMinima(sp(agora),"dias_uteis",quantidade,[],anos2026).data,esperada));

for(const nome of ["feriado nacional","feriado estadual SP","feriado municipal Rio Claro","ponto facultativo"])
  test(nome,()=>assert.equal(calcularDataMinima(sp("2026-08-03T10:00:00"),"dias_uteis",5,[{data:"2026-08-05",ativo:true}],anos2026).data,"2026-08-10"));
test("dia inativo não desloca",()=>assert.equal(calcularDataMinima(sp("2026-08-03T10:00:00"),"dias_uteis",5,[{data:"2026-08-05",ativo:false}],anos2026).data,"2026-08-07"));
test("ano incompleto bloqueia",()=>assert.deepEqual(calcularDataMinima(sp("2026-08-03T10:00:00"),"dias_uteis",5,[],[]).anosPendentes,[2026]));
test("travessia de ano exige os dois calendários",()=>assert.deepEqual(calcularDataMinima(sp("2026-12-30T10:00:00"),"dias_uteis",5,[],anos2026).anosPendentes,[2027]));

test("usuário comum não vê admissão e vê recesso",()=>{const r=motivosPermitidos("assistente",false);assert.equal(r.includes("admissao"),false);assert.equal(r.includes("recesso"),true);});
test("RH ativo vê somente três motivos",()=>assert.deepEqual(motivosPermitidos("assistente",true),["admissao","desligamento","inicio_obra"]));
test("RH inativo volta às permissões comuns",()=>assert.equal(motivosPermitidos("assistente",false).includes("admissao"),false));
test("RO sem RH não recebe admissão",()=>assert.equal(motivosPermitidos("coordenador",false).includes("admissao"),false));
test("gerente vê todos os motivos de criação",()=>assert.equal(motivosPermitidos("gerente",false).length,8));
test("diretor vê todos e não vê viagem diretoria",()=>{const r=motivosPermitidos("diretor",false);assert.equal(r.length,8);assert.equal(r.includes("viagem_diretoria"),false);});
test("Fernanda administra com e-mail case-insensitive",()=>{assert.equal(isFernandaAdmin("FERNANDA.SOUZA@TANKSBR.COM.BR"),true);assert.equal(isFernandaAdmin("fernanda.souza@tanksbr.com.br"),true);});
test("outro gerente ou diretor não administra",()=>assert.equal(isFernandaAdmin("diretor@tanksbr.com.br"),false));
test("usuário sem role não vê Admissão",()=>assert.equal(motivosPermitidos(null,false).includes("admissao"),false));
test("usuário sem role RH fica limitado aos motivos RH",()=>assert.deepEqual(motivosPermitidos(null,true),["admissao","desligamento","inicio_obra"]));
test("usuário sem role não ultrapassa prazo",()=>assert.ok(validar({role:null,dataIda:"2026-08-10"}).bloqueios.includes("FORA_DO_PRAZO")));
test("usuário sem role com justificativa continua bloqueado",()=>assert.ok(validar({role:null,dataIda:"2026-08-10",justificativa:"Justificativa suficientemente longa"}).bloqueios.includes("FORA_DO_PRAZO")));
test("somente gerente ou diretor real usa exceção",()=>{assert.equal(validar({role:"gerente",dataIda:"2026-08-10",solicitarExcecao:true,justificativa:"Justificativa suficientemente longa"}).bloqueios.length,0);assert.equal(validar({role:"diretor",dataIda:"2026-08-10",solicitarExcecao:true,justificativa:"Justificativa suficientemente longa"}).bloqueios.length,0);});
test("usuário comum não cria motivo null",()=>assert.ok(validar({motivo:null,role:"assistente",canUseAdministrativeNull:false}).bloqueios.includes("MOTIVO_ADMINISTRATIVO_NAO_PERMITIDO")));
test("administrativo autorizado cria motivo null",()=>assert.equal(validar({motivo:null,role:"coordenador",canUseAdministrativeNull:true}).bloqueios.length,0));
test("gerente e diretor obedecem à autorização existente para motivo null",()=>{assert.ok(validar({motivo:null,role:"gerente",canUseAdministrativeNull:false}).bloqueios.includes("MOTIVO_ADMINISTRATIVO_NAO_PERMITIDO"));assert.equal(validar({motivo:null,role:"diretor",canUseAdministrativeNull:true}).bloqueios.length,0);});

test("desligamento sem subtipo bloqueia",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:null}).bloqueios.includes("SUBTIPO_DESLIGAMENTO_OBRIGATORIO")));
test("justa causa exige Termo",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:"justa_causa",dataIda:"2026-08-03"}).bloqueios.includes("DOCUMENTO_INTERNO_OBRIGATORIO:termo_justa_causa")));
test("pedido exige Carta",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:"pedido_demissao",dataIda:"2026-08-03"}).bloqueios.includes("DOCUMENTO_INTERNO_OBRIGATORIO:carta_pedido_demissao")));
test("categoria incorreta não satisfaz justa causa",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:"justa_causa",documentos:[{categoria:"carta_pedido_demissao",mimeType:"application/pdf",tamanhoBytes:100}],dataIda:"2026-08-03"}).bloqueios.some((b)=>b.startsWith("DOCUMENTO_INTERNO_OBRIGATORIO"))));
test("arquivo não PDF bloqueia",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:"justa_causa",documentos:[{categoria:"termo_justa_causa",mimeType:"image/png",tamanhoBytes:100}],dataIda:"2026-08-03"}).bloqueios.includes("DOCUMENTO_NAO_PDF")));
test("arquivo acima de 10 MB bloqueia",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:"justa_causa",documentos:[{categoria:"termo_justa_causa",mimeType:"application/pdf",tamanhoBytes:10*1024*1024+1}],dataIda:"2026-08-03"}).bloqueios.includes("DOCUMENTO_TAMANHO_INVALIDO")));
test("gerente não dispensa documento",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:"justa_causa",role:"gerente",dataIda:"2026-08-03"}).bloqueios.some((b)=>b.startsWith("DOCUMENTO_INTERNO_OBRIGATORIO"))));

test("comum fora do prazo bloqueia",()=>assert.ok(validar({dataIda:"2026-08-10"}).bloqueios.includes("FORA_DO_PRAZO")));
test("gerente fora do prazo sem marcar exceção bloqueia",()=>assert.ok(validar({role:"gerente",dataIda:"2026-08-10"}).bloqueios.includes("EXCECAO_PRAZO_NAO_SOLICITADA")));
test("gerente com exceção e justificativa útil pode usar exceção",()=>assert.equal(validar({role:"gerente",dataIda:"2026-08-10",solicitarExcecao:true,justificativa:"Necessidade operacional urgente"}).bloqueios.length,0));
test("calendário incompleto não aceita exceção",()=>{const r=validar({motivo:"inicio_obra",role:"gerente",anos:[],dataIda:"2026-08-10",solicitarExcecao:true,justificativa:"Necessidade operacional urgente"});assert.ok(r.bloqueios.some((b)=>b.startsWith("CALENDARIO_INCOMPLETO")));assert.equal(r.permiteExcecao,false);});
test("data passada nunca aceita exceção",()=>assert.ok(validar({role:"diretor",dataIda:"2026-08-02",solicitarExcecao:true,justificativa:"Necessidade operacional urgente"}).bloqueios.includes("DATA_IDA_NO_PASSADO")));

test("primeiro embarque somente ida",()=>assert.equal(getPrimeiroEmbarque(["2026-08-10T10:00:00-03:00"]),"2026-08-10T10:00:00-03:00"));
test("primeiro embarque entre ida e volta",()=>assert.equal(getPrimeiroEmbarque(["2026-08-10T10:00:00-03:00","2026-08-20T10:00:00-03:00"]),"2026-08-10T10:00:00-03:00"));
test("primeiro embarque usa menor datetime em múltiplos trechos",()=>assert.equal(getPrimeiroEmbarque(["2026-08-12T10:00:00-03:00","2026-08-09T08:00:00-03:00","2026-08-10T07:00:00-03:00"]),"2026-08-09T08:00:00-03:00"));
test("mesmo dia permitido sem prazo",()=>assert.equal(validar({motivo:"desligamento",desligamentoSubtipo:"justa_causa",dataIda:"2026-08-03",documentos:[{categoria:"termo_justa_causa",mimeType:"application/pdf",tamanhoBytes:100}]}).bloqueios.length,0));
test("dia anterior bloqueado sem prazo",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:"pedido_demissao",dataIda:"2026-08-02",documentos:[{categoria:"carta_pedido_demissao",mimeType:"application/pdf",tamanhoBytes:100}]}).bloqueios.includes("DATA_IDA_NO_PASSADO")));

test("mudança de data recalcula prazo",()=>assert.notEqual(validar({dataIda:"2026-09-01"}).foraDoPrazo,validar({dataIda:"2026-08-10"}).foraDoPrazo));
test("mudança de motivo recalcula prazo",()=>assert.notEqual(validar({motivo:"ferias"}).regra.quantidade,validar({motivo:"recesso"}).regra.quantidade));
test("mudança de subtipo recalcula prazo",()=>assert.notEqual(validar({motivo:"desligamento",desligamentoSubtipo:"ma_conduta"}).regra.tipo,validar({motivo:"desligamento",desligamentoSubtipo:"justa_causa"}).regra.tipo));
test("justa causa para pedido exige nova categoria",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:"pedido_demissao",documentos:[{categoria:"termo_justa_causa",mimeType:"application/pdf",tamanhoBytes:100}],dataIda:"2026-08-03"}).bloqueios.some((b)=>b.includes("carta_pedido_demissao"))));

test("mensagem só aparece após motivo válido",()=>assert.equal(mensagemAntecedencia(null),null));
test("mensagem de férias é curta",()=>assert.equal(mensagemAntecedencia("ferias"),"Antecedência mínima: 25 dias corridos."));
test("mensagem de início de obra usa dias úteis",()=>assert.equal(mensagemAntecedencia("inicio_obra"),"Antecedência mínima: 5 dias úteis."));
test("mensagem de justa causa não exige antecedência",()=>assert.equal(mensagemAntecedencia("desligamento","justa_causa"),"Sem antecedência mínima."));
test("gerente só reduz o min ao marcar exceção",()=>{assert.equal(dataMinimaDoInput("2026-08-28","2026-08-03",true,false),"2026-08-28");assert.equal(dataMinimaDoInput("2026-08-28","2026-08-03",true,true),"2026-08-03");});
test("usuário comum nunca reduz o min",()=>assert.equal(dataMinimaDoInput("2026-08-28","2026-08-03",false,true),"2026-08-28"));
test("data abaixo do novo prazo é limpa",()=>assert.equal(limparDataIdaInvalida("2026-08-10","2026-08-28"),""));
test("registro histórico sem regra permanece representável",()=>assert.equal(regraPrazo("desligamento",null).quantidade,25));
test("edição relevante exige subtipo atual",()=>assert.ok(validar({motivo:"desligamento",desligamentoSubtipo:null}).bloqueios.includes("SUBTIPO_DESLIGAMENTO_OBRIGATORIO")));

test("labels de documentos são específicos",()=>{assert.equal(categoriaDocumento("justa_causa"),"termo_justa_causa");assert.equal(categoriaDocumento("pedido_demissao"),"carta_pedido_demissao");assert.equal(categoriaDocumento("ma_conduta"),null);});
test("validador real rejeita extensão não PDF",()=>assert.ok(validatePdfFile({name:"arquivo.png",type:"image/png",size:100})));
test("validador real rejeita arquivo acima de 10 MB",()=>assert.ok(validatePdfFile({name:"arquivo.pdf",type:"application/pdf",size:10*1024*1024+1})));
test("assinatura PDF válida é aceita",async()=>assert.equal(await validatePdfSignature(new Blob(["%PDF-1.7"])),null));
test("arquivo renomeado para PDF é rejeitado pela assinatura",async()=>assert.ok(await validatePdfSignature(new Blob(["MZ executable"]))));
test("update no mesmo ano invalida uma vez",()=>assert.deepEqual(calendarYearsToInvalidate("UPDATE","2026-01-10","2026-12-20"),[2026]));
test("update entre 2026 e 2027 invalida ambos",()=>assert.deepEqual(calendarYearsToInvalidate("UPDATE","2026-12-20","2027-01-10"),[2026,2027]));
test("delete invalida o ano antigo",()=>assert.deepEqual(calendarYearsToInvalidate("DELETE","2026-05-01",null),[2026]));
test("insert invalida o ano novo",()=>assert.deepEqual(calendarYearsToInvalidate("INSERT",null,"2027-05-01"),[2027]));
test("alteração de descrição conserva o mesmo ano incompleto",()=>assert.deepEqual(calendarYearsToInvalidate("UPDATE","2026-05-01","2026-05-01"),[2026]));
