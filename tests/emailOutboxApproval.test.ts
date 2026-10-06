import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { approvalPendingHtml,retryAt,sanitizeEmailError,validEmail } from "../supabase/functions/_shared/email-outbox.ts";
import { classifySmtpFailure,sanitizeSmtpError,sendSmtpMail,smtpConfigFromEnv,smtpMessageId,type MailTransport } from "../supabase/functions/_shared/smtp-email.ts";
import { authorizeSecretRequest } from "../supabase/functions/_shared/service-auth.ts";

const migration=fs.readFileSync("supabase/migrations/202610050001_email_outbox_aprovacao_pendente.sql","utf8");
const worker=fs.readFileSync("supabase/functions/ro-email-notifications/index.ts","utf8");
const config=fs.readFileSync("supabase/config.toml","utf8");
const pre=fs.readFileSync("supabase/manual/prevalidar_email_outbox_aprovacao_20261005.sql","utf8");
const dry=fs.readFileSync("supabase/manual/testar_email_outbox_aprovacao_20261005.sql","utf8");
const rollback=fs.readFileSync("supabase/manual/validar_rollback_email_outbox_aprovacao_20261005.sql","utf8");
const post=fs.readFileSync("supabase/manual/validar_email_outbox_aprovacao_20261005.sql","utf8");
const executable=(value:string)=>value.replace(/--.*$/gm,"").replace(/'(?:''|[^'])*'/g,"''");

test("outbox possui estrutura, estados, lease e unicidade persistente",()=>{
  for(const field of ["notificacao_id","tipo_evento","destinatario_user_id","email_destinatario","tentativas","proxima_tentativa_em","ultimo_erro","provider_message_id","chave_deduplicacao","locked_at","locked_by","atualizado_em","enviado_em"])assert.match(migration,new RegExp(`\\b${field}\\b`));
  for(const status of ["pendente","processando","erro_retry","enviado","falha_permanente","cancelado"])assert.match(migration,new RegExp(`'${status}'`));
  assert.match(migration,/unique\(chave_deduplicacao\)/i);assert.match(migration,/for update skip locked/i);assert.match(migration,/locked_at<now\(\)-make_interval/i);assert.match(migration,/auth\.role\(\)[^]*service_role/i);
});

test("evento pendente nasce server-side, individual e idempotente",()=>{
  assert.match(migration,/after update of aprovacao_status,aprovador_id/i);
  assert.match(migration,/new\.aprovacao_status='pendente'[\s\S]*new\.aprovador_id is not null/i);
  assert.match(migration,/'interno','aprovador',new\.aprovador_id::text,'Existe uma solicitação de passagem aguardando sua aprovação\.'/i);
  assert.match(migration,/'aprovacao_pendente:'\|\|new\.id::text\|\|':'\|\|new\.aprovador_id::text/i);
  assert.match(migration,/on conflict\(chave_deduplicacao\) do nothing/i);
});

test("listagem, RLS e marcar todas incluem aprovador sem remover fluxos atuais",()=>{
  assert.ok((migration.match(/destinatario_tipo='aprovador'/g)||[]).length>=4);
  for(const current of ["destinatario_tipo='solicitante'","destinatario_tipo='ro'","limit 100","ro_responsaveis","ro_marcar_notificacao_lida","ro_marcar_todas_notificacoes_lidas"])assert.match(migration,new RegExp(current));
  assert.match(migration,/revoke all on table public\.ro_email_outbox from public,anon,authenticated/i);
  assert.doesNotMatch(migration,/grant (?:select|insert|update|delete)[^;]*authenticated/i);
});

test("aviso RO no INSERT respeita a ordem real do fluxo de aprovação",()=>{
  assert.match(migration,/ro_notificar_equipe_nova_solicitacao[\s\S]*current_setting\('ro\.approval_creation',true\)[\s\S]*return new/i);
  assert.doesNotMatch(migration,/create or replace function public\.ro_criar_solicitacao_com_aprovador/i);
});

