import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chaveColaboradorCatalogo, resolveSolicitacaoColaborador, solicitacaoCorrespondeAoColaborador, solicitacaoCorrespondeBuscaPessoa } from "../src/solicitacaoColaborador.ts";
import type { Solicitacao } from "../src/types.ts";

const row = (patch: Partial<Solicitacao>) => patch as Solicitacao;
const pages = readFileSync(new URL("../src/pages.tsx", import.meta.url), "utf8");

test("funcionário Obras Control aparece pelo nome e id explícito", () => {
  const pessoa = resolveSolicitacaoColaborador(row({ funcionario_id:"f1", colaborador_id:null, funcionario:{id:"f1",nome:"JOÃO OBRAS"} }));
  assert.deepEqual(pessoa,{idOuChave:"obras:f1",nome:"JOÃO OBRAS",origem:"obras_control",funcionarioIdOpcional:"f1",privadoIdOpcional:null});
});

test("colaborador privado sem funcionario_id aparece pelo colaborador_id", () => {
  const pessoa = resolveSolicitacaoColaborador(row({ funcionario_id:null, colaborador_id:"p1", colaborador:{id:"p1",nome:"NATHALIA NUNES DA SILVA"} }));
  assert.equal(pessoa?.nome,"NATHALIA NUNES DA SILVA");
  assert.equal(pessoa?.idOuChave,"privado:p1");
});

test("privado com vínculo explícito continua identificado pelo registro privado", () => {
  const pessoa = resolveSolicitacaoColaborador(row({ funcionario_id:"f1", colaborador_id:"p1", funcionario:{id:"f1",nome:"NATHALIA OBRAS"}, colaborador:{id:"p1",nome:"NATHALIA NUNES DA SILVA"} }));
  assert.equal(pessoa?.nome,"NATHALIA NUNES DA SILVA");
  assert.equal(pessoa?.funcionarioIdOpcional,"f1");
});

test("não existe matching por nome", () => {
  assert.equal(resolveSolicitacaoColaborador(row({funcionario_id:null,colaborador_id:"p1",funcionario:{id:"outro",nome:"NATHALIA NUNES DA SILVA"}})),null);
});

test("filtro distingue ids privados e Obras e evita colisão", () => {
  const privado=row({funcionario_id:"f1",colaborador_id:"p1",colaborador:{id:"p1",nome:"Pessoa"}});
  assert.equal(solicitacaoCorrespondeAoColaborador(privado,"privado:p1"),true);
  assert.equal(solicitacaoCorrespondeAoColaborador(privado,"obras:f1"),false);
  assert.equal(chaveColaboradorCatalogo({id:"p1",funcionario_id:"f1"}),"privado:p1");
  assert.equal(chaveColaboradorCatalogo({id:"f1",funcionario_id:"f1"}),"obras:f1");
});

for (const busca of ["Nathalia","Nathalia Nunes","NATHALIA NUNES DA SILVA"])
  test(`busca textual normalizada encontra privado: ${busca}`,()=>assert.equal(solicitacaoCorrespondeBuscaPessoa(row({funcionario_id:null,colaborador_id:"p1",colaborador:{id:"p1",nome:"NATHALIA NUNES DA SILVA"}}),busca),true));

test("caso real mantém nome, centro de custo e viagem administrativa na listagem", () => {
  assert.match(pages,/resolveSolicitacaoColaborador\(r\)\?\.nome \|\| "—"[\s\S]*formatCentroCustoLabel\(r\.obra\)/);
  assert.match(pages,/formatMotivoLabel\(r\.motivo\)/);
});

test("detalhe e resumos reutilizam o mesmo resolvedor",()=>{
  assert.match(pages,/title=\{resolveSolicitacaoColaborador\(row\)\?\.nome/);
  assert.match(pages,/<DT t="Funcionário" v=\{resolveSolicitacaoColaborador\(row\)\?\.nome\}/);
  assert.doesNotMatch(pages,/r\.funcionario\?\.nome \|\| "—"/);
});

test("query traz somente id e nome do privado",()=>{
  assert.match(pages,/colaborador:ro_funcionarios_enderecos_privados[^"]*\(id,nome\)/);
  assert.doesNotMatch(pages,/colaborador:ro_funcionarios_enderecos_privados[^"]*\b(cpf|rg|telefone|data_nascimento|logradouro)\b/);
});
