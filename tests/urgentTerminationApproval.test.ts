import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dispensaAprovacaoDesligamentoUrgente } from "../src/approvalRules.ts";
import { categoriaDocumento, validarSolicitacao } from "../src/passagemRules.ts";

const page = fs.readFileSync("src/pages.tsx", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/202609100002_dispensa_aprovacao_desligamentos_urgentes.sql",
  "utf8",
);

test("somente pedido de demissão e justa causa dispensam aprovação por motivo", () => {
  assert.equal(
    dispensaAprovacaoDesligamentoUrgente(
      "desligamento",
      "pedido_demissao",
    ),
    true,
  );

  assert.equal(
    dispensaAprovacaoDesligamentoUrgente(
      "desligamento",
      "justa_causa",
    ),
    true,
  );

  assert.equal(
    dispensaAprovacaoDesligamentoUrgente(
      "desligamento",
      "ma_conduta",
    ),
    false,
  );

  assert.equal(
    dispensaAprovacaoDesligamentoUrgente(
      "desligamento",
      "programado_outros",
    ),
    false,
  );

  assert.equal(
    dispensaAprovacaoDesligamentoUrgente(
      "ferias",
      "pedido_demissao",
    ),
    false,
  );
});

test("documentos obrigatórios continuam específicos e validados", () => {
  assert.equal(
    categoriaDocumento("pedido_demissao"),
    "carta_pedido_demissao",
  );

  assert.equal(
    categoriaDocumento("justa_causa"),
    "termo_justa_causa",
  );

  const base = {
    role: null,
    isRh: false,
    dataIda: "2026-09-10",
    agora: new Date("2026-09-10T12:00:00-03:00"),
  };

  assert.ok(
    validarSolicitacao({
      ...base,
      motivo: "desligamento",
      desligamentoSubtipo: "pedido_demissao",
    }).bloqueios.includes(
      "DOCUMENTO_INTERNO_OBRIGATORIO:carta_pedido_demissao",
    ),
  );

  assert.ok(
    validarSolicitacao({
      ...base,
      motivo: "desligamento",
      desligamentoSubtipo: "justa_causa",
    }).bloqueios.includes(
      "DOCUMENTO_INTERNO_OBRIGATORIO:termo_justa_causa",
    ),
  );
});

test("frontend limpa aprovador, omite o campo na dispensa e volta a exigir nos demais casos", () => {
  assert.match(
    page,
    /if \(!dispensaAprovacaoUrgente\) return;[\s\S]*aprovador_id: ""/,
  );

  assert.match(
    page,
    /aprovador_id:dispensaAprovacao\?"":form\.aprovador_id/,
  );

  assert.match(
    page,
    /if \(!dispensaAprovacao && !form\.aprovador_id\)/,
  );

  assert.match(
    page,
    /\{!dispensaAprovacao && <label>Aprovador \*/,
  );
});

test("backend usa a dispensa existente com fila, histórico e notificação RO", () => {
  assert.match(
    migration,
    /p_solicitacao->>'motivo'='desligamento'[\s\S]*in\('pedido_demissao','justa_causa'\)/,
  );

  assert.match(
    migration,
    /v_aprovador:=null/,
  );

  assert.match(
    migration,
    /when v_dispensa then 'dispensada'/,
  );

  assert.match(
    migration,
    /Aprovação dispensada por regra de desligamento urgente/,
  );

  assert.match(
    migration,
    /ro_notificar_equipe_solicitacao_liberada\(v_id\)/,
  );

  assert.doesNotMatch(
    migration,
    /v_aprovador:=auth\.uid\(\)/,
  );
});

test("colaborador privado continua usando o wrapper com validação documental", () => {
  assert.match(
    migration,
    /ro_criar_solicitacao_colaborador_validada\(\s*p_solicitacao\s*-\s*'aprovador_id'\s*,\s*p_documentos\s*\)/,
  );

  const migrationDocumentoColaborador = fs.readFileSync(
    "supabase/migrations/202609100001_corrige_documentos_colaborador_privado.sql",
    "utf8",
  );

  assert.match(
    migrationDocumentoColaborador,
    /ro-documentos-internos[\s\S]*application\/pdf/,
  );
});