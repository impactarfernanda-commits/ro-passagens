export type Motivo =
  | "ferias"
  | "folga_campo"
  | "desligamento"
  | "transferencia_obra"
  | "admissao"
  | "inicio_obra"
  | "retorno_obra"
  | "viagem_diretoria";
export type Status =
  | "solicitada"
  | "em_analise"
  | "em_andamento"
  | "passagem_comprada"
  | "finalizada"
  | "cancelada";
export type Funcionario = {
  id: string;
  nome: string;
  obra_id?: string | null;
  visivel_obras_control?: boolean;
  visivel_passagens?: boolean;
  escopo_passagens?: string;
};
export type Obra = {
  id: string;
  nome: string;
  codigo?: string | null;
  descricao?: string | null;
};
export type Perfil = {
  id: string;
  full_name?: string | null;
  email?: string | null;
};
export type Custo = {
  id: string;
  tipo: "passagem" | "uber" | "refeicao" | "outros";
  descricao: string | null;
  valor: number;
  centro_custo_id: string | null;
};
export type Notificacao = {
  id: string;
  canal: string;
  destinatario_tipo: string;
  mensagem: string;
  status: string;
  created_at: string;
};
export type Historico = {
  id: string;
  status_anterior: string | null;
  status_novo: string | null;
  descricao: string;
  created_at: string;
};
export type Anexo = {
  id: string;
  solicitacao_id: string;
  tipo: string;
  nome_arquivo: string;
  storage_path: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  partida_em: string | null;
  valor: number | null;
  observacao: string | null;
  complementar: boolean;
  imprevisto: boolean;
  motivo_complementar: string | null;
  criado_por: string | null;
  criado_em: string;
  created_at: string;
};
export type Solicitacao = {
  id: string;
  funcionario_id: string;
  obra_id: string | null;
  solicitante_id: string;
  origem: string;
  destino: string;
  motivo: Motivo | null;
  data_ida: string;
  data_retorno: string | null;
  centro_custo_retorno_id: string | null;
  retorno_indefinido: boolean;
  centro_custo_destino_id: string | null;
  justificativa_excecao_prazo: string | null;
  status: Status;
  observacoes_solicitante: string | null;
  observacoes_ro: string | null;
  tipo_transporte: string | null;
  companhia: string | null;
  localizador: string | null;
  origem_comprada: string | null;
  destino_comprado: string | null;
  partida_em: string | null;
  chegada_em: string | null;
  comprado_em: string | null;
  comprado_por: string | null;
  chegou_ao_destino: boolean | null;
  data_chegada_confirmada: string | null;
  houve_imprevisto: boolean | null;
  observacao_finalizacao: string | null;
  finalizado_por: string | null;
  finalizado_em: string | null;
  created_at: string;
  updated_at: string;
  funcionario?: Funcionario;
  obra?: Obra;
  solicitante?: Perfil;
  centro_custo_retorno?: Obra;
  centro_custo_destino?: Obra;
  custos?: Custo[];
  notificacoes?: Notificacao[];
  historico?: Historico[];
  anexos?: Anexo[];
};
