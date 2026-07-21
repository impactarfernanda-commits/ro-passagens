import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.52.0';

type EventType='nova_solicitacao_ro'|'passagem_comprada_solicitante';
type Payload={tipo_evento:EventType;solicitacao_id:string;anexo_ids?:string[]};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
const labelMotivo=(value:string)=>({ferias:'Férias',folga_campo:'Folga de campo',desligamento:'Desligamento',transferencia_obra:'Transferência de obra',viagem_diretoria:'Viagem diretoria'}[value]||value);
const formatDate=(value?:string|null)=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:value.includes('T')?'short':undefined,timeZone:'America/Sao_Paulo'}).format(new Date(value.includes('T')?value:`${value}T12:00:00-03:00`)):'—';
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'}});
  if(request.method!=='POST')return json({error:'Método não permitido'},405);
  const supabaseUrl=Deno.env.get('SUPABASE_URL');const anonKey=Deno.env.get('SUPABASE_ANON_KEY');const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey=Deno.env.get('EMAIL_PROVIDER_API_KEY');const emailFrom=Deno.env.get('EMAIL_FROM');const fromName=Deno.env.get('EMAIL_FROM_NAME')||'RO Passagens';const appUrl=(Deno.env.get('APP_PUBLIC_URL')||'').replace(/\/$/,'');
  if(!supabaseUrl||!anonKey||!serviceKey)return json({error:'Configuração Supabase ausente'},500);
  const authorization=request.headers.get('authorization')||'';
  const authClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}}});const {data:{user}}=await authClient.auth.getUser();
  if(!user)return json({error:'Não autenticado'},401);
  let payload:Payload;try{payload=await request.json()}catch{return json({error:'Payload inválido'},400)}
  if(!['nova_solicitacao_ro','passagem_comprada_solicitante'].includes(payload.tipo_evento)||!/^[0-9a-f-]{36}$/i.test(payload.solicitacao_id))return json({error:'Payload inválido'},400);
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:sol,error:solError}=await admin.from('ro_passagem_solicitacoes').select('*,funcionario:funcionarios(id,nome),obra:obras!ro_passagem_solicitacoes_obra_id_fkey(id,nome)').eq('id',payload.solicitacao_id).single();
  if(solError||!sol)return json({error:'Solicitação não encontrada'},404);
  const {data:canOperate}=await authClient.rpc('ro_can_operate');
  if(payload.tipo_evento==='nova_solicitacao_ro'&&sol.solicitante_id!==user.id&&!canOperate)return json({error:'Sem permissão'},403);
  if(payload.tipo_evento==='passagem_comprada_solicitante'&&!canOperate)return json({error:'Sem permissão'},403);
  const insertLog=async(values:Record<string,unknown>)=>admin.from('ro_email_logs').insert({solicitacao_id:sol.id,tipo_evento:payload.tipo_evento,canal:'email',payload:{anexo_ids:payload.anexo_ids||[]},...values});
  if(sol.motivo==='viagem_diretoria'){await insertLog({destinatario_tipo:payload.tipo_evento==='nova_solicitacao_ro'?'ro':'solicitante',destinatario_user_id:payload.tipo_evento==='passagem_comprada_solicitante'?sol.solicitante_id:null,status:'ignorado',erro:'Viagem diretoria não envia e-mail externo.'});return json({ok:true,ignored:true})}
  if(payload.tipo_evento==='nova_solicitacao_ro'){const {data:existing}=await admin.from('ro_email_logs').select('id').eq('solicitacao_id',sol.id).eq('tipo_evento',payload.tipo_evento).in('status',['pendente','enviado']).limit(1);if(existing?.length)return json({ok:true,duplicate:true})}
  if(!resendKey||!emailFrom){await insertLog({destinatario_tipo:payload.tipo_evento==='nova_solicitacao_ro'?'ro':'solicitante',status:'erro',erro:'Secrets EMAIL_PROVIDER_API_KEY/EMAIL_FROM não configuradas.'});return json({error:'Provedor de e-mail não configurado'},502)}
  const userIds:string[]=payload.tipo_evento==='nova_solicitacao_ro'?(await admin.from('ro_responsaveis').select('user_id').eq('ativo',true)).data?.map(item=>item.user_id)||[]:[sol.solicitante_id];
  const {data:users}=await admin.auth.admin.listUsers({page:1,perPage:1000});const userMap=new Map(users?.users.map(item=>[item.id,item]));
  const requester=userMap.get(sol.solicitante_id);const responsible=sol.responsavel_ro_id?userMap.get(sol.responsavel_ro_id):null;
  const {data:costs}=await admin.from('ro_passagem_custos').select('valor').eq('solicitacao_id',sol.id);const total=(costs||[]).reduce((sum,item)=>sum+Number(item.valor||0),0);
  const attachments:{filename:string;content:string}[]=[];let attachmentWarning='';
  if(payload.tipo_evento==='passagem_comprada_solicitante'){
    let query=admin.from('ro_passagem_anexos').select('id,nome_arquivo,storage_path').eq('solicitacao_id',sol.id);if(payload.anexo_ids?.length)query=query.in('id',payload.anexo_ids);
    const {data:files}=await query;for(const file of files||[]){const {data,error}=await admin.storage.from('ro-passagem-anexos').download(file.storage_path);if(error||!data){attachmentWarning+=`Falha ao baixar ${file.nome_arquivo}. `;continue}const bytes=new Uint8Array(await data.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));attachments.push({filename:file.nome_arquivo,content:btoa(binary)})}
  }
  const results=[];for(const userId of userIds){const recipient=userMap.get(userId);const recipientType=payload.tipo_evento==='nova_solicitacao_ro'?'ro':'solicitante';if(!recipient?.email){await insertLog({destinatario_tipo:recipientType,destinatario_user_id:userId,status:'ignorado',erro:'Usuário sem e-mail.'});results.push({userId,status:'ignorado'});continue}
    const subject=payload.tipo_evento==='nova_solicitacao_ro'?`Nova solicitação de passagem - ${sol.funcionario?.nome||''}`:`Passagem comprada - ${sol.funcionario?.nome||''}`;
    const fields=payload.tipo_evento==='nova_solicitacao_ro'?[['Funcionário',sol.funcionario?.nome],['Motivo',labelMotivo(sol.motivo)],['Centro de custo atual',sol.obra?.nome],['Data de ida',formatDate(sol.data_ida)],['Data de retorno',sol.data_retorno?formatDate(sol.data_retorno):'Não informada'],['Solicitante',requester?.user_metadata?.full_name||requester?.email],['Status',sol.status]]:[['Funcionário',sol.funcionario?.nome],['Motivo',labelMotivo(sol.motivo)],['Centro de custo atual',sol.obra?.nome],['Partida',formatDate(sol.partida_em)],['Valor total',new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(total)],['Responsável RO',responsible?.user_metadata?.full_name||responsible?.email],['Observações',sol.observacoes_ro||'—']];
    const html=`<h2>${escapeHtml(subject)}</h2><p>${payload.tipo_evento==='nova_solicitacao_ro'?'Nova solicitação de passagem registrada.':'A passagem foi comprada.'}</p><table>${fields.map(([key,value])=>`<tr><td><strong>${escapeHtml(key)}</strong></td><td>${escapeHtml(value||'—')}</td></tr>`).join('')}</table><p><a href="${escapeHtml(`${appUrl}/solicitacoes/${sol.id}`)}">Abrir solicitação no RO Passagens</a></p>`;
    const {data:log}=await admin.from('ro_email_logs').insert({solicitacao_id:sol.id,tipo_evento:payload.tipo_evento,canal:'email',destinatario_tipo:recipientType,destinatario_user_id:userId,destinatario_email:recipient.email,assunto:subject,status:'pendente',payload:{anexo_ids:payload.anexo_ids||[],attachment_warning:attachmentWarning}}).select('id').single();
    try{const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${resendKey}`,'content-type':'application/json'},body:JSON.stringify({from:`${fromName} <${emailFrom}>`,to:[recipient.email],subject,html,attachments})});const provider=await response.json();if(!response.ok)throw new Error(provider?.message||`Resend HTTP ${response.status}`);await admin.from('ro_email_logs').update({status:'enviado',provider_message_id:provider.id,enviado_em:new Date().toISOString(),erro:attachmentWarning||null}).eq('id',log?.id);results.push({userId,status:'enviado'})}catch(error){await admin.from('ro_email_logs').update({status:'erro',erro:(error instanceof Error?error.message:String(error))+(attachmentWarning?` ${attachmentWarning}`:'')}).eq('id',log?.id);results.push({userId,status:'erro'})}
  }
  return json({ok:results.every(item=>item.status!=='erro'),results},results.some(item=>item.status==='erro')?502:200);
});
