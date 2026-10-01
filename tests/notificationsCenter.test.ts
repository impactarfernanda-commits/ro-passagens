import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const components = fs.readFileSync("src/components.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610010001_notificacoes_usuario.sql", "utf8");
const approvals = fs.readFileSync("supabase/migrations/202608210001_pacote_1_aprovadores_individuais_denise.sql", "utf8");

test("sidebar identifica o usuário e o perfil acima de sair", () => {
  assert.match(app, /users_profiles.*full_name/);
  assert.match(components, /className="side-user"[\s\S]*?<strong>\{userName\}<\/strong>[\s\S]*?<span>\{profileLabel\}/);
  assert.ok(components.indexOf('className="side-user"') < components.indexOf("<LogOut"));
});

test("topo não repete a marca e mantém o centro de notificações", () => {
  const header = components.slice(components.indexOf("export function Header"), components.indexOf("export function Page"));
  assert.doesNotMatch(header, /TanksBRLogo|Portal Tanks BR|header-brand/);
  assert.match(header, /<NotificationCenter userId=\{userId\}/);
});

test("sino lista, sinaliza não lidas e permite abrir a solicitação", () => {
  assert.match(components, /ro_listar_minhas_notificacoes/);
  assert.match(components, /ro_marcar_notificacao_lida/);
  assert.match(components, /navigate\(`\/solicitacoes\/\$\{item\.solicitacao_id\}`\)/);
  assert.match(components, /Você não tem notificações/);
});

test("backend restringe destinatários e mantém leitura individual", () => {
  assert.match(migration, /primary key \(notificacao_id,user_id\)/);
  assert.match(migration, /destinatario_tipo='solicitante'.*auth\.uid\(\)::text/s);
  assert.match(migration, /destinatario_tipo='ro'.*ro_responsaveis/s);
  assert.match(migration, /NOTIFICACAO_NAO_DISPONIVEL/);
  assert.match(migration, /revoke all on table public\.ro_passagem_notificacoes from public,anon,authenticated/);
  assert.match(migration, /grant select on table public\.ro_passagem_notificacoes to authenticated/);
  assert.match(migration, /destinatario_tipo='solicitante' and destinatario=auth\.uid\(\)::text/);
  assert.match(migration, /destinatario_tipo='ro'[\s\S]*?ro_responsaveis[\s\S]*?r\.ativo/);
});

test("eventos de aprovação notificam solicitante e equipe RO", () => {
  assert.match(migration, /ro_notificar_equipe_nova_solicitacao[\s\S]*?'ro'/);
  assert.match(migration, /new\.aprovacao_status='aprovada'[\s\S]*?'solicitante'/);
  assert.match(migration, /new\.aprovacao_status='reprovada'[\s\S]*?'solicitante'/);
  assert.match(approvals, /ro_notificar_equipe_solicitacao_liberada[\s\S]*?'ro'/);
});