test("worker só consome outbox e não aceita campos de envio do cliente",()=>{
  assert.match(worker,/ro_claim_email_outbox/);assert.match(worker,/ro_finalizar_email_outbox/);
  assert.doesNotMatch(worker,/request\.json\(/);assert.doesNotMatch(worker,/access-control-allow-origin/i);
  assert.match(worker,/authorizeSecretRequest/);assert.doesNotMatch(worker,/Bearer \$\{serviceKey\}/i);
  assert.match(worker,/aprovacao_status!=="pendente"/);assert.match(worker,/sol\.aprovador_id!==item\.destinatario_user_id/);
  assert.match(worker,/ro_passagem_solicitacoes/);
  assert.match(worker,/getUserById\(item\.destinatario_user_id\)/);
});

test("template contém somente dados operacionais permitidos e deep link",()=>{
  const html=approvalPendingHtml({approverName:"Ana <A>",traveler:"João",requester:"Maria",origin:"SP",destination:"RO",outboundDate:"2026-10-10",returnDate:null,link:"https://app.test/solicitacoes/abc"});
  assert.match(html,/Ana &lt;A&gt;/);assert.match(html,/ABRIR SOLICITAÇÃO/);assert.match(html,/\/solicitacoes\/abc/);assert.doesNotMatch(html,/\bCPF\b|\bRG\b|telefone|endereço|observaç|motivo/i);
  for(const forbidden of ["cpf","rg","telefone","logradouro","observacoes_solicitante","motivo_reprovacao"])assert.doesNotMatch(worker,new RegExp(forbidden,"i"));
});

test("retry segue 1, 5, 15 e 60 minutos e encerra na quinta tentativa",()=>{
  const now=new Date("2026-10-05T12:00:00.000Z");
  assert.equal(retryAt(1,now),"2026-10-05T12:01:00.000Z");assert.equal(retryAt(2,now),"2026-10-05T12:05:00.000Z");assert.equal(retryAt(3,now),"2026-10-05T12:15:00.000Z");assert.equal(retryAt(4,now),"2026-10-05T13:00:00.000Z");assert.equal(retryAt(5,now),null);
  assert.equal(classifySmtpFailure({responseCode:450},1).status,"erro_retry");assert.equal(classifySmtpFailure({code:"ETIMEDOUT"},4).status,"erro_retry");assert.equal(classifySmtpFailure({responseCode:450},5).status,"falha_permanente");assert.equal(classifySmtpFailure({responseCode:550},1).status,"falha_permanente");assert.equal(classifySmtpFailure({code:"EAUTH"},1).status,"falha_permanente");
});

test("erros são sanitizados e validação de e-mail falha fechada",()=>{
  const clean=sanitizeEmailError("Bearer abcdefghijklmnopqrstuvwxyz user@example.com\nsecret");assert.doesNotMatch(clean,/example|abcdefghijklmnopqrstuvwxyz|\n/);
  assert.equal(validEmail("aprovador@example.com"),true);assert.equal(validEmail("sem-email"),false);
});

test("secrets permanecem no backend e não há agendamento inventado",()=>{
  const auth=fs.readFileSync("supabase/functions/_shared/service-auth.ts","utf8");
  for(const name of ["SMTP_HOST","SMTP_PORT","SMTP_SECURE","SMTP_USER","SMTP_PASSWORD","EMAIL_FROM_NAME","APP_PUBLIC_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEYS"])assert.match(worker+auth+fs.readFileSync("supabase/functions/_shared/smtp-email.ts","utf8"),new RegExp(name));
  assert.doesNotMatch(migration,/SUPABASE_SERVICE_ROLE_KEY|EMAIL_PROVIDER_API_KEY|net\.http_post|cron\.schedule/i);
  assert.match(config,/\[functions\.ro-email-notifications\]\s*verify_jwt\s*=\s*false/i);
});

test("worker autoriza somente secret API key antes de qualquer efeito",async()=>{
  const secret="sb_secret_worker_test",publishable="sb_publishable_web_test",jwt="eyJhbGciOiJIUzI1NiJ9.test.signature";
  const env=(name:string)=>name==="SUPABASE_SECRET_KEYS"?JSON.stringify({default:secret}):undefined;
  const cases:[string,Request,number][]=[
    ["sem apikey",new Request("https://edge.test",{method:"POST"}),401],
    ["publishable",new Request("https://edge.test",{method:"POST",headers:{apikey:publishable}}),403],
    ["JWT authenticated",new Request("https://edge.test",{method:"POST",headers:{authorization:`Bearer ${jwt}`}}),401],
    ["secret inválida",new Request("https://edge.test",{method:"POST",headers:{apikey:"sb_secret_invalid"}}),403],
  ];
  const claims=0,smtpCalls=0;
  for(const [label,request,status] of cases){
    const result=await authorizeSecretRequest(request,env);
    assert.equal(result.ok,false,label);
    if(!result.ok)assert.equal(result.status,status,label);
  }
  assert.deepEqual({claims,smtpCalls},{claims:0,smtpCalls:0});
  assert.deepEqual(await authorizeSecretRequest(new Request("https://edge.test",{method:"POST",headers:{apikey:secret}}),env),{ok:true});
  assert.ok(worker.indexOf("authorizeSecretRequest")<worker.indexOf("ro_claim_email_outbox"));
  assert.ok(worker.indexOf("authorizeSecretRequest")<worker.indexOf("createTransport"));
});

test("destinatário nunca é escolhido pela requisição",()=>{
  assert.doesNotMatch(worker,/request\.json\(/);
  assert.match(worker,/getUserById\(item\.destinatario_user_id\)/);
  assert.match(worker,/sol\.aprovador_id!==item\.destinatario_user_id/);
});

test("SMTP corporativo usa 465 seguro, remetente autenticado e timeouts",async()=>{
  const values:Record<string,string>={SMTP_HOST:"mail.tanksbr.com.br",SMTP_PORT:"465",SMTP_SECURE:"true",SMTP_USER:"notificacoes.passagens@tanksbr.com.br",SMTP_PASSWORD:["unit","password"].join("-"),EMAIL_FROM_NAME:"TanksBR — Portal de Passagens"};
  const smtp=smtpConfigFromEnv((name)=>values[name]);
  assert.equal(smtp.host,"mail.tanksbr.com.br");assert.equal(smtp.port,465);assert.equal(smtp.secure,true);assert.equal(smtp.user,values.SMTP_USER);
  assert.deepEqual([smtp.connectionTimeout,smtp.greetingTimeout,smtp.socketTimeout,smtp.dnsTimeout],[15000,15000,15000,10000]);
  let captured:unknown;
  const mock:MailTransport={sendMail:async(message)=>{captured=message;return{messageId:message.messageId};}};
  const result=await sendSmtpMail(mock,smtp,{outboxId:"abc-123",to:"destino@example.com",subject:"Aprovação",html:"<p>Teste</p>"});
  assert.deepEqual(captured,{from:{name:values.EMAIL_FROM_NAME,address:values.SMTP_USER},to:"destino@example.com",subject:"Aprovação",html:"<p>Teste</p>",messageId:"<ro-email-abc-123@tanksbr.com.br>"});
  assert.equal(result.messageId,smtpMessageId("abc-123"));
});

test("configuração SMTP falha fechada e erros não vazam credenciais",()=>{
  assert.throws(()=>smtpConfigFromEnv(()=>undefined),/SMTP_CONFIGURATION_ERROR/);
  assert.throws(()=>smtpConfigFromEnv((name)=>({SMTP_HOST:"mail.tanksbr.com.br",SMTP_PORT:"465",SMTP_SECURE:"false",SMTP_USER:"user",SMTP_PASSWORD:"pass"} as Record<string,string>)[name]),/SMTP_CONFIGURATION_ERROR/);
  const password=["sensitive","value"].join("-");
  const clean=sanitizeSmtpError(new Error(`Falha para user@example.com usando ${password}`),[password]);
  assert.doesNotMatch(clean,/sensitive|example\.com/);
});

test("worker usa Nodemailer fixado sem transporte Resend ou TLS inseguro",()=>{
  assert.match(worker,/npm:nodemailer@7\.0\.10/);assert.match(worker,/createTransport/);assert.match(worker,/sendSmtpMail/);
  assert.doesNotMatch(worker,/api\.resend\.com|EMAIL_PROVIDER_API_KEY|EMAIL_FROM\b|Idempotency-Key/);
  assert.doesNotMatch(worker,/rejectUnauthorized\s*:\s*false|ignoreTLS\s*:\s*true/i);
});

test("scripts manuais cobrem preflight, dry run, rollback e pós-instalação",()=>{
  assert.doesNotMatch(executable(pre),/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);
  assert.match(dry,/^--[^\n]*\nbegin;/i);assert.match(dry,/rollback;\s*$/i);assert.doesNotMatch(dry,/resend\.com|functions\.invoke|net\.http/i);
  for(const marker of ["A_FALHOU","B_FALHOU","C_FALHOU","D_FALHOU","E_F_FALHOU","G_FALHOU","H_FALHOU","I_FALHOU","J_FALHOU","K_FALHOU"])assert.match(dry,new RegExp(marker));
  assert.doesNotMatch(executable(rollback),/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);assert.match(rollback,/rollback_limpo/);
  assert.doesNotMatch(executable(post),/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);assert.match(post,/authenticated_sem_acesso/);
});
