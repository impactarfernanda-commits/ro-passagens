import type { Funcionario, Solicitacao } from "./types";

export type SolicitacaoColaboradorResolvido = {
  idOuChave: string;
  nome: string;
  origem: "obras_control" | "privado";
  funcionarioIdOpcional: string | null;
  privadoIdOpcional: string | null;
};

type SolicitacaoPessoa = Pick<Solicitacao, "funcionario_id" | "colaborador_id" | "funcionario" | "colaborador">;

export type NomeColaboradorSolicitacaoSeguro = {
  solicitacao_id: string;
  funcionario_nome_exibicao: string | null;
};

export function idsSolicitacoesParaResolver<T extends Pick<Solicitacao, "id">>(solicitacoes: T[]) {
  return [...new Set(solicitacoes.map(({ id }) => id).filter(Boolean))];
}

export function mapearNomesColaboradoresSolicitacoes(rows: NomeColaboradorSolicitacaoSeguro[] | null | undefined) {
  return Object.fromEntries(
    (rows || [])
      .filter(({ solicitacao_id, funcionario_nome_exibicao }) => solicitacao_id && funcionario_nome_exibicao?.trim())
      .map(({ solicitacao_id, funcionario_nome_exibicao }) => [solicitacao_id, funcionario_nome_exibicao!.trim()]),
  );
}

export function resolveSolicitacaoColaborador(solicitacao: SolicitacaoPessoa): SolicitacaoColaboradorResolvido | null {
  if (solicitacao.colaborador_id && solicitacao.colaborador?.nome) {
    return {
      idOuChave: `privado:${solicitacao.colaborador_id}`,
      nome: solicitacao.colaborador.nome,
      origem: "privado",
      funcionarioIdOpcional: solicitacao.funcionario_id || null,
      privadoIdOpcional: solicitacao.colaborador_id,
    };
  }
  if (solicitacao.funcionario_id && solicitacao.funcionario?.nome) {
    return {
      idOuChave: `obras:${solicitacao.funcionario_id}`,
      nome: solicitacao.funcionario.nome,
      origem: "obras_control",
      funcionarioIdOpcional: solicitacao.funcionario_id,
      privadoIdOpcional: null,
    };
  }
  return null;
}

export function resolveSolicitacaoFuncionarioNome(
  solicitacao: SolicitacaoPessoa,
  funcionarioNomeExibicao?: string | null,
) {
  const nomeSeguro = funcionarioNomeExibicao?.trim();
  if (solicitacao.colaborador_id && nomeSeguro) return nomeSeguro;
  return resolveSolicitacaoColaborador(solicitacao)?.nome || nomeSeguro || null;
}

export function chaveColaboradorCatalogo(item: Pick<Funcionario, "id" | "funcionario_id">) {
  return item.funcionario_id && item.id === item.funcionario_id ? `obras:${item.id}` : `privado:${item.id}`;
}

export function normalizarBuscaPessoa(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

export function solicitacaoCorrespondeAoColaborador(solicitacao: SolicitacaoPessoa, chave: string) {
  return resolveSolicitacaoColaborador(solicitacao)?.idOuChave === chave;
}

export function solicitacaoCorrespondeBuscaPessoa(solicitacao: SolicitacaoPessoa, busca: string, funcionarioNomeExibicao?: string | null) {
  const nome = resolveSolicitacaoFuncionarioNome(solicitacao, funcionarioNomeExibicao);
  return Boolean(nome && normalizarBuscaPessoa(nome).includes(normalizarBuscaPessoa(busca)));
}
