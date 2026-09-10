import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {estadoEfetivoFolga,type CicloFolga} from "../src/folgaCampoRules.ts";
import {podeRecusarSolicitacao} from "../src/recusaRules.ts";
import type {Solicitacao} from "../src/types.ts";

const migration=readFileSync(new URL("../supabase/migrations/202609100003_corrige_folga_ativa_e_recusa_antecipada_ro.sql",import.meta.url),"utf8");
const approval=readFileSync(new URL("../supabase/migrations/202608210001_pacote_1_aprovadores_individuais_denise.sql",import.meta.url),"utf8");
const rejection=readFileSync(new URL("../supabase/migrations/202608050003_controle_ciclo_folga_campo.sql",import.meta.url),"utf8");
const page=readFileSync(new URL("../src/pages.tsx",import.meta.url),"utf8");
const ciclo=(status:string,aprovacao:string|null)=>({solicitacao_futura_status:status,solicitacao_futura_aprovacao_status:aprovacao} as CicloFolga);
const row=(aprovacao_status:Solicitacao["aprovacao_status"])=>({status:"solicitada",aprovacao_status,comprado_em:null,comprado_por:null,custos:[],anexos:[]} as Solicitacao);

test("duplicidade exige status operacional ativo e aprovação não reprovada",()=>{
  assert.match(migration,/status in \('solicitada','em_andamento','passagem_comprada'\)/);
  assert.match(migration,/aprovacao_status is distinct from 'reprovada'/);
  assert.doesNotMatch(migration,/status in \([^)]*\)\s+or\s+s\.folga_antecipacao_status/i);
});
test("cancelada e recusada não bloqueiam nem por antecipação pendente",()=>assert.match(migration,/and s\.status in/));
test("estado efetivo prioriza recusa, cancelamento e reprovação",()=>{
  assert.equal(estadoEfetivoFolga(ciclo("solicitada","reprovada")),"Reprovada na aprovação");
  assert.equal(estadoEfetivoFolga(ciclo("recusada","pendente")),"Recusada");
  assert.equal(estadoEfetivoFolga(ciclo("cancelada","aprovada")),"Cancelada");
});
test("RO pode recusar solicitação ainda pendente de aprovação",()=>{
  assert.equal(podeRecusarSolicitacao(true,row("pendente")),true);
  assert.match(page,/access\.canOperateRO && row\.aprovacao_status !== "reprovada"/);
});
test("RPC exige motivo e RO, carimba e audita a recusa",()=>{
  assert.match(rejection,/ro_is_operador_ativo\(auth\.uid\(\)\)/);
  assert.match(rejection,/MOTIVO_RECUSA_OBRIGATORIO/);
  assert.match(rejection,/recusada_em=now\(\),recusada_por=auth\.uid\(\)/);
  assert.match(rejection,/ro_passagem_historico/);
  assert.match(rejection,/ro_auditoria_interna/);
});
test("coordenador não aprova depois da recusa operacional",()=>assert.match(approval,/aprovacao_status<>'pendente'[\s\S]*v\.status<>'solicitada'/));
test("reprovação do coordenador já encerrada não vira recusa da RO",()=>assert.match(migration,/aprovacao_status='reprovada' then raise exception 'SOLICITACAO_JA_REPROVADA'/));
test("migração é apenas proposta transacional e não altera dados históricos",()=>{
  assert.match(migration,/^begin;/i);assert.match(migration,/commit;\s*$/i);
  assert.doesNotMatch(migration,/\b(delete|truncate)\s+(?:from\s+)?public\.ro_passagem_solicitacoes/i);
  assert.match(migration,/update public\.ro_passagem_solicitacoes[\s\S]*where id=p_solicitacao_id/);
});
