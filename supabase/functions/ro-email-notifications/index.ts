import { createClient } from "https://esm.sh/@supabase/supabase-js@2.52.0";

type EventType = "nova_solicitacao_ro" | "passagem_comprada_solicitante";
type Payload = { tipo_evento: EventType; solicitacao_id: string; anexo_ids?: string[] };
type EmailStatus = "pendente" | "enviado" | "erro" | "ignorado";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,apikey,content-type,x-client-info" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: value.includes("T") ? "short" : undefined, timeZone: "America/Sao_Paulo" }).format(new Date(value.includes("T") ? value : `${value}T12:00:00-03:00`)) : "—";
const labelMotivo = (value?: string | null) => value ? ({ ferias: "Férias", folga_campo: "Folga de campo", desligamento: "Desligamento", transferencia_obra: "Transferência de obra", admissao: "Admissão", inicio_obra: "Início na obra", retorno_obra: "Retorno à obra", viagem_diretoria: "Viagem diretoria" }[value] || value) : "Não se aplica";
const centroLabel = (centro?: { codigo?: string | null; nome?: string | null; descricao?: string | null } | null) => {
  if (!centro) return "—";
  const nome = (centro.nome || centro.descricao || "").trim().toLocaleUpperCase("pt-BR");
  return centro.codigo?.trim() ? `${centro.codigo.trim()} - ${nome}` : nome || "—";
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("EMAIL_PROVIDER_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM");
  const fromName = Deno.env.get("EMAIL_FROM_NAME") || "Portal Tanks BR";
  const appUrl = (Deno.env.get("APP_PUBLIC_URL") || "").replace(/\/$/, "");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Configuração Supabase ausente" }, 500);

  const authorization = request.headers.get("authorization") || "";
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return json({ error: "Não autenticado" }, 401);

  let payload: Payload;
  try { payload = await request.json(); } catch { return json({ error: "Payload inválido" }, 400); }
  if (!["nova_solicitacao_ro", "passagem_comprada_solicitante"].includes(payload.tipo_evento) || !/^[0-9a-f-]{36}$/i.test(payload.solicitacao_id)) return json({ error: "Payload inválido" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sol, error: solError } = await admin.from("ro_passagem_solicitacoes").select("*,funcionario:funcionarios(id,nome),obra:obras!ro_passagem_solicitacoes_obra_id_fkey(id,nome,codigo,descricao),centro_destino:obras!ro_passagem_solicitacoes_centro_custo_destino_id_fkey(id,nome,codigo,descricao),centro_retorno:obras!ro_passagem_solicitacoes_centro_custo_retorno_id_fkey(id,nome,codigo,descricao)").eq("id", payload.solicitacao_id).single();
  if (solError || !sol) return json({ error: "Solicitação não encontrada" }, 404);
  const { data: canOperate } = await authClient.rpc("ro_can_operate");
  if (payload.tipo_evento === "nova_solicitacao_ro" && sol.solicitante_id !== user.id && !canOperate) return json({ error: "Sem permissão" }, 403);
  if (payload.tipo_evento === "passagem_comprada_solicitante" && !canOperate) return json({ error: "Sem permissão" }, 403);

  const insertLog = (values: Record<string, unknown>) => admin.from("ro_email_logs").insert({ solicitacao_id: sol.id, tipo_evento: payload.tipo_evento, canal: "email", payload: { anexo_ids: payload.anexo_ids || [] }, ...values });
  if (sol.motivo === "viagem_diretoria") {
    await insertLog({ destinatario_tipo: payload.tipo_evento === "nova_solicitacao_ro" ? "ro" : "solicitante", destinatario_user_id: payload.tipo_evento === "passagem_comprada_solicitante" ? sol.solicitante_id : null, status: "ignorado", erro: "Viagem diretoria não envia e-mail externo." });
    return json({ ok: true, ignored: true });
  }

  const { data: roster } = payload.tipo_evento === "nova_solicitacao_ro" ? await admin.from("ro_responsaveis").select("user_id").eq("ativo", true) : { data: [{ user_id: sol.solicitante_id }] };
  const uniqueUserIds = [...new Set((roster || []).map((item) => String(item.user_id)))];
  const authResults = await Promise.all(uniqueUserIds.map((id) => admin.auth.admin.getUserById(id)));
  const recipients = authResults.map((result) => result.data.user).filter((candidate) => candidate?.email && !candidate.deleted_at && !(candidate.banned_until && new Date(candidate.banned_until) > new Date()));
  const uniqueEmails = new Map<string, typeof recipients[number]>();
  for (const recipient of recipients) if (recipient?.email) uniqueEmails.set(recipient.email.trim().toLowerCase(), recipient);

  if (!uniqueEmails.size) {
    await insertLog({ destinatario_tipo: payload.tipo_evento === "nova_solicitacao_ro" ? "ro" : "solicitante", status: "ignorado", erro: "Nenhum destinatário ativo com e-mail." });
    return json({ ok: true, ignored: true });
  }
  if (!resendKey || !emailFrom || !appUrl) {
    for (const recipient of uniqueEmails.values()) await insertLog({ destinatario_tipo: payload.tipo_evento === "nova_solicitacao_ro" ? "ro" : "solicitante", destinatario_user_id: recipient!.id, destinatario_email: recipient!.email, status: "erro", erro: "Secrets EMAIL_PROVIDER_API_KEY, EMAIL_FROM ou APP_PUBLIC_URL não configuradas." });
    return json({ error: "Provedor de e-mail não configurado" }, 502);
  }

  const requesterResult = await admin.auth.admin.getUserById(sol.solicitante_id);
  const requester = requesterResult.data.user;
  const responsible = sol.responsavel_ro_id ? (await admin.auth.admin.getUserById(sol.responsavel_ro_id)).data.user : null;
  const { data: costs } = await admin.from("ro_passagem_custos").select("valor").eq("solicitacao_id", sol.id);
  const total = (costs || []).reduce((sum, item) => sum + Number(item.valor || 0), 0);
  const attachments: { filename: string; content: string }[] = [];
  let attachmentWarning = "";
  if (payload.tipo_evento === "passagem_comprada_solicitante") {
    let query = admin.from("ro_passagem_anexos").select("id,nome_arquivo,storage_path").eq("solicitacao_id", sol.id);
    if (payload.anexo_ids?.length) query = query.in("id", payload.anexo_ids);
    const { data: files } = await query;
    for (const file of files || []) {
      const { data, error } = await admin.storage.from("ro-passagem-anexos").download(file.storage_path);
      if (error || !data) { attachmentWarning += `Falha ao baixar ${file.nome_arquivo}. `; continue; }
      const bytes = new Uint8Array(await data.arrayBuffer()); let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      attachments.push({ filename: file.nome_arquivo, content: btoa(binary) });
    }
  }

  const results: Array<{ userId: string; status: EmailStatus }> = [];
  for (const recipient of uniqueEmails.values()) {
    if (!recipient?.email) continue;
    const recipientType = payload.tipo_evento === "nova_solicitacao_ro" ? "ro" : "solicitante";
    const { data: existing } = await admin.from("ro_email_logs").select("id").eq("solicitacao_id", sol.id).eq("tipo_evento", payload.tipo_evento).eq("destinatario_user_id", recipient.id).in("status", ["pendente", "enviado"]).limit(1);
    if (existing?.length) { results.push({ userId: recipient.id, status: "ignorado" }); continue; }

    const subject = payload.tipo_evento === "nova_solicitacao_ro" ? `Nova solicitação de passagem - ${sol.funcionario?.nome || ""}` : `Passagem comprada - ${sol.funcionario?.nome || ""}`;
    const fields = payload.tipo_evento === "nova_solicitacao_ro" ? [
      ["Funcionário", sol.funcionario?.nome], ["Motivo", labelMotivo(sol.motivo)],
      ["Centro de custo atual/origem", centroLabel(sol.obra)], ["Centro de destino", centroLabel(sol.centro_destino)],
      ["Centro de retorno", centroLabel(sol.centro_retorno)], ["Data de ida", formatDate(sol.data_ida)],
      ["Data de retorno", sol.data_retorno ? formatDate(sol.data_retorno) : "Não informada"],
      ["Solicitante", requester?.user_metadata?.full_name || requester?.email], ["Observações", sol.observacoes_solicitante || "—"],
    ] : [
      ["Funcionário", sol.funcionario?.nome], ["Motivo", labelMotivo(sol.motivo)], ["Centro de custo atual", centroLabel(sol.obra)],
      ["Partida", formatDate(sol.partida_em)], ["Valor total", new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total)],
      ["Responsável RO", responsible?.user_metadata?.full_name || responsible?.email], ["Observações", sol.observacoes_ro || "—"],
    ];
    const html = `<h2>${escapeHtml(subject)}</h2><p>${payload.tipo_evento === "nova_solicitacao_ro" ? "Nova solicitação de passagem registrada." : "A passagem foi comprada."}</p><table>${fields.map(([key, value]) => `<tr><td><strong>${escapeHtml(key)}</strong></td><td>${escapeHtml(value || "—")}</td></tr>`).join("")}</table><p><a href="${escapeHtml(`${appUrl}/solicitacoes/${sol.id}`)}">Abrir solicitação no Portal Tanks BR</a></p>`;
    const { data: log, error: logError } = await admin.from("ro_email_logs").insert({ solicitacao_id: sol.id, tipo_evento: payload.tipo_evento, canal: "email", destinatario_tipo: recipientType, destinatario_user_id: recipient.id, destinatario_email: recipient.email, assunto: subject, status: "pendente", payload: { anexo_ids: payload.anexo_ids || [], attachment_warning: attachmentWarning } }).select("id").single();
    if (logError || !log) { results.push({ userId: recipient.id, status: logError?.code === "23505" ? "ignorado" : "erro" }); continue; }
    try {
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" }, body: JSON.stringify({ from: `${fromName} <${emailFrom}>`, to: [recipient.email], subject, html, attachments }) });
      const provider = await response.json();
      if (!response.ok) throw new Error(provider?.message || `Resend HTTP ${response.status}`);
      await admin.from("ro_email_logs").update({ status: "enviado", provider_message_id: provider.id, enviado_em: new Date().toISOString(), erro: attachmentWarning || null }).eq("id", log.id);
      results.push({ userId: recipient.id, status: "enviado" });
    } catch (error) {
      await admin.from("ro_email_logs").update({ status: "erro", erro: `${error instanceof Error ? error.message : String(error)}${attachmentWarning ? ` ${attachmentWarning}` : ""}` }).eq("id", log.id);
      results.push({ userId: recipient.id, status: "erro" });
    }
  }
  const failed = results.some((item) => item.status === "erro");
  return json({ ok: !failed, results }, failed ? 502 : 200);
});
