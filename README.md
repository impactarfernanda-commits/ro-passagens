# RO Passagens

Sistema independente para solicitação, compra e controle de custos de deslocamentos de campo. Usa o mesmo projeto Supabase do Obras Control, sem fazer parte dele e sem alterar suas telas ou dados.

## Configuração local

1. Copie `.env.example` para `.env.local`.
2. Preencha `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_SUPABASE_PROJECT_ID` com os mesmos valores públicos do Obras Control. Não use `service_role`.
3. Aplique `supabase/migrations/202607170001_create_ro_passagens.sql` no mesmo projeto Supabase (CLI ou SQL Editor).
4. Execute `npm install` e `npm run dev`.

O app foi alinhado ao schema compartilhado atual: `funcionarios` usa `id`, `nome` e `deleted_at`; `obras` usa `id` e `nome`; `users_profiles` usa `id` e `full_name`; e `user_roles` usa `user_id` e `role`.

## PDFs de passagens

As migrations `202607170003_ro_passagem_anexos.sql` e `202607170004_multiple_passage_pdfs.sql` criam o bucket privado `ro-passagem-anexos`, a tabela de metadados, as políticas e os campos de partida, valor e observação. Cada solicitação aceita múltiplos PDFs de até 10 MB. A leitura tenta extrair somente partida e valor da camada textual, sem OCR; documentos digitalizados como imagem devem ser preenchidos manualmente. O custo de passagem permanece detalhado por PDF e o total é calculado pela soma desses itens.

## Segurança

As novas tabelas têm RLS. Solicitantes veem seus próprios pedidos; responsáveis RO, gerentes e diretores veem e processam todos. Apenas gerente/diretor administra responsáveis RO. A compra é transacional e a regra de não notificar funcionário em desligamentos é aplicada no banco.
