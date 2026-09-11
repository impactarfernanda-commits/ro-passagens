import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chaveColaboradorCatalogo, idsSolicitacoesParaResolver, mapearNomesColaboradoresSolicitacoes, resolveSolicitacaoColaborador, resolveSolicitacaoFuncionarioNome, solicitacaoCorrespondeAoColaborador, solicitacaoCorrespondeBuscaPessoa } from "../src/solicitacaoColaborador.ts";
import type { Solicitacao } from "../src/types.ts";

const row = (patch: Partial<Solicitacao>) => patch as Solicitacao;
const pages = readFileSync(new URL("../src/pages.tsx", import.meta.url), "utf8");

test("funcionário Obras Control aparece pelo nome e id explícito", () => {
  const pessoa = resolveSolicitacaoColaborador(row({ funcionario_id:"f1", colaborador_id:null, funcionario:{id:"f1",nome:"JOÃO OBRAS"} }));
  assert.deepEqual(pessoa,{idOuChave:"obras:f1",nome:"JOÃO OBRAS",origem:"obras_control",funcionarioIdOpcional:"f1",privadoIdOpcional:null});
});

test("colaborador privado legado ainda pode ser resolvido quando já está carregado", () => {
  const pessoa = resolveSolicitacaoColaborador(row({ funcionario_id:null, colaborador_id:"p1", colaborador:{id:"p1",nome:"NATHALIA NUNES DA SILVA"} }));
  assert.equal(pessoa?.nome,"NATHALIA NUNES DA SILVA");
});

test("filtro distingue ids privados e Obras e evita colisão", () => {
  const privado=row({funcionario_id:"f1",colaborador_id:"p1",colaborador:{id:"p1",nome:"Pessoa"}});
  assert.equal(solicitacaoCorrespondeAoColaborador(privado,"privado:p1"),true);
  assert.equal(solicitacaoCorrespondeAoColaborador(privado,"obras:f1"),false);
  assert.equal(chaveColaboradorCatalogo({id:"p1",funcionario_id:"f1"}),"privado:p1");
  assert.equal(chaveColaboradorCatalogo({id:"f1",funcionario_id:"f1"}),"obras:f1");
});

test("payload da RPC reúne IDs visíveis em lote e remove duplicados",()=>{
  assert.deepEqual(idsSolicitacoesParaResolver([{id:"s1"},{id:"s2"},{id:"s1"}]),["s1","s2"]);
});

test("resultado mínimo da RPC vira mapa por solicitação",()=>{
  assert.deepEqual(mapearNomesColaboradoresSolicitacoes([
    {solicitacao_id:"s1",funcionario_nome_exibicao:" NOME PRIVADO "},
    {solicitacao_id:"s2",funcionario_nome_exibicao:null},
  ]),{s1:"NOME PRIVADO"});
});

test("nome seguro resolve privado sem modelar cadastro privado",()=>{
  const privado=row({id:"s1",funcionario_id:null,colaborador_id:"p1"});
  assert.equal(resolveSolicitacaoFuncionarioNome(privado,"NOME PRIVADO"),"NOME PRIVADO");
  assert.equal(resolveSolicitacaoFuncionarioNome(privado,null),null);
});

test("funcionário normal e fallback continuam funcionando",()=>{
  assert.equal(resolveSolicitacaoFuncionarioNome(row({funcionario_id:"f1",colaborador_id:null,funcionario:{id:"f1",nome:"JOÃO OBRAS"}})),"JOÃO OBRAS");
  assert.equal(resolveSolicitacaoFuncionarioNome(row({funcionario_id:null,colaborador_id:"p1"})),null);
});

for(const busca of ["jose","José da Silva","SILVA"])
  test(`busca normalizada usa nome seguro da solicitação: ${busca}`,()=>{
    assert.equal(solicitacaoCorrespondeBuscaPessoa(row({funcionario_id:null,colaborador_id:"p1"}),busca,"JOSÉ DA SILVA"),true);
  });

test("listagem mantém nome seguro, fallback e centro de custo", () => {
  assert.match(pages,/resolveSolicitacaoFuncionarioNome\(r, nomesFuncionarios\[r\.id\]\) \|\| "—"[\s\S]*formatCentroCustoLabel\(r\.obra\)/);
  assert.match(pages,/formatMotivoLabel\(r\.motivo\)/);
});

test("detalhe usa o nome seguro da solicitação",()=>{
  assert.match(pages,/carregarNomesColaboradoresSolicitacoes\(\[found\]\)/);
  assert.match(pages,/title=\{resolveSolicitacaoFuncionarioNome\(row, funcionarioNomeExibicao\)/);
  assert.match(pages,/<DT t="Funcionário" v=\{resolveSolicitacaoFuncionarioNome\(row, funcionarioNomeExibicao\)\}/);
});

test("consulta comum não faz join direto com cadastro privado",()=>{
  assert.doesNotMatch(pages,/colaborador:ro_funcionarios_enderecos_privados/);
  assert.match(pages,/\.rpc\("ro_nomes_colaboradores_solicitacoes",\s*\{[\s\S]*p_solicitacao_ids: ids/);
  assert.match(pages,/carregarNomesColaboradoresSolicitacoes\(loaded\)/);
});

test("nome da solicitação não é resolvido pelo catálogo nem pelo resumo privado",()=>{
  const fluxo=pages.slice(pages.indexOf("async function carregarNomesColaboradoresSolicitacoes"),pages.indexOf("function useCatalogos"));
  assert.match(fluxo,/ro_nomes_colaboradores_solicitacoes/);
  assert.doesNotMatch(fluxo,/ro_catalogo_colaboradores_viagem|ro_obter_colaborador_resumo/);
});
