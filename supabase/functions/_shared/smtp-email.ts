import { MAX_EMAIL_ATTEMPTS,retryAt,sanitizeEmailError,type OutboxStatus } from "./email-outbox.ts";

export type SmtpConfig={host:string;port:number;secure:true;user:string;password:string;fromName:string;connectionTimeout:number;greetingTimeout:number;socketTimeout:number;dnsTimeout:number};
export type SmtpFailure={code?:string;responseCode?:number;command?:string;message?:string};

export function smtpConfigFromEnv(get:(name:string)=>string|undefined):SmtpConfig{
  const host=(get("SMTP_HOST")||"").trim(),port=Number(get("SMTP_PORT")),secure=get("SMTP_SECURE")==="true";
  const user=(get("SMTP_USER")||"").trim(),password=get("SMTP_PASSWORD")||"",fromName=(get("EMAIL_FROM_NAME")||"").trim()||"TanksBR — Portal de Passagens";
  if(!host||!Number.isInteger(port)||port<1||port>65535||!secure||!user||!password)throw new Error("SMTP_CONFIGURATION_ERROR");
  return{host,port,secure:true,user,password,fromName,connectionTimeout:15_000,greetingTimeout:15_000,socketTimeout:15_000,dnsTimeout:10_000};
}

export function smtpMessageId(outboxId:string):string{return `<ro-email-${outboxId}@tanksbr.com.br>`;}

export function classifySmtpFailure(error:SmtpFailure,attempts:number):{status:OutboxStatus;next:string|null}{
  const code=String(error.code||"").toUpperCase(),responseCode=Number(error.responseCode||0);
  const transient=responseCode>=400&&responseCode<500||["ETIMEDOUT","ECONNECTION","ECONNRESET","ECONNREFUSED","EAI_AGAIN","ESOCKET"].includes(code);
  const next=transient&&attempts<MAX_EMAIL_ATTEMPTS?retryAt(attempts):null;
  return{status:next?"erro_retry":"falha_permanente",next};
}

export function sanitizeSmtpError(error:unknown,secrets:string[]):string{
  let sanitized=sanitizeEmailError(error);
  for(const secret of secrets.filter(Boolean))sanitized=sanitized.split(secret).join("[redacted]");
  return sanitized;
}

export type MailTransport={sendMail(message:{from:{name:string;address:string};to:string;subject:string;html:string;messageId:string}):Promise<{messageId?:string}>};

export function sendSmtpMail(
  transport:MailTransport,
  config:SmtpConfig,
  message:{outboxId:string;to:string;subject:string;html:string},
):Promise<{messageId?:string}>{
  return transport.sendMail({
    from:{name:config.fromName,address:config.user},
    to:message.to,
    subject:message.subject,
    html:message.html,
    messageId:smtpMessageId(message.outboxId),
  });
}
