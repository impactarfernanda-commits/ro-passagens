-- Impede duas notificações RO simultâneas ou concluídas para o mesmo destinatário.
create unique index if not exists ro_email_logs_notificacao_ro_unique_idx
  on public.ro_email_logs (solicitacao_id, tipo_evento, destinatario_user_id)
  where tipo_evento = 'nova_solicitacao_ro'
    and destinatario_user_id is not null
    and status in ('pendente', 'enviado');
