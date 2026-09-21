import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { creationRequestErrorMessage } from "../src/creationErrorMessages.ts";

const message = (value: string) => creationRequestErrorMessage({ message: value });

test("mapeia os códigos conhecidos da criação", () => {
  assert.equal(message("JUSTIFICATIVA_EXCECAO_OBRIGATORIA"), "Informe uma justificativa de pelo menos 10 caracteres para usar a exceção de prazo.");
  assert.equal(message("FORA_DO_PRAZO:2026-10-16"), "A data não atende ao prazo mínimo e seu perfil não está autorizado a usar a exceção de prazo.");
  assert.equal(message("APROVADOR_INVALIDO"), "O aprovador selecionado não está mais habilitado. Atualize a página e selecione novamente.");
  assert.equal(message("AUTOAPROVACAO_NAO_PERMITIDA"), "Seu perfil atual não permite aprovar a própria solicitação.");
  assert.equal(message("ENDERECO_RESIDENCIAL_NAO_CADASTRADO"), "O viajante não possui endereço residencial cadastrado pelo RH. Informe um destino excepcional, quando permitido.");
  assert.equal(message("JUSTIFICATIVA_DESTINO_EXCEPCIONAL_OBRIGATORIA"), "Informe uma justificativa de pelo menos 10 caracteres para usar um destino excepcional.");
  assert.equal(message("PIX_VIAJANTE_OBRIGATORIO"), "Informe a chave PIX do viajante.");
});

test("reconhece indisponibilidade de pessoa e centro de custo", () => {
  assert.match(message("Funcionário indisponível para este solicitante"), /funcionário selecionado não está mais disponível/i);
  assert.match(message("COLABORADOR_INATIVO_OU_INEXISTENTE"), /colaborador selecionado não está mais disponível/i);
  assert.equal(message("Centro de custo atual é obrigatório"), "Selecione o centro de custo atual.");
  assert.match(message("Centro de custo indisponível para este solicitante"), /centro de custo selecionado não está mais disponível/i);
});

test("preserva os tratamentos de calendário e motivo inválido em qualquer campo", () => {
  assert.equal(creationRequestErrorMessage({ details: "CALENDARIO_INCOMPLETO:2026" }), "O calendário de dias não úteis ainda não foi validado.");
  assert.equal(creationRequestErrorMessage({ hint: "MOTIVO_NAO_PERMITIDO" }), "Motivo da solicitação inválido. Selecione novamente o motivo da viagem.");
});

test("usa mensagem mesmo quando o erro não possui code", () => {
  assert.equal(creationRequestErrorMessage({ message: "PIX_VIAJANTE_OBRIGATORIO" }), "Informe a chave PIX do viajante.");
});

test("fallback não expõe conteúdo interno ou sensível", () => {
  const result = creationRequestErrorMessage({
    code: "P0001",
    message: "falha interna",
    details: "SQL select segredo from auth.users; token=super-secreto; id=123",
    hint: "stack trace privado",
  });
  assert.equal(result, "Não foi possível criar a solicitação. Verifique os dados informados e tente novamente.");
  assert.doesNotMatch(result, /SQL|token|segredo|123|stack/i);
});

test("fallback pode apresentar somente código de negócio seguro", () => {
  assert.equal(message("REGRA_NOVA_DESCONHECIDA: detalhe privado"), "Não foi possível criar a solicitação. Verifique os dados informados e tente novamente. Código: REGRA_NOVA_DESCONHECIDA");
});

test("tela usa o helper e mantém log técnico estruturado apenas em desenvolvimento", () => {
  const page = readFileSync(new URL("../src/pages.tsx", import.meta.url), "utf8");
  assert.match(page, /setErro\(creationRequestErrorMessage\(error\)\)/);
  assert.match(page, /import\.meta\.env\.DEV[\s\S]*console\.error\("Falha ao criar solicitação", \{ message:error\.message, code:error\.code, details:error\.details, hint:error\.hint \}\)/);
  assert.match(page, /solicitar_excecao_prazo:podeExcepcionarPrazo&&permiteExcecaoPrazo&&solicitarExcecao/);
  assert.match(page, /ro_criar_solicitacao_com_aprovador/);
});
