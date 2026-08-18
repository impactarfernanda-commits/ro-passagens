import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const phase1=fs.readFileSync("supabase/migrations/202608180001_fluxo_ro_pos_finalizacao_exclusao.sql","utf8");
const phase2=fs.readFileSync("supabase/migrations/202608180002_remove_assinatura_complementar_legada.sql","utf8");
const operationalFinalization=fs.readFileSync("supabase/migrations/202608180003_finalizacao_operacional_ro.sql","utf8");
const page=fs.readFileSync("src/pages.tsx","utf8");
const reports=fs.readFileSync("src/Relatorios.tsx","utf8");
const roPermissions=fs.readFileSync("supabase/migrations/202607210002_ro_permissions_only_responsaveis.sql","utf8");

test("Fase 1 mantém as duas assinaturas e Fase 2 remove apenas a legada",()=>{
  assert.match(phase1,/ro_registrar_passagem_complementar\(p_solicitacao_id uuid,p_anexos jsonb,p_imprevisto boolean,p_motivo_complementar text,p_custos_adicionais jsonb\)/);
  assert.match(phase1,/ro_registrar_passagem_complementar\(p_solicitacao_id uuid,p_anexos jsonb,p_imprevisto boolean,p_motivo_complementar text\)/);
  assert.doesNotMatch(phase1,/drop function if exists public\.ro_registrar_passagem_complementar\(uuid,jsonb,boolean,text\)/);
  assert.match(phase2,/drop function if exists public\.ro_registrar_passagem_complementar\(uuid,jsonb,boolean,text\)/);
});

test("complemento valida storage, dono, vínculo e centro permitido",()=>{
  assert.match(phase1,/v_path not like p_solicitacao_id::text\|\|'\/%'/);
  assert.match(phase1,/storage\.objects[\s\S]*bucket_id='ro-passagem-anexos'[\s\S]*owner_id::text=auth\.uid\(\)::text/);
  assert.match(phase1,/storage_path=v_path and a\.solicitacao_id<>p_solicitacao_id/);
  assert.match(phase1,/CENTRO_CUSTO_NAO_PERMITIDO_PARA_SOLICITACAO/);
  assert.match(phase1,/v_centro is not distinct from v_sol\.obra_id/);
});

test("custos têm ACL mínima, limite e arredondamento server-side",()=>{
  assert.match(phase1,/revoke all on function public\.ro_atualizar_custo_operacional\(uuid,uuid,numeric\) from public,anon/i);
  assert.match(phase1,/grant execute on function public\.ro_atualizar_custo_operacional\(uuid,uuid,numeric\) to authenticated/i);
  assert.match(phase1,/v_valor:=round\(p_novo_valor,2\)/);
  assert.match(phase1,/v_valor>9999999999\.99/);
});

test("exclusão é lógica, limitada, normalizada e preserva filhos",()=>{
  assert.match(phase1,/references auth\.users\(id\) on delete set null/);
  assert.match(phase1,/regexp_replace\(coalesce\(p_motivo,''\),'\\s\+',' ','g'\)/);
  assert.match(phase1,/char_length\(v_motivo\)>500/);
  assert.match(phase1,/excluida_em=now\(\),excluida_por=auth\.uid\(\),motivo_exclusao=v_motivo/);
  assert.doesNotMatch(phase1,/delete\s+from\s+public\.ro_passagem_(solicitacoes|custos|anexos|historico)/i);
});

test("painel, cards, relatórios, CSV e totais partem de consultas explicitamente ativas",()=>{
  assert.match(page,/\.from\("ro_passagem_solicitacoes"\)[\s\S]*?\.is\("excluida_em", null\)/);
  assert.match(page,/\.is\("solicitacao\.excluida_em", null\)/);
  assert.match(page,/mostrandoExcluidas \? "not\.is" : "is"/);
  assert.match(reports,/\.is\("solicitacao\.excluida_em", null\)/);
  assert.match(reports,/\.is\("excluida_em", null\)/);
  assert.match(phase1,/create or replace function public\.ro_relatorio_centros_custo[\s\S]*with base as\([\s\S]*s\.excluida_em is null/);
  assert.doesNotMatch(phase1,/pg_get_functiondef|execute replace/i);
});

test("finalização manual e exclusão exigem RO ativo no backend",()=>{
  assert.match(page,/ro_finalizar_solicitacao/);
  assert.match(phase1,/APENAS_RESPONSAVEL_RO_ATIVO_PODE_FINALIZAR/);
  assert.match(phase1,/public\.ro_can_operate\(\)/);
  assert.match(roPermissions,/from public\.ro_responsaveis[\s\S]*where user_id = p_user[\s\S]*and ativo/);
});

test("finalização manual encerra somente as atividades do RO",()=>{
  assert.match(operationalFinalization,/ro_finalizar_solicitacao\(\s*p_solicitacao_id uuid,\s*p_observacao_operacional text\s*\)/);
  assert.match(operationalFinalization,/ro_finalizar_solicitacao\(\s*p_solicitacao_id uuid,\s*p_chegou_ao_destino boolean,\s*p_data_chegada_confirmada date,\s*p_houve_imprevisto boolean,\s*p_observacao_finalizacao text\s*\)/);
  assert.match(operationalFinalization,/APENAS_RESPONSAVEL_RO_ATIVO_PODE_FINALIZAR/);
  assert.match(operationalFinalization,/perform public\.ro_finalizar_solicitacao\(\s*p_solicitacao_id,\s*p_observacao_finalizacao\s*\)/);
  assert.doesNotMatch(operationalFinalization,/set[\s\S]*?(chegou_ao_destino|data_chegada_confirmada|houve_imprevisto)\s*=/i);
  assert.doesNotMatch(operationalFinalization,/(if|where|select)[^;]*(p_chegou_ao_destino|p_data_chegada_confirmada|p_houve_imprevisto)/i);
  assert.match(operationalFinalization,/revoke all on function public\.ro_finalizar_solicitacao\(uuid,boolean,date,boolean,text\) from public,anon/i);
  assert.match(operationalFinalization,/grant execute on function public\.ro_finalizar_solicitacao\(uuid,boolean,date,boolean,text\) to authenticated/i);
  assert.match(page,/Isso não confirma a chegada do funcionário/);
  assert.match(page,/p_observacao_operacional: observacao/);
  assert.doesNotMatch(page,/p_chegou_ao_destino|p_data_chegada_confirmada|p_houve_imprevisto|p_observacao_finalizacao|Confirme que o funcionário chegou ao destino/);
});

test("relatório e autofinalização ignoram exclusões em definições explícitas",()=>{
  assert.match(phase1,/create or replace function public\.ro_relatorio_centros_custo[\s\S]*where s\.excluida_em is null/);
  assert.match(phase1,/create or replace function public\.ro_auto_finalizar_solicitacoes[\s\S]*where s\.excluida_em is null and s\.status='passagem_comprada'/);
  assert.match(phase1,/update public\.ro_passagem_solicitacoes[\s\S]*where id=v_item\.id and excluida_em is null/);
});

test("upload complementar aceita somente objeto do proprietário autenticado",()=>{
  assert.match(phase1,/o\.owner_id::text=auth\.uid\(\)::text/);
  assert.match(phase1,/ARQUIVO_INEXISTENTE_OU_NAO_PERTENCE_AO_USUARIO/);
  assert.match(phase1,/owner_id::text=auth\.uid\(\)::text and public\.ro_can_operate\(\)/);
});
