# ro-email-notifications

Secrets obrigatórias: `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` e `APP_PUBLIC_URL`.
As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo ambiente Supabase.

```powershell
supabase secrets set EMAIL_PROVIDER_API_KEY="..."
supabase secrets set EMAIL_FROM="..."
supabase secrets set EMAIL_FROM_NAME="Portal Tanks BR"
supabase secrets set APP_PUBLIC_URL="https://portal-tks-br.vercel.app"
supabase functions deploy ro-email-notifications
```

Depois do deploy, crie uma nova solicitação que não seja histórica do tipo
`viagem_diretoria`. Confirme o recebimento pelos responsáveis RO ativos e consulte
`public.ro_email_logs` para verificar os registros `enviado`, `ignorado` ou `erro`.
