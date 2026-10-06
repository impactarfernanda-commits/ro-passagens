# ro-email-notifications

Worker interno da outbox `public.ro_email_outbox`, transportado pelo SMTP
corporativo com Nodemailer. Nesta fase consome somente `aprovacao_pendente`;
não aceita destinatário, assunto, HTML ou solicitação no payload. A invocação
exige uma secret API key no header `apikey`.

Secrets obrigatórias: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASSWORD`, `EMAIL_FROM_NAME` e `APP_PUBLIC_URL`.
As variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo ambiente Supabase.

`SMTP_USER` também é o endereço remetente. Nunca versione `SMTP_PASSWORD`.
Porta 465 exige `SMTP_SECURE=true`; a validação TLS permanece ativa.

O repositório não contém Supabase Cron/pg_cron/pg_net ou Vercel Cron já
configurado. Após aplicar a migration e publicar a função, configure externamente
uma chamada periódica `POST` autenticada pelo header `apikey` com uma das chaves
de `SUPABASE_SECRET_KEYS`, sem payload de evento. Chaves publishable/anon e JWTs
de usuário não autorizam o worker. Não versione a chave secreta nem a URL em SQL.

SMTP não oferece uma chave de idempotência equivalente à API HTTP anterior.
O worker usa um `Message-ID` determinístico por outbox, além da chave única do
evento, claim/lease e retry controlado. Ainda existe uma janela residual: o
servidor pode aceitar a mensagem e o processo falhar antes da confirmação no
banco; nesse caso, um retry pode reenviar a entrega.
