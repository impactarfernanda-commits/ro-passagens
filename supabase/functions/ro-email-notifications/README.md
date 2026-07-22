# ro-email-notifications

> Função mantida para uma etapa futura. O Portal não a chama automaticamente e
> não precisa de secrets de e-mail para criar solicitações ou registrar compras.

Secrets obrigatórias: `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` e `APP_PUBLIC_URL`.
As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo ambiente Supabase.

```powershell
supabase secrets set EMAIL_PROVIDER_API_KEY="re_..." EMAIL_FROM="passagens@seudominio.com" EMAIL_FROM_NAME="RO Passagens" APP_PUBLIC_URL="https://seu-app.vercel.app"
supabase functions deploy ro-email-notifications
```
