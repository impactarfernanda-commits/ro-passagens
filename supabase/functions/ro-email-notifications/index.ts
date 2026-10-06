import { createClient } from "https://esm.sh/@supabase/supabase-js@2.52.0";
import nodemailer from "npm:nodemailer@7.0.10";
import { approvalPendingHtml,validEmail } from "../_shared/email-outbox.ts";
import { classifySmtpFailure,sanitizeSmtpError,sendSmtpMail,smtpConfigFromEnv,type MailTransport,type SmtpFailure } from "../_shared/smtp-email.ts";
import { authorizeSecretRequest } from "../_shared/service-auth.ts";

type OutboxRow={id:string;solicitacao_id:string;tipo_evento:"aprovacao_pendente";destinatario_user_id:string;assunto:string;tentativas:number};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

Deno.serve(async(request)=>{
  if(request.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  const authorization=await authorizeSecretRequest(request,(name)=>Deno.env.get(name));
  if(!authorization.ok)return json({error:authorization.error},authorization.status);
  const supabaseUrl=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appUrl=(Deno.env.get("APP_PUBLIC_URL")||"").replace(/\/$/,"");
  if(!supabaseUrl||!serviceKey)return json({error:"SERVER_CONFIGURATION_ERROR"},500);
  let smtp;
  try{smtp=smtpConfigFromEnv((name)=>Deno.env.get(name));}catch{return json({error:"EMAIL_CONFIGURATION_ERROR"},500);}
  if(!appUrl)return json({error:"EMAIL_CONFIGURATION_ERROR"},500);
  const transport:MailTransport=nodemailer.createTransport({
    host:smtp.host,port:smtp.port,secure:smtp.secure,
    auth:{user:smtp.user,pass:smtp.password},
    connectionTimeout:smtp.connectionTimeout,greetingTimeout:smtp.greetingTimeout,
    socketTimeout:smtp.socketTimeout,dnsTimeout:smtp.dnsTimeout,pool:false,
  });
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}),workerId=`email-worker:${crypto.randomUUID()}`;
  const {data:claimed,error:claimError}=await admin.rpc("ro_claim_email_outbox",{p_worker_id:workerId,p_limite:10,p_lease_segundos:300});
  if(claimError)return json({error:"OUTBOX_CLAIM_FAILED"},500);
  const results:Array<{id:string;status:string}>=[];
  for(const item of(claimed||[])as OutboxRow[]){
    const finish=(status:string,email:string|null=null,providerId:string|null=null,error:string|null=null,next:string|null=null)=>admin.rpc("ro_finalizar_email_outbox",{p_id:item.id,p_worker_id:workerId,p_status:status,p_email:email,p_provider_message_id:providerId,p_ultimo_erro:error,p_proxima_tentativa_em:next});
    if(item.tipo_evento!=="aprovacao_pendente"){await finish("falha_permanente",null,null,"Tipo de evento não suportado");continue;}
    const {data:sol}=await admin.from("ro_passagem_solicitacoes").select("id,solicitante_id,aprovador_id,aprovacao_status,excluida_em,funcionario_id,colaborador_id,viajante_nome_informado,origem,destino,data_ida,data_retorno").eq("id",item.solicitacao_id).maybeSingle();
    if(!sol||sol.excluida_em||sol.aprovacao_status!=="pendente"||sol.aprovador_id!==item.destinatario_user_id){await finish("cancelado",null,null,"Evento não está mais pendente");results.push({id:item.id,status:"cancelado"});continue;}
    const userResult=await admin.auth.admin.getUserById(item.destinatario_user_id),recipient=userResult.data.user as typeof userResult.data.user&{banned_until?:string};
    if(!recipient||recipient.deleted_at||(recipient.banned_until&&new Date(recipient.banned_until)>new Date())||!validEmail(recipient.email)){await finish("falha_permanente",null,null,"Destinatário indisponível ou sem e-mail válido");results.push({id:item.id,status:"falha_permanente"});continue;}
    const email=recipient.email.trim().toLowerCase();
    const [{data:approverProfile},{data:requesterProfile},{data:traveler},{data:privateTraveler}]=await Promise.all([
      admin.from("users_profiles").select("full_name").eq("id",item.destinatario_user_id).maybeSingle(),
      admin.from("users_profiles").select("full_name").eq("id",sol.solicitante_id).maybeSingle(),
      sol.funcionario_id?admin.from("funcionarios").select("nome").eq("id",sol.funcionario_id).maybeSingle():Promise.resolve({data:null}),
      sol.colaborador_id?admin.from("ro_funcionarios_enderecos_privados").select("nome").eq("id",sol.colaborador_id).maybeSingle():Promise.resolve({data:null}),
    ]);
    const html=approvalPendingHtml({approverName:approverProfile?.full_name||recipient.user_metadata?.full_name||"Aprovador",traveler:sol.viajante_nome_informado||privateTraveler?.nome||traveler?.nome||null,requester:requesterProfile?.full_name||null,origin:sol.origem,destination:sol.destino,outboundDate:sol.data_ida,returnDate:sol.data_retorno,link:`${appUrl}/solicitacoes/${sol.id}`});
    try{
      const sent=await sendSmtpMail(transport,smtp,{outboxId:item.id,to:email,subject:item.assunto,html});
      const providerId=sent.messageId||null;
      await finish("enviado",email,providerId);await admin.from("ro_email_logs").insert({solicitacao_id:sol.id,tipo_evento:item.tipo_evento,canal:"email",destinatario_tipo:"aprovador",destinatario_user_id:item.destinatario_user_id,destinatario_email:email,assunto:item.assunto,status:"enviado",provider_message_id:providerId,enviado_em:new Date().toISOString(),payload:{outbox_id:item.id,tentativa:item.tentativas}});results.push({id:item.id,status:"enviado"});
    }catch(error){const decision=classifySmtpFailure(error as SmtpFailure,item.tentativas),message=sanitizeSmtpError(error,[smtp.password,smtp.user]);await finish(decision.status,email,null,message,decision.next);await admin.from("ro_email_logs").insert({solicitacao_id:sol.id,tipo_evento:item.tipo_evento,canal:"email",destinatario_tipo:"aprovador",destinatario_user_id:item.destinatario_user_id,destinatario_email:email,assunto:item.assunto,status:"erro",erro:message,payload:{outbox_id:item.id,tentativa:item.tentativas}});results.push({id:item.id,status:decision.status});}
  }
  return json({ok:true,processed:results.length,results});
});
