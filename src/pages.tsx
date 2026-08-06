import { useCallback, useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { Access } from "./App";
import { EnvWarning } from "./App";
import { useAutoFinalization } from "./autoFinalization";
import { BrandLogo, Empty, Page, Spinner, StatusBadge } from "./components";
import {
  data,
  dataHora,
  dinheiro,
  centroCustoMatches,
  formatCentroCustoLabel,
  formatMotivoLabel,
  motivoLabel,
  statusLabel,
  statusOptions,
} from "./lib";
import { validatePdfFile, validatePdfSignature } from "./pdfFileValidation";
import { extractTicketDataFromPdf } from "./pdfPassagem";
import { calcularCustosSemDuplicidade } from "./passagemGrouping";
import { deduplicateNotifications } from "./notifications";
import { buildPurchaseCosts, totalTicketValues } from "./purchaseCosts";
import { supabase } from "./supabase";
import { calcularDataMinima, categoriaDocumento, dataMinimaDoInput, limparDataIdaInvalida, mensagemAntecedencia, motivosPermitidos, regraPrazo } from "./passagemRules";
import { motivoPrefillPermitido, motivoRecusaValido, podeRecusarSolicitacao, statusContaComoAberto } from "./recusaRules";
import { compraFolgaLiberada, dataAntecipaCiclo, folgaFuturaBloqueia, justificativaAntecipacaoValida, SEM_HISTORICO_FOLGA, type CicloFolga } from "./folgaCampoRules";
import { motivoPossuiRetorno, normalizarCamposRetorno } from "./retornoRules";
import type {
  Anexo,
  Custo,
  DesligamentoSubtipo,
  Funcionario,
  Motivo,
  Obra,
  Perfil,
  Solicitacao,
  Status,
} from "./types";
const join =
  "*, funcionario:funcionarios(id,nome), obra:obras!ro_passagem_solicitacoes_obra_id_fkey(id,nome,codigo,descricao), centro_custo_retorno:obras!ro_passagem_solicitacoes_centro_custo_retorno_id_fkey(id,nome,codigo,descricao), centro_custo_destino:obras!ro_passagem_solicitacoes_centro_custo_destino_id_fkey(id,nome,codigo,descricao), custos:ro_passagem_custos(*), notificacoes:ro_passagem_notificacoes(*), historico:ro_passagem_historico(*), anexos:ro_passagem_anexos(*)";
function useCatalogos() {
  const [funcionarios, setF] = useState<Funcionario[]>([]);
  const [obras, setO] = useState<Obra[]>([]);
  useEffect(() => {
    supabase
      .rpc("ro_catalogo_funcionarios_solicitacao")
      .then(({ data }) => setF((data || []) as Funcionario[]));
    supabase.rpc("ro_catalogo_centros_custo").then(async ({ data }) => {
      const catalogo = (data || []) as Obra[];
      if (!catalogo.length) return setO([]);
      const { data: detalhes } = await supabase.from("obras")
        .select("id,codigo,descricao").in("id", catalogo.map((obra) => obra.id));
      const porId = new Map((detalhes || []).map((obra) => [obra.id, obra]));
      setO(catalogo.map((obra) => ({ ...obra, ...porId.get(obra.id) })));
    });
  }, []);
  return { funcionarios, obras };
}
export function Login() {
  const [modo, setModo] = useState<"entrar" | "cadastrar">("entrar");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [busy, setBusy] = useState(false);
  function trocar(proximo: "entrar" | "cadastrar") {
    setModo(proximo);
    setErro("");
    setSucesso("");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro("");
    setSucesso("");
    if (modo === "cadastrar") {
      if (senha !== confirmar) {
        setErro("As senhas não conferem.");
        setBusy(false);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email,
        password: senha,
        options: { data: nome.trim() ? { full_name: nome.trim() } : undefined },
      });
      if (error) {
        setErro(
          error.message.toLowerCase().includes("already") ||
            error.message.toLowerCase().includes("registered")
            ? "Este e-mail já está cadastrado. Tente entrar ou use outro e-mail."
            : "Não foi possível criar a conta. Confira os dados e tente novamente.",
        );
      } else {
        setSucesso(
          "Conta criada com sucesso. Verifique seu e-mail ou faça login conforme configuração do sistema.",
        );
        setModo("entrar");
        setSenha("");
        setConfirmar("");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: senha,
      });
      if (error) setErro("Não foi possível entrar. Confira e-mail e senha.");
    }
    setBusy(false);
  }
  return (
    <div className="login">
      <div className="login-accent" />
      <form className="login-card" onSubmit={submit}>
        <BrandLogo className="login-logo" />
        <div className="login-heading">
          <h1>Portal Tanks BR</h1>
          <p>Acesse o portal corporativo</p>
        </div>
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            className={modo === "entrar" ? "active" : ""}
            onClick={() => trocar("entrar")}
          >
            Entrar
          </button>
          <button
            type="button"
            className={modo === "cadastrar" ? "active" : ""}
            onClick={() => trocar("cadastrar")}
          >
            Cadastrar
          </button>
        </div>
        <EnvWarning />
        {erro && (
          <div className="error" role="alert">
            {erro}
          </div>
        )}
        {sucesso && (
          <div className="success" role="status">
            {sucesso}
          </div>
        )}
        {modo === "cadastrar" && (
          <label>
            Nome completo <span>(opcional)</span>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="name"
              placeholder="Seu nome completo"
            />
          </label>
        )}
        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            placeholder="nome@tanksbr.com.br"
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete={
              modo === "entrar" ? "current-password" : "new-password"
            }
            minLength={6}
            required
            placeholder="Mínimo de 6 caracteres"
          />
        </label>
        {modo === "cadastrar" && (
          <label>
            Confirmar senha
            <input
              type="password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
              placeholder="Digite a senha novamente"
            />
          </label>
        )}
        <button className="btn primary auth-submit" disabled={busy}>
          {busy ? "Aguarde..." : modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>
        <small className="auth-note">
          Ao criar uma conta, você entra como solicitante comum. O acesso RO é
          administrado separadamente.
        </small>
      </form>
    </div>
  );
}
type DashboardMonthlyCost = {
  id: string;
  solicitacao_id: string;
  tipo: Custo["tipo"];
  descricao: string | null;
  valor: number;
  created_at: string;
  solicitacao: {
    id: string;
    status: Status;
    motivo: Motivo | null;
    houve_imprevisto: boolean | null;
    funcionario?: Pick<Funcionario, "id" | "nome">;
    anexos?: Array<Pick<Anexo, "complementar" | "imprevisto">>;
  };
};
type DashboardCardKey =
  | "abertas"
  | "atrasadas"
  | "compradas"
  | "desligamento"
  | "transferencia"
  | "imprevistos";
type DashboardDetailEntry = {
  solicitacao: Solicitacao;
  valor: number;
  observacao?: string;
};

function uniqueMonthlyRequests(custos: DashboardMonthlyCost[]) {
  return [
    ...new Map(
      custos.map((custo) => [
        custo.solicitacao.id,
        custo.solicitacao,
      ]),
    ).values(),
  ];
}

export function Dashboard({ access }: { access: Access }) {
  const [rows, setRows] = useState<Solicitacao[]>([]);
  const [custosMensais, setCustosMensais] = useState<DashboardMonthlyCost[]>([]);
  const [mesReferencia, setMesReferencia] = useState(
    () =>
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
  );
  const [cardSelecionado, setCardSelecionado] =
    useState<DashboardCardKey>();
  const [loading, setLoading] = useState(true);
  const loadDashboard = useCallback(async () => {
    setLoading(true);
    const [ano, mes] = mesReferencia.split("-").map(Number);
    const inicioMes = new Date(ano, mes - 1, 1).toISOString();
    const inicioMesSeguinte = new Date(ano, mes, 1).toISOString();
    const [solicitacoesResult, custosResult] = await Promise.all([
      supabase
        .from("ro_passagem_solicitacoes")
        .select(join)
        .order("created_at", { ascending: false }),
      supabase
        .from("ro_passagem_custos")
        .select(
          "id,solicitacao_id,tipo,descricao,valor,created_at,solicitacao:ro_passagem_solicitacoes!inner(id,status,motivo,houve_imprevisto,funcionario:funcionarios(id,nome),anexos:ro_passagem_anexos(complementar,imprevisto))",
        )
        .gte("created_at", inicioMes)
        .lt("created_at", inicioMesSeguinte)
        .gt("valor", 0),
    ]);
    setRows((solicitacoesResult.data || []) as unknown as Solicitacao[]);
    setCustosMensais(
      ((custosResult.data || []) as unknown as DashboardMonthlyCost[]).filter(
        (custo) => custo.solicitacao.status !== "cancelada",
      ),
    );
    setLoading(false);
  }, [mesReferencia]);
  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);
  useAutoFinalization(access.canViewAll, loadDashboard);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const compradas = new Set(
    custosMensais
      .filter((custo) => custo.tipo === "passagem")
      .map((custo) => custo.solicitacao_id),
  );
  const custosImprevistos = custosMensais.filter((custo) => {
    const descricao = custo.descricao?.toLocaleLowerCase("pt-BR") || "";
    return (
      custo.solicitacao.houve_imprevisto ||
      descricao.includes("complementar") ||
      descricao.includes("imprevisto") ||
      custo.solicitacao.anexos?.some(
        (anexo) => anexo.complementar || anexo.imprevisto,
      )
    );
  });
  const abertas = rows.filter(
    (r) => statusContaComoAberto(r.status),
  );
  const atrasadas = abertas.filter((r) => {
    const ida = new Date(`${r.data_ida}T00:00:00`);
    const limite = new Date(hoje);
    limite.setDate(
      limite.getDate() + (["ferias", "folga_campo"].includes(r.motivo || "") ? 2 : 0),
    );
    return ida <= limite;
  });
  const alerta = (motivo: Motivo) => {
    const custos = custosMensais.filter(
      (custo) => custo.solicitacao.motivo === motivo,
    );
    const itens = uniqueMonthlyRequests(custos);
    const custo = custos.reduce((s, item) => s + Number(item.valor), 0);
    return (
      <button
        className="card operational-alert dashboard-alert-button"
        type="button"
        onClick={() =>
          setCardSelecionado(
            motivo === "desligamento" ? "desligamento" : "transferencia",
          )
        }
      >
        <div>
          <strong>{motivoLabel[motivo]}</strong>
          <span>
            {itens.length} solicitação(ões) · {dinheiro(custo)}
          </span>
          <small>
            {itens
              .slice(0, 3)
              .map((x) => x.funcionario?.nome)
              .filter(Boolean)
              .join(", ") || "Nenhum custo no período"}
          </small>
        </div>
        <span className="dashboard-card-action">Ver solicitações</span>
      </button>
    );
  };
  const solicitacoesImprevisto = uniqueMonthlyRequests(custosImprevistos);
  const custoImprevistos = custosImprevistos.reduce(
    (total, custo) => total + Number(custo.valor),
    0,
  );
  const alertaImprevistos = (
    <button
      className="card operational-alert dashboard-alert-button"
      type="button"
      onClick={() => setCardSelecionado("imprevistos")}
    >
      <div>
        <strong>Imprevistos com passagens</strong>
        <span>
          {solicitacoesImprevisto.length} solicitação(ões) ·{" "}
          {dinheiro(custoImprevistos)}
        </span>
        <small>
          {solicitacoesImprevisto
            .slice(0, 3)
            .map((x) => x.funcionario?.nome)
            .filter(Boolean)
            .join(", ") || "Nenhum imprevisto no período"}
        </small>
      </div>
      <span className="dashboard-card-action">Ver solicitações</span>
    </button>
  );
  const consolidarFinanceiro = (
    custos: DashboardMonthlyCost[],
  ): DashboardDetailEntry[] => {
    const porSolicitacao = new Map<string, DashboardDetailEntry>();
    for (const custo of custos) {
      const solicitacao = rows.find((row) => row.id === custo.solicitacao_id);
      if (!solicitacao) continue;
      const atual = porSolicitacao.get(solicitacao.id) || {
        solicitacao,
        valor: 0,
      };
      atual.valor += Number(custo.valor);
      porSolicitacao.set(solicitacao.id, atual);
    }
    return [...porSolicitacao.values()];
  };
  const consolidarOperacional = (
    solicitacoes: Solicitacao[],
    atraso = false,
  ): DashboardDetailEntry[] =>
    solicitacoes.map((solicitacao) => ({
      solicitacao,
      valor: (solicitacao.custos || []).reduce(
        (total, custo) => total + Number(custo.valor),
        0,
      ),
      ...(atraso && {
        observacao: `Ida prevista: ${data(solicitacao.data_ida)}`,
      }),
    }));
  const custosCompradas = custosMensais.filter((custo) =>
    compradas.has(custo.solicitacao_id),
  );
  const custosDesligamento = custosMensais.filter(
    (custo) => custo.solicitacao.motivo === "desligamento",
  );
  const custosTransferencia = custosMensais.filter(
    (custo) => custo.solicitacao.motivo === "transferencia_obra",
  );
  const mesReferenciaLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${mesReferencia}-01T12:00:00`));
  const detalhesPorCard: Record<
    DashboardCardKey,
    { titulo: string; contexto: string; itens: DashboardDetailEntry[] }
  > = {
    abertas: {
      titulo: "Solicitações em aberto",
      contexto: "Situação operacional atual",
      itens: consolidarOperacional(abertas),
    },
    atrasadas: {
      titulo: "Solicitações atrasadas",
      contexto: "Situação operacional atual",
      itens: consolidarOperacional(atrasadas, true),
    },
    compradas: {
      titulo: "Compradas no mês",
      contexto: `Mês de referência: ${mesReferenciaLabel}`,
      itens: consolidarFinanceiro(custosCompradas),
    },
    desligamento: {
      titulo: "Desligamento",
      contexto: `Mês de referência: ${mesReferenciaLabel}`,
      itens: consolidarFinanceiro(custosDesligamento),
    },
    transferencia: {
      titulo: "Transferência de obra",
      contexto: `Mês de referência: ${mesReferenciaLabel}`,
      itens: consolidarFinanceiro(custosTransferencia),
    },
    imprevistos: {
      titulo: "Imprevistos com passagens",
      contexto: `Mês de referência: ${mesReferenciaLabel}`,
      itens: consolidarFinanceiro(custosImprevistos),
    },
  };
  const detalheCard = cardSelecionado
    ? detalhesPorCard[cardSelecionado]
    : null;
  return (
    <Page
      title="Painel"
      subtitle={`Visão geral das solicitações${access.isRO ? " da equipe RO" : ""}`}
      action={
        <Link className="btn primary" to="/nova">
          <Plus size={17} />
          Nova solicitação
        </Link>
      }
    >
      <EnvWarning />
      <section className="card dashboard-period">
        <label>
          Mês de referência
          <input
            type="month"
            value={mesReferencia}
            onChange={(event) => {
              if (event.target.value) {
                setMesReferencia(event.target.value);
                setCardSelecionado(undefined);
              }
            }}
          />
        </label>
        <small>
          Custos financeiros pela data de lançamento; fila operacional pelas
          solicitações em aberto.
        </small>
      </section>
      {loading ? (
        <Spinner />
      ) : (
        <>
          <h2 className="dashboard-section-title">Visão operacional</h2>
          <div className="stats dashboard-operational-stats">
            <Stat
              label="Solicitações em aberto"
              value={abertas.length}
              detail="Situação atual"
              onClick={() => setCardSelecionado("abertas")}
            />
            <Stat
              label="Solicitações atrasadas"
              value={atrasadas.length}
              detail="Situação atual"
              onClick={() => setCardSelecionado("atrasadas")}
            />
          </div>
          <h2 className="dashboard-section-title">Visão financeira mensal</h2>
          <div className="stats dashboard-financial-stats">
            <Stat
              label="Compradas no mês"
              value={compradas.size}
              detail="Mês selecionado"
              onClick={() => setCardSelecionado("compradas")}
            />
          </div>
          <div className="operational-alerts">
            {alerta("desligamento")}
            {alerta("transferencia_obra")}
            {alertaImprevistos}
          </div>
          <section className="card">
            <h2>Solicitações recentes</h2>
            {rows.length === 0 ? (
              <Empty />
            ) : (
              <div className="recent">
                {rows.slice(0, 5).map((r) => (
                  <Link to={`/solicitacoes/${r.id}`} key={r.id}>
                    <div>
                      <strong>{r.funcionario?.nome}</strong>
                      <span>
                        {r.origem} → {r.destino}
                      </span>
                    </div>
                    <StatusBadge status={statusLabel[r.status]} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {detalheCard && (
        <div
          className="dashboard-detail-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setCardSelecionado(undefined);
          }}
        >
          <section
            className="dashboard-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-detail-title"
          >
            <div className="dashboard-detail-head">
              <div>
                <h2 id="dashboard-detail-title">{detalheCard.titulo}</h2>
                <small>{detalheCard.contexto}</small>
              </div>
              <button
                className="btn secondary"
                type="button"
                onClick={() => setCardSelecionado(undefined)}
              >
                Fechar
              </button>
            </div>
            {!detalheCard.itens.length ? (
              <Empty text="Nenhuma solicitação encontrada para este indicador." />
            ) : (
              <div className="dashboard-detail-table">
                <table>
                  <thead>
                    <tr>
                      <th>Funcionário</th>
                      <th>Centro de custo</th>
                      <th>Motivo</th>
                      <th>Status</th>
                      <th>Data da solicitação</th>
                      <th>Valor</th>
                      <th>Observação</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalheCard.itens.map((item) => (
                      <tr key={item.solicitacao.id}>
                        <td>
                          {item.solicitacao.funcionario?.nome ||
                            "Não identificado"}
                        </td>
                        <td>
                          {formatCentroCustoLabel(item.solicitacao.obra)}
                        </td>
                        <td>
                          {formatMotivoLabel(item.solicitacao.motivo)}
                        </td>
                        <td>{statusLabel[item.solicitacao.status]}</td>
                        <td>{dataHora(item.solicitacao.created_at)}</td>
                        <td>
                          <strong>{dinheiro(item.valor)}</strong>
                        </td>
                        <td>{item.observacao || "—"}</td>
                        <td>
                          <Link
                            className="btn secondary"
                            to={`/solicitacoes/${item.solicitacao.id}`}
                          >
                            Abrir solicitação
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}
function Stat({
  label,
  value,
  money,
  detail = "Período atual",
  onClick,
}: {
  label: string;
  value: string | number;
  money?: boolean;
  detail?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong className={money ? "money" : ""}>{value}</strong>
      <small>{detail}</small>
      {onClick && <small className="dashboard-card-action">Ver solicitações</small>}
    </>
  );
  return onClick ? (
    <button className="stat dashboard-stat-button" type="button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="stat">{content}</div>
  );
}
export function Solicitacoes({
  access,
  userId,
}: {
  access: Access;
  userId: string;
}) {
  const { funcionarios, obras } = useCatalogos();
  const [searchParams, setSearchParams] = useSearchParams();
  const motivoParam = searchParams.get("motivo");
  const motivoInicial =
    motivoParam && motivoParam in motivoLabel ? motivoParam : "";
  const imprevistoAtivo = searchParams.get("imprevisto") === "true";
  const [rows, setRows] = useState<Solicitacao[]>([]);
  const [userLabels, setUserLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: "",
    motivo: motivoInicial,
    funcionario: "",
    obra: "",
    busca: "",
  });
  const responsavelId = (r: Solicitacao) =>
    (r as Solicitacao & { responsavel_ro_id?: string | null })
      .responsavel_ro_id;
  const assumidaEm = (r: Solicitacao) =>
    (r as Solicitacao & { assumida_em?: string | null }).assumida_em;
  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("ro_passagem_solicitacoes")
      .select(join)
      .order("created_at", { ascending: false });
    if (!access.canViewAll && !access.isRh) q = q.eq("solicitante_id", userId);
    const { data } = await q;
    const loaded = (data || []) as unknown as Solicitacao[];
    const ids = [
      ...new Set(
        loaded
          .flatMap((r) => [r.solicitante_id, responsavelId(r)])
          .filter(Boolean) as string[],
      ),
    ];
    const { data: labels } = ids.length
      ? await supabase.rpc("ro_user_labels", { p_user_ids: ids })
      : { data: [] };
    setUserLabels(
      Object.fromEntries(
        (labels || []).map((item: { id: string; label: string }) => [
          item.id,
          item.label,
        ]),
      ),
    );
    setRows(loaded);
    setLoading(false);
  }, [access.canViewAll, access.isRh, userId]);
  useAutoFinalization(access.canViewAll, load);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const motivo = searchParams.get("motivo");
    setFilters((current) => ({
      ...current,
      motivo: motivo && motivo in motivoLabel ? motivo : "",
    }));
  }, [searchParams]);
  function alterarMotivo(motivo: string) {
    setFilters({ ...filters, motivo });
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (motivo) next.set("motivo", motivo);
        else next.delete("motivo");
        return next;
      },
      { replace: true },
    );
  }
  function alterarImprevisto(ativo: boolean) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (ativo) next.set("imprevisto", "true");
        else next.delete("imprevisto");
        return next;
      },
      { replace: true },
    );
  }
  const shown = rows.filter(
    (r) =>
      (!filters.status ||
        (filters.status === "em_andamento"
          ? ["em_andamento", "em_analise"].includes(r.status)
          : r.status === filters.status)) &&
      (!filters.motivo || r.motivo === filters.motivo) &&
      (!imprevistoAtivo ||
        r.houve_imprevisto ||
        (r.anexos || []).some((a) => a.complementar || a.imprevisto)) &&
      (!filters.funcionario || r.funcionario_id === filters.funcionario) &&
      (!filters.obra || r.obra_id === filters.obra) &&
      (!filters.busca ||
        r.funcionario?.nome
          .toLowerCase()
          .includes(filters.busca.toLowerCase()) ||
        centroCustoMatches(r.obra || { nome: "" }, filters.busca) ||
        centroCustoMatches(r.centro_custo_destino || { nome: "" }, filters.busca) ||
        centroCustoMatches(r.centro_custo_retorno || { nome: "" }, filters.busca)),
  );
  return (
    <Page
      title="Solicitações"
      subtitle="Acompanhe passagens, status e custos"
      action={
        <Link to="/nova" className="btn primary">
          <Plus size={17} />
          Nova solicitação
        </Link>
      }
    >
      <div className="card filters">
        <label>
          <Search size={17} />
          <input
            placeholder="Buscar funcionário ou centro de custo"
            value={filters.busca}
            onChange={(e) => setFilters({ ...filters, busca: e.target.value })}
          />
        </label>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">Todos os status</option>
          {statusOptions.map(({ value, label }) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filters.motivo}
          onChange={(e) => alterarMotivo(e.target.value)}
        >
          <option value="">Todos os motivos</option>
          {Object.entries(motivoLabel).map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={imprevistoAtivo ? "true" : ""}
          onChange={(e) => alterarImprevisto(e.target.value === "true")}
        >
          <option value="">Todos os registros</option>
          <option value="true">Somente imprevistos</option>
        </select>
        <select
          value={filters.funcionario}
          onChange={(e) =>
            setFilters({ ...filters, funcionario: e.target.value })
          }
        >
          <option value="">Todos os funcionários</option>
          {funcionarios.map((x) => (
            <option value={x.id} key={x.id}>
              {x.nome}
            </option>
          ))}
        </select>
        <select
          value={filters.obra}
          onChange={(e) => setFilters({ ...filters, obra: e.target.value })}
        >
          <option value="">Todas as obras</option>
          {obras.map((x) => (
            <option value={x.id} key={x.id}>
              {formatCentroCustoLabel(x)}
            </option>
          ))}
        </select>
      </div>
      <div className="card table-card">
        {loading ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <Empty />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Funcionário</th>
                <th>Solicitante</th>
                {access.canViewAll && <th>Responsável RO</th>}
                <th>Trecho</th>
                <th>Motivo</th>
                <th>Data ida</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const roId = responsavelId(r);
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.funcionario?.nome || "—"}</strong>
                      <small>{formatCentroCustoLabel(r.obra) || "Sem obra"}</small>
                    </td>
                    <td>
                      <strong>
                        {userLabels[r.solicitante_id] ||
                          "Solicitante sem identificação"}
                      </strong>
                      {r.created_at && (
                        <small>Solicitada em {dataHora(r.created_at)}</small>
                      )}
                    </td>
                    {access.canViewAll && (
                      <td>
                        <strong>
                          {roId
                            ? userLabels[roId] ||
                              "Responsável sem identificação"
                            : "Ainda não assumida pelo RO"}
                        </strong>
                        {roId && assumidaEm(r) && (
                          <small>Assumida em {dataHora(assumidaEm(r))}</small>
                        )}
                      </td>
                    )}
                    <td>
                      {r.origem} → {r.destino}
                    </td>
                    <td>{formatMotivoLabel(r.motivo)}</td>
                    <td>{data(r.data_ida)}</td>
                    <td>
                      <StatusBadge status={statusLabel[r.status]} />
                    </td>
                    <td>
                      <Link className="icon" to={`/solicitacoes/${r.id}`}>
                        <Eye size={18} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}
export function NovaSolicitacao({ userId, access }: { userId: string; access: Access }) {
  const { funcionarios, obras } = useCatalogos();
  const nav = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [solicitante, setSolicitante] = useState("");
  const [solicitarExcecao, setSolicitarExcecao] = useState(false);
  const [dataPrazoErro, setDataPrazoErro] = useState(false);
  const [diasNaoUteis, setDiasNaoUteis] = useState<Array<{data:string;ativo:boolean}>>([]);
  const [anosCalendario, setAnosCalendario] = useState<Array<{ano:number;completo:boolean}>>([]);
  const [documento, setDocumento] = useState<File | null>(null);
  const [cicloFolga,setCicloFolga]=useState<CicloFolga|null>(null);
  const [cicloLoading,setCicloLoading]=useState(false);
  const [form, setForm] = useState({
    funcionario_id: "",
    obra_id: "",
    origem: "",
    destino: "",
    motivo: "" as Motivo | "",
    desligamento_subtipo: "" as DesligamentoSubtipo | "",
    data_ida: "",
    data_retorno: "",
    destino_retorno: "",
    centro_custo_retorno_id: "",
    retorno_indefinido: false,
    centro_custo_destino_id: "",
    justificativa_excecao_prazo: "",
    observacoes_solicitante: "",
    solicitacao_origem_id: "",
    folga_antecipacao_justificativa: "",
  });
  useEffect(() => {
    supabase
      .from("users_profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle()
      .then(async ({ data }) => {
        const user = (await supabase.auth.getUser()).data.user;
        setSolicitante(
          data?.full_name || user?.email || "Usuário sem identificação",
        );
      });
    Promise.all([
      supabase.from("ro_calendario_nao_util").select("data,ativo").eq("ativo", true),
      supabase.from("ro_calendario_anos").select("ano,completo"),
    ]).then(([dias, anos]) => { setDiasNaoUteis(dias.data || []); setAnosCalendario(anos.data || []); });
  }, [userId]);
  useEffect(()=>{
    const origem=(location.state as {refazer?:string}|null)?.refazer;
    if(!origem)return;
    supabase.rpc("ro_obter_dados_para_refazer_solicitacao",{p_solicitacao_id:origem}).then(({data:prefill,error})=>{
      if(error||!prefill){setErro("Não foi possível carregar os dados seguros da solicitação recusada.");return;}
      const p=prefill as Partial<typeof form>;
      const motivo=motivoPrefillPermitido(p.motivo as Motivo|null,motivosPermitidos(access.role,access.isRh));
      setForm((atual)=>normalizarCamposRetorno({...atual,funcionario_id:p.funcionario_id||"",obra_id:p.obra_id||"",origem:p.origem||"",destino:p.destino||"",motivo:motivo as Motivo|"",desligamento_subtipo:motivo==="desligamento"?(p.desligamento_subtipo||"") as DesligamentoSubtipo|"":"",data_ida:p.data_ida||"",data_retorno:p.data_retorno||"",destino_retorno:p.destino_retorno||"",centro_custo_retorno_id:p.centro_custo_retorno_id||"",retorno_indefinido:Boolean(p.retorno_indefinido),centro_custo_destino_id:p.centro_custo_destino_id||"",observacoes_solicitante:p.observacoes_solicitante||"",solicitacao_origem_id:String(prefill.solicitacao_origem_id||origem),justificativa_excecao_prazo:""}));
      setDocumento(null);
      if(!motivo&&p.motivo)setErro("O motivo original não está disponível para seu perfil. Selecione outro motivo permitido.");
    });
  },[access.isRh,access.role,location.state]);
  useEffect(()=>{
    setCicloFolga(null);
    setForm((atual)=>atual.motivo==="folga_campo"?atual:{...atual,folga_antecipacao_justificativa:""});
    if(form.motivo!=="folga_campo"||!form.funcionario_id)return;
    setCicloLoading(true);
    supabase.rpc("ro_obter_ciclo_folga_funcionario",{p_funcionario_id:form.funcionario_id}).then(({data,error})=>{setCicloFolga(error?null:data as CicloFolga);if(error)setErro("Não foi possível consultar o ciclo de folga de campo.");setCicloLoading(false);});
  },[form.funcionario_id,form.motivo]);
  const regra = regraPrazo(form.motivo || null, form.desligamento_subtipo || null);
  const calculo = calcularDataMinima(new Date(), regra.tipo, regra.quantidade, diasNaoUteis, anosCalendario);
  const idaMinima = calculo.data;
  const hojeLocal = calcularDataMinima(new Date(), "sem_prazo_minimo", 0).data;
  const gerencial = access.role === "gerente" || access.role === "diretor";
  const dataMinimaInput = dataMinimaDoInput(idaMinima, hojeLocal, gerencial, solicitarExcecao);
  const funcionarioSelecionado = funcionarios.find((x) => x.id === form.funcionario_id);
  const funcionarioRestrito = Boolean(
    funcionarioSelecionado &&
    funcionarioSelecionado.visivel_obras_control === false &&
    funcionarioSelecionado.visivel_passagens === true &&
    funcionarioSelecionado.escopo_passagens === "restrito_ro",
  );
  const foraPrazo =
    Boolean(form.data_ida) && form.data_ida < idaMinima;
  const folgaAntecipada=form.motivo==="folga_campo"&&dataAntecipaCiclo(form.data_ida,cicloFolga?.proxima_folga_prevista);
  useEffect(() => {
    setForm((atual) => {
      const data_ida = limparDataIdaInvalida(atual.data_ida, dataMinimaInput);
      if (data_ida === atual.data_ida) return atual;
      setDataPrazoErro(true);
      return { ...atual, data_ida };
    });
  }, [dataMinimaInput]);
  function pickFuncionario(id: string) {
    const f = funcionarios.find((x) => x.id === id);
    setForm({
      ...form,
      funcionario_id: id,
      obra_id: f?.obra_id || form.obra_id,
      motivo: f?.visivel_obras_control === false && f.visivel_passagens === true &&
        f.escopo_passagens === "restrito_ro" ? "" : form.motivo,
    });
  }
  function pickMotivo(motivo: Motivo | "") {
    const temRetorno = motivoPossuiRetorno(motivo);
    setForm(normalizarCamposRetorno({
      ...form,
      motivo,
      desligamento_subtipo: motivo === "desligamento" ? form.desligamento_subtipo : "",
      data_retorno: temRetorno ? form.data_retorno : "",
      destino_retorno: temRetorno ? form.destino_retorno : "",
      centro_custo_retorno_id: temRetorno ? form.centro_custo_retorno_id : "",
      retorno_indefinido: temRetorno ? form.retorno_indefinido : false,
      centro_custo_destino_id:
        motivo === "transferencia_obra" ? form.centro_custo_destino_id : "",
    }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!funcionarioRestrito && !form.motivo) {
      setErro("Selecione o motivo da solicitação.");
      return;
    }
    if (!form.data_ida || form.data_ida < dataMinimaInput) {
      setDataPrazoErro(true);
      setErro("Selecione uma data que atenda à antecedência mínima.");
      return;
    }
    if(form.motivo==="folga_campo"&&folgaFuturaBloqueia(cicloFolga)){setErro(`Já existe uma solicitação de folga de campo para este funcionário em ${data(cicloFolga?.solicitacao_futura_data)}.`);return;}
    if(folgaAntecipada&&!justificativaAntecipacaoValida(form.folga_antecipacao_justificativa)){setErro("A justificativa da antecipação deve ter pelo menos 10 caracteres úteis.");return;}
    if (foraPrazo && gerencial && solicitarExcecao && form.justificativa_excecao_prazo.trim().length < 10) {
      setErro(
        "A justificativa da exceção deve ter pelo menos 10 caracteres.",
      );
      return;
    }
    if (form.motivo === "desligamento" && !form.desligamento_subtipo) { setErro("Selecione o tipo de desligamento."); return; }
    const categoria = categoriaDocumento(form.desligamento_subtipo || null);
    if (categoria && !documento) { setErro("Anexe o documento interno obrigatório em PDF."); return; }
    if (calculo.anosPendentes.length) { setErro(`O calendário de dias não úteis de ${calculo.anosPendentes[0]} ainda não foi validado.`); return; }
    setBusy(true);
    const id = crypto.randomUUID(); const documentos: Array<Record<string,string|number>> = []; let uploadedPath="";
    if (documento && categoria) {
      const validacao=validatePdfFile(documento) || await validatePdfSignature(documento); if (validacao) { setErro(validacao); setBusy(false); return; }
      uploadedPath=`${id}/${categoria}/${crypto.randomUUID()}.pdf`;
      const up=await supabase.storage.from("ro-documentos-internos").upload(uploadedPath,documento,{contentType:"application/pdf"});
      if(up.error){setErro("Não foi possível enviar o documento interno.");setBusy(false);return;}
      documentos.push({categoria,storage_path:uploadedPath,arquivo_nome:documento.name,tamanho_bytes:documento.size});
    }
    const payload=normalizarCamposRetorno({...form,id,solicitar_excecao_prazo:gerencial&&solicitarExcecao});
    const { data: created, error } = await supabase.rpc("ro_criar_solicitacao_validada", { p_solicitacao:payload, p_documentos:documentos });
    if (error) {
      if(uploadedPath) await supabase.storage.from("ro-documentos-internos").remove([uploadedPath]);
      setErro(error.message.includes("CALENDARIO_INCOMPLETO") ? "O calendário de dias não úteis ainda não foi validado." : "Não foi possível criar a solicitação. Revise os dados e prazos.");
      setBusy(false);
      return;
    }
    nav(`/solicitacoes/${created}`);
  }
  return (
    <Page
      title="Nova solicitação"
      subtitle="Informe os dados previstos para o deslocamento"
    >
      <form className="card form" onSubmit={submit}>
        {erro && <div className="error wide">{erro}</div>}
        <label>
          Solicitante
          <input value={solicitante} readOnly />
        </label>
        <label>
          Funcionário *
          <select
            required
            value={form.funcionario_id}
            onChange={(e) => pickFuncionario(e.target.value)}
          >
            <option value="">Selecione</option>
            {funcionarios.map((x) => (
              <option value={x.id} key={x.id}>
                {x.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Centro de custo atual *
          <select
            required
            value={form.obra_id}
            onChange={(e) => setForm({ ...form, obra_id: e.target.value })}
          >
            <option value="">Selecione</option>
            {obras.map((x) => (
              <option value={x.id} key={x.id}>
                {formatCentroCustoLabel(x)}
              </option>
            ))}
          </select>
        </label>
        {form.motivo === "transferencia_obra" && (
          <label>
            Centro de custo destino *
            <select
              required
              value={form.centro_custo_destino_id}
              onChange={(e) =>
                setForm({ ...form, centro_custo_destino_id: e.target.value })
              }
            >
              <option value="">Selecione</option>
              {obras.map((x) => (
                <option value={x.id} key={x.id}>
                  {formatCentroCustoLabel(x)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Origem *
          <input
            required
            value={form.origem}
            onChange={(e) => setForm({ ...form, origem: e.target.value })}
            placeholder="Cidade / UF"
          />
        </label>
        <label>
          Destino *
          <input
            required
            value={form.destino}
            onChange={(e) => setForm({ ...form, destino: e.target.value })}
            placeholder="Cidade / UF"
          />
        </label>
        <label>
          Motivo{funcionarioRestrito ? "" : " *"}
          <select
            required={!funcionarioRestrito}
            value={form.motivo}
            onChange={(e) => pickMotivo(e.target.value as Motivo | "")}
          >
            <option value="">{funcionarioRestrito ? "Não se aplica" : "Selecione"}</option>
            {!funcionarioRestrito && Object.entries(motivoLabel)
              .filter(([v]) => motivosPermitidos(access.role, access.isRh).includes(v as Motivo))
              .map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
          </select>
        </label>
        {form.motivo === "desligamento" && <label>Tipo de desligamento *<select required value={form.desligamento_subtipo} onChange={(e)=>{setForm({...form,desligamento_subtipo:e.target.value as DesligamentoSubtipo});setDocumento(null);}}><option value="">Selecione</option><option value="programado_outros">Desligamento programado / outros</option><option value="justa_causa">Justa causa</option><option value="pedido_demissao">Pedido de demissão</option><option value="ma_conduta">Má conduta</option></select></label>}
        {mensagemAntecedencia(form.motivo || null, form.desligamento_subtipo || null) && <div className="alert wide">{mensagemAntecedencia(form.motivo || null, form.desligamento_subtipo || null)}</div>}
        {form.motivo==="folga_campo"&&form.funcionario_id&&<section className="alert wide cycle-info">{cicloLoading?<span>Consultando ciclo...</span>:cicloFolga?.possui_historico?<><strong>Última folga de campo: {data(cicloFolga.ultima_folga_realizada)}</strong><span>Próxima folga prevista: {data(cicloFolga.proxima_folga_prevista)}</span><span>Data recomendada para solicitar: {data(cicloFolga.data_limite_recomendada)}</span></>:<span>{SEM_HISTORICO_FOLGA}</span>}{cicloFolga?.solicitacao_futura_existente_id&&<strong>Já existe uma solicitação de folga de campo para este funcionário em {data(cicloFolga.solicitacao_futura_data)}. Status: {statusLabel[cicloFolga.solicitacao_futura_status as Status]||cicloFolga.solicitacao_futura_status}.</strong>}</section>}
        <label>
          Data de ida *
          <input
            type="date"
            required
            min={dataMinimaInput}
            value={form.data_ida}
            onChange={(e) => { setDataPrazoErro(false); setForm({ ...form, data_ida: e.target.value }); }}
          />
          {dataPrazoErro && <small className="error">Selecione uma data que atenda à antecedência mínima.</small>}
        </label>
        {folgaAntecipada&&<label className="wide">Justificativa da antecipação *<textarea required minLength={10} rows={3} value={form.folga_antecipacao_justificativa} onChange={(e)=>setForm({...form,folga_antecipacao_justificativa:e.target.value})}/><small>Esta data antecipa o ciclo previsto da folga de campo. A equipe RO deverá aprovar a antecipação antes da compra da passagem.</small></label>}
        {categoriaDocumento(form.desligamento_subtipo || null) && <label className="wide">Documento interno obrigatório — {form.desligamento_subtipo === "justa_causa" ? "Termo de justa causa" : "Carta de pedido de demissão"}<input type="file" accept="application/pdf,.pdf" required onChange={(e)=>setDocumento(e.target.files?.[0] || null)}/><small>Somente PDF, até 10 MB. Acesso interno restrito.</small></label>}
        {motivoPossuiRetorno(form.motivo) && (
          <>
            <label>
              Data de retorno
              <input
                type="date"
                min={form.data_ida}
                value={form.data_retorno}
                onChange={(e) =>
                  setForm({ ...form, data_retorno: e.target.value })
                }
              />
            </label>
            {!form.retorno_indefinido && <label>
              Destino de retorno — Cidade/UF
              <input
                value={form.destino_retorno}
                onChange={(e) => setForm({ ...form, destino_retorno: e.target.value })}
                placeholder="Cidade / UF"
              />
            </label>}
            {!form.retorno_indefinido && <label>
              Centro de custo de retorno
              <select
                value={form.centro_custo_retorno_id}
                onChange={(e) =>
                  setForm({ ...form, centro_custo_retorno_id: e.target.value })
                }
              >
                <option value="">Ainda não definido</option>
                {obras.map((x) => (
                  <option value={x.id} key={x.id}>
                    {formatCentroCustoLabel(x)}
                  </option>
                ))}
              </select>
            </label>}
            <label className="checkbox wide">
              <input
                type="checkbox"
                checked={form.retorno_indefinido}
                onChange={(e) =>
                  setForm({
                    ...form,
                    retorno_indefinido: e.target.checked,
                    destino_retorno: e.target.checked ? "" : form.destino_retorno,
                    centro_custo_retorno_id: e.target.checked
                      ? ""
                      : form.centro_custo_retorno_id,
                  })
                }
              />{" "}
              Retorno indefinido
            </label>
          </>
        )}
        {gerencial && <label className="checkbox wide"><input type="checkbox" checked={solicitarExcecao} onChange={(e)=>{const marcada=e.target.checked;setSolicitarExcecao(marcada);setDataPrazoErro(false);setForm((atual)=>({...atual,justificativa_excecao_prazo:marcada?atual.justificativa_excecao_prazo:"",data_ida:marcada?atual.data_ida:limparDataIdaInvalida(atual.data_ida,idaMinima)}));}} /> Solicitar exceção de prazo</label>}
        {gerencial && solicitarExcecao && (
          <label className="wide">
            Justificativa da exceção *
            <textarea
              required
              rows={3}
              value={form.justificativa_excecao_prazo}
              onChange={(e) =>
                setForm({
                  ...form,
                  justificativa_excecao_prazo: e.target.value,
                })
              }
            />
          </label>
        )}
        <label className="wide">
          Observações
          <textarea
            rows={4}
            value={form.observacoes_solicitante}
            onChange={(e) =>
              setForm({ ...form, observacoes_solicitante: e.target.value })
            }
          />
        </label>
        <div className="actions wide">
          <Link className="btn secondary" to="/solicitacoes">
            Cancelar
          </Link>
          <button className="btn primary" disabled={busy}>
            {busy ? "Criando..." : "Criar solicitação"}
          </button>
        </div>
      </form>
    </Page>
  );
}

type ResponsibleAdminUser = { id: string; full_name?: string | null; email?: string | null };
type ResponsibleAdminRow = { id: string; user_id: string; ativo: boolean };

function ResponsibleAdminSection({ users, rows, selected, onSelect, onSearch, onAdd, onToggle, busy, loading, emptyText }: {
  users: ResponsibleAdminUser[]; rows: ResponsibleAdminRow[]; selected: string;
  onSelect: (userId: string) => void; onSearch?: (search: string) => void; onAdd: () => void; onToggle: (row: ResponsibleAdminRow) => void;
  busy: string | null; loading: boolean; emptyText: string;
}) {
  const selectedIds = new Set(rows.map((row) => row.user_id));
  const available = users.filter((user) => !selectedIds.has(user.id));
  const userLabel = (user?: ResponsibleAdminUser) => user ? [user.full_name, user.email].filter(Boolean).join(" — ") || user.id : "";
  const [search, setSearch] = useState("");
  useEffect(() => { if (!selected) setSearch(""); }, [selected]);
  function searchUser(value: string) {
    setSearch(value);
    onSearch?.(value);
    const found = available.find((user) => userLabel(user) === value);
    onSelect(found?.id || "");
  }
  return <>
    <div className="card add-ro" aria-busy={busy === "add"}>
      <Users aria-hidden="true" />
      <label className="sr-only" htmlFor="responsible-user-select">Selecione um usuário</label>
      <input id="responsible-user-select" type="search" list="responsible-user-options" value={search} placeholder="Selecione um usuário" autoComplete="off" onChange={(event) => searchUser(event.target.value)} disabled={loading || busy !== null} />
      <datalist id="responsible-user-options">{available.map((user) => <option key={user.id} value={userLabel(user)} />)}</datalist>
      <button className="btn primary" type="button" disabled={!selected || loading || busy !== null} onClick={onAdd}>
        <Plus size={17} aria-hidden="true" />{busy === "add" ? "Adicionando..." : "Adicionar"}
      </button>
    </div>
    <div className="card ro-list" aria-busy={loading || (busy !== null && busy !== "add")}>
      {loading ? <Spinner /> : rows.length ? rows.map((row) => {
        const user = users.find((candidate) => candidate.id === row.user_id);
        const label = userLabel(user) || row.user_id;
        return <div key={row.id}><div><strong>{label}</strong><small>{row.ativo ? "Responsável ativo" : "Responsável inativo"}</small></div><button className={`btn ${row.ativo ? "danger" : "secondary"}`} type="button" disabled={busy !== null} aria-label={`${row.ativo ? "Inativar" : "Reativar"} ${label}`} onClick={() => onToggle(row)}>{busy === row.id ? "Salvando..." : row.ativo ? "Inativar" : "Reativar"}</button></div>;
      }) : <Empty text={emptyText} />}
    </div>
  </>;
}

export function ConfiguracoesRH({ secao }: { secao?: "rh" | "calendario" } = {}) {
  const [abaInterna,setAbaInterna]=useState<"rh"|"calendario">("rh");
  const aba = secao || abaInterna;
  const [rh,setRh]=useState<Array<{user_id:string;ativo:boolean;perfil?:Perfil}>>([]);
  const [usuarios,setUsuarios]=useState<Perfil[]>([]); const [busca,setBusca]=useState("");
  const [selectedRh,setSelectedRh]=useState("");
  const [rhBusy,setRhBusy]=useState<string|null>(null);
  const [rhLoading,setRhLoading]=useState(true);
  const [dias,setDias]=useState<Array<{id:string;data:string;descricao:string;tipo:string;abrangencia:string;estado:string|null;municipio:string|null;ativo:boolean}>>([]);
  const [anoStatus,setAnoStatus]=useState<{completo:boolean}|null>(null);
  const [ano,setAno]=useState(new Date().getFullYear()); const [mensagem,setMensagem]=useState("");
  const [novo,setNovo]=useState({data:"",descricao:"",tipo:"feriado",abrangencia:"nacional"});
  const carregar=useCallback(async()=>{
    const [r,u,c,a]=await Promise.all([
      supabase.from("ro_rh_responsaveis").select("user_id,ativo"),
      supabase.rpc("ro_admin_user_search",{p_search:busca}),
      supabase.from("ro_calendario_nao_util").select("id,data,descricao,tipo,abrangencia,estado,municipio,ativo").gte("data",`${ano}-01-01`).lte("data",`${ano}-12-31`).order("data"),
      supabase.from("ro_calendario_anos").select("completo").eq("ano",ano).maybeSingle(),
    ]); const perfis=(u.data||[]) as Perfil[]; setUsuarios(perfis); setRh((r.data||[]).map((x)=>({...x,perfil:perfis.find((p)=>p.id===x.user_id)}))); setDias(c.data||[]); setAnoStatus(a.data); setRhLoading(false);
  },[ano,busca]);
  useEffect(()=>{carregar();},[carregar]);
  async function salvarRh(userId:string,ativo:boolean,busyId:string){if(rhBusy)return;setRhBusy(busyId);const {error}=await supabase.from("ro_rh_responsaveis").upsert({user_id:userId,ativo},{onConflict:"user_id"});setMensagem(error?"Não foi possível alterar a equipe RH.":"Equipe RH atualizada.");if(!error&&busyId==="add")setSelectedRh("");await carregar();setRhBusy(null);}
  async function adicionarDia(e:React.FormEvent){e.preventDefault();const local=novo.abrangencia==="estadual"?{estado:"SP",municipio:null}:novo.abrangencia==="municipal"?{estado:"SP",municipio:"Rio Claro"}:{estado:null,municipio:null};const {error}=await supabase.from("ro_calendario_nao_util").insert({...novo,...local});setMensagem(error?"Não foi possível cadastrar a data.":"O calendário foi alterado. Revise as datas e valide novamente o ano.");await carregar();}
  async function validarAno(completo:boolean){const {error}=await supabase.from("ro_calendario_anos").upsert({ano,completo},{onConflict:"ano"});setMensagem(error?"Não foi possível validar o ano.":completo?"Ano validado.":"Ano marcado como incompleto.");await carregar();}
  async function editarDescricao(id:string,atual:string){const descricao=window.prompt("Nova descrição",atual)?.trim();if(!descricao)return;await supabase.from("ro_calendario_nao_util").update({descricao}).eq("id",id);await carregar();}
  async function alternarDia(id:string,ativo:boolean){const {error}=await supabase.from("ro_calendario_nao_util").update({ativo:!ativo}).eq("id",id);setMensagem(error?"Não foi possível alterar a data.":"O calendário foi alterado. Revise as datas e valide novamente o ano.");await carregar();}
  const ativos=dias.filter((d)=>d.ativo).length; const pendentes=dias.length-ativos;
  const tipoLabel:Record<string,string>={feriado:"Feriado",ponto_facultativo:"Ponto facultativo / dia-ponte",convencao_coletiva:"Convenção coletiva",recesso:"Recesso"};
  const abrangenciaLabel:Record<string,string>={nacional:"Nacional",estadual:"Estadual — SP",municipal:"Municipal — Rio Claro/SP",empresa:"Empresa"};
  const conteudo = <>
    {!secao && <div className="actions"><button className={`btn ${aba==="rh"?"primary":"secondary"}`} onClick={()=>setAbaInterna("rh")}>Equipe RH</button><button className={`btn ${aba==="calendario"?"primary":"secondary"}`} onClick={()=>setAbaInterna("calendario")}>Calendário de dias não úteis</button></div>}
    {mensagem&&<div className="alert">{mensagem}</div>}
    {aba==="rh"?<ResponsibleAdminSection users={usuarios} rows={rh.map((row)=>({id:row.user_id,user_id:row.user_id,ativo:row.ativo}))} selected={selectedRh} onSelect={setSelectedRh} onSearch={setBusca} onAdd={()=>selectedRh&&!rh.some((row)=>row.user_id===selectedRh)&&salvarRh(selectedRh,true,"add")} onToggle={(row)=>salvarRh(row.user_id,!row.ativo,row.id)} busy={rhBusy} loading={rhLoading} emptyText="Nenhum responsável RH cadastrado."/>:<><div className="card calendar-toolbar"><label>Ano<input type="number" value={ano} onChange={(e)=>setAno(Number(e.target.value))}/></label><div className="calendar-summary"><strong>{dias.length} datas cadastradas</strong><span>{ativos} ativas</span><span>{pendentes} pendentes</span><span className={`badge ${anoStatus?.completo?"calendar-active":"calendar-pending"}`}>Ano {ano} {anoStatus?.completo?"validado":"incompleto"}</span></div><div className="actions"><button className="btn primary" onClick={()=>validarAno(true)}>Marcar ano como validado</button><button className="btn secondary" onClick={()=>validarAno(false)}>Marcar incompleto</button></div></div><form className="card form" onSubmit={adicionarDia}><h2 className="wide">Adicionar data excepcional</h2><label>Data *<input type="date" required value={novo.data} onChange={(e)=>setNovo({...novo,data:e.target.value})}/></label><label>Descrição *<input required value={novo.descricao} onChange={(e)=>setNovo({...novo,descricao:e.target.value})}/></label><label>Tipo<select value={novo.tipo} onChange={(e)=>setNovo({...novo,tipo:e.target.value})}><option value="feriado">Feriado</option><option value="ponto_facultativo">Ponto facultativo / dia-ponte</option><option value="convencao_coletiva">Convenção coletiva</option><option value="recesso">Recesso</option></select></label><label>Abrangência<select value={novo.abrangencia} onChange={(e)=>setNovo({...novo,abrangencia:e.target.value})}><option value="nacional">Nacional</option><option value="estadual">Estadual — SP</option><option value="municipal">Municipal — Rio Claro/SP</option><option value="empresa">Empresa</option></select></label><button className="btn primary">Cadastrar</button></form><div className="card calendar-list">{dias.length?dias.map((d)=><div className={`calendar-row ${d.tipo==="recesso"&&!d.ativo?"calendar-recess-pending":""}`} key={d.id}><div><strong>{data(d.data)} — {d.descricao}</strong><small>{tipoLabel[d.tipo]||d.tipo} · {abrangenciaLabel[d.abrangencia]||d.abrangencia}</small></div><span className={`badge ${d.ativo?"calendar-active":"calendar-pending"}`}>{d.ativo?"Ativo":"Pendente/Inativo"}</span><div className="actions"><button className="btn secondary" onClick={()=>editarDescricao(d.id,d.descricao)}>Editar descrição</button><button className="btn secondary" onClick={()=>alternarDia(d.id,d.ativo)}>{d.ativo?"Desativar":"Ativar"}</button></div></div>):<Empty text="Nenhuma data cadastrada para este ano."/>}</div></>}
  </>;
  return secao ? conteudo : <Page title="Configurações de RH" subtitle="Acesso exclusivo da administradora Fernanda">{conteudo}</Page>;
}

type AbaConfiguracoes = "responsaveis-ro" | "responsaveis-rh" | "calendario" | "importacoes";
const ABAS_CONFIGURACOES: Array<{ id: AbaConfiguracoes; label: string }> = [
  { id: "responsaveis-ro", label: "Responsáveis RO" },
  { id: "responsaveis-rh", label: "Responsáveis RH" },
  { id: "calendario", label: "Calendário da empresa" },
  { id: "importacoes", label: "Importações" },
];

export function Configuracoes() {
  const [params, setParams] = useSearchParams();
  const solicitada = params.get("aba");
  const aba = ABAS_CONFIGURACOES.some(({ id }) => id === solicitada)
    ? solicitada as AbaConfiguracoes
    : "responsaveis-ro";
  const tipo = params.get("tipo") === "centros-custo" ? "centros-custo" : "funcionarios";

  function selecionarAba(proxima: AbaConfiguracoes) {
    const next = new URLSearchParams({ aba: proxima });
    if (proxima === "importacoes") next.set("tipo", tipo);
    setParams(next, { replace: true });
  }
  function navegarTeclado(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const destino = event.key === 'Home' ? 0 : event.key === 'End' ? ABAS_CONFIGURACOES.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + ABAS_CONFIGURACOES.length) % ABAS_CONFIGURACOES.length;
    selecionarAba(ABAS_CONFIGURACOES[destino].id);
    requestAnimationFrame(() => document.getElementById(`aba-${ABAS_CONFIGURACOES[destino].id}`)?.focus());
  }

  return <Page title="Configurações" subtitle="Administração do RO Passagens">
    <div className="settings-tabs" role="tablist" aria-label="Seções de configurações">
      {ABAS_CONFIGURACOES.map((item, index) => <button
        id={`aba-${item.id}`} key={item.id} type="button" role="tab"
        aria-selected={aba === item.id} aria-controls="painel-configuracoes"
        tabIndex={aba === item.id ? 0 : -1} className={aba === item.id ? "active" : ""}
        onClick={() => selecionarAba(item.id)} onKeyDown={(event) => navegarTeclado(event, index)}
      >{item.label}</button>)}
    </div>
    <section id="painel-configuracoes" className="settings-panel" role="tabpanel" aria-labelledby={`aba-${aba}`}>
      {aba === "responsaveis-ro" && <Responsaveis embedded />}
      {aba === "responsaveis-rh" && <ConfiguracoesRH secao="rh" />}
      {aba === "calendario" && <ConfiguracoesRH secao="calendario" />}
      {aba === "importacoes" && <div className="settings-imports">
        <div className="settings-subtabs" aria-label="Tipo de importação">
          <button type="button" className={`btn ${tipo === "funcionarios" ? "primary" : "secondary"}`} onClick={() => setParams({ aba: "importacoes", tipo: "funcionarios" }, { replace: true })}>Funcionários</button>
          <button type="button" className={`btn ${tipo === "centros-custo" ? "primary" : "secondary"}`} onClick={() => setParams({ aba: "importacoes", tipo: "centros-custo" }, { replace: true })}>Centros de custo</button>
        </div>
        <div hidden={tipo !== "funcionarios"}><ImportacaoFuncionarios embedded /></div>
        <div hidden={tipo !== "centros-custo"}><ImportacaoCentrosCusto embedded /></div>
      </div>}
    </section>
  </Page>;
}

export function Detalhe({ access, userId }: { access: Access; userId: string }) {
  const { id } = useParams();
  const [row, setRow] = useState<Solicitacao | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [documentosInternos,setDocumentosInternos]=useState<Array<{id:string;categoria:string;arquivo_nome:string;storage_path:string;url?:string}>>([]);
  const load = useCallback(() => {
    if (!id) return;
    supabase
      .from("ro_passagem_solicitacoes")
      .select(join)
      .eq("id", id)
      .single()
      .then(async ({ data: found, error }) => {
        if (found) {
          const responsavelId = (found as { responsavel_ro_id?: string | null })
            .responsavel_ro_id;
          const anexos = (found.anexos || []) as Anexo[];
          const criadorAnexoId = (anexo: Anexo) =>
            anexo.criado_por || anexo.uploaded_by;
          const ids = [
            found.solicitante_id,
            responsavelId,
            found.recusada_por,
            found.folga_antecipacao_analisada_por,
            ...anexos.map(criadorAnexoId),
          ].filter(Boolean) as string[];
          const { data: labels } = await supabase.rpc("ro_user_labels", {
            p_user_ids: ids,
          });
          const labelMap = new Map(
            (labels || []).map((item: { id: string; label: string }) => [
              item.id,
              item.label,
            ]),
          );
          setRow({
            ...found,
            solicitante: {
              id: found.solicitante_id,
              full_name:
                labelMap.get(found.solicitante_id) ||
                "Solicitante sem identificação",
            },
            responsavel_ro_nome: responsavelId
              ? labelMap.get(responsavelId) || "Responsável sem identificação"
              : null,
            recusada_por_nome: found.recusada_por
              ? labelMap.get(found.recusada_por) || "Integrante RO sem identificação"
              : null,
            folga_antecipacao_analisada_por_nome: found.folga_antecipacao_analisada_por?labelMap.get(found.folga_antecipacao_analisada_por)||"Integrante RO sem identificação":null,
            anexos: anexos.map((a) => ({
              ...a,
              criado_por_nome:
                (criadorAnexoId(a)
                  ? labelMap.get(criadorAnexoId(a) as string)
                  : null) ||
                (responsavelId ? labelMap.get(responsavelId) : null) ||
                null,
            })),
          } as unknown as Solicitacao);
        } else setRow(null);
        setErro(error?.message || "");
        setLoading(false);
      });
  }, [id]);
  useEffect(load, [load]);
  useEffect(()=>{if(!id || !(access.isRh||access.isRO||access.isAdmin))return;supabase.from("ro_passagem_documentos_internos").select("id,categoria,arquivo_nome,storage_path").eq("solicitacao_id",id).then(async({data})=>{const docs=await Promise.all((data||[]).map(async(d)=>{const signed=await supabase.storage.from("ro-documentos-internos").createSignedUrl(d.storage_path,300);return {...d,url:signed.data?.signedUrl};}));setDocumentosInternos(docs);});},[id,access.isRh,access.isRO,access.isAdmin]);
  if (loading)
    return (
      <Page title="Solicitação">
        <Spinner />
      </Page>
    );
  if (!row)
    return (
      <Page title="Solicitação">
        <div className="error">{erro || "Registro não encontrado."}</div>
      </Page>
    );
  return (
    <Page
      title={row.funcionario?.nome || "Solicitação"}
      subtitle={`Criada em ${dataHora(row.created_at)}`}
      action={
        <Link className="btn secondary" to="/solicitacoes">
          <ArrowLeft size={17} />
          Voltar
        </Link>
      }
    >
      <div className="detail-head">
        <StatusBadge status={statusLabel[row.status]} />
        <span>{formatMotivoLabel(row.motivo)}</span>
        {row.motivo === "desligamento" && (
          <span className="sensitive">
            Notificação ao funcionário bloqueada
          </span>
        )}
      </div>
      {row.status === "recusada" && <section className="card rejection-summary"><h2>Solicitação recusada</h2><DT t="Motivo" v={row.motivo_recusa} /><DT t="Recusada por" v={(row as Solicitacao & {recusada_por_nome?:string|null}).recusada_por_nome} /><DT t="Data" v={dataHora(row.recusada_em)} /></section>}
      {row.motivo==="folga_campo"&&row.folga_antecipada&&<section className="card cycle-detail"><h2>Antecipação de folga de campo</h2><DT t="Data prevista do ciclo" v={data(row.folga_data_prevista_ciclo)}/><DT t="Data antecipada solicitada" v={data(row.data_ida)}/><DT t="Dias antecipados" v={row.folga_data_prevista_ciclo?String(Math.round((new Date(`${row.folga_data_prevista_ciclo}T12:00:00`).getTime()-new Date(`${row.data_ida}T12:00:00`).getTime())/86400000)):null}/><DT t="Justificativa" v={row.folga_antecipacao_justificativa}/><DT t="Status da análise" v={row.folga_antecipacao_status}/>{row.folga_antecipacao_status==="aprovada"&&<><DT t="Analisada por" v={(row as Solicitacao&{folga_antecipacao_analisada_por_nome?:string|null}).folga_antecipacao_analisada_por_nome}/><DT t="Analisada em" v={dataHora(row.folga_antecipacao_analisada_em)}/></>}{access.canOperateRO&&row.folga_antecipacao_status==="pendente"&&<AprovarAntecipacao row={row} onDone={load}/>}</section>}
      <section className="card detail request-data">
        <h2>Dados da solicitação</h2>
        <dl>
          <DT t="Funcionário" v={row.funcionario?.nome} />
          <DT
            t="Solicitante"
            v={row.solicitante?.full_name || "Solicitante sem identificação"}
          />
          <DT
            t="Responsável RO"
            v={
              (row as Solicitacao & { responsavel_ro_nome?: string | null })
                .responsavel_ro_nome || "Ainda não assumida pelo RO"
            }
          />
          <DT
            t="Assumida em"
            v={dataHora(
              (row as Solicitacao & { assumida_em?: string | null })
                .assumida_em,
            )}
          />
          <DT t="Centro de custo atual" v={formatCentroCustoLabel(row.obra)} />
          <DT t="Centro de custo destino" v={formatCentroCustoLabel(row.centro_custo_destino)} />
          <DT t="Origem" v={row.origem} />
          <DT t="Destino" v={row.destino} />
          <DT t="Ida prevista" v={data(row.data_ida)} />
          {(access.isRh||access.isRO||access.isAdmin)&&row.desligamento_subtipo&&<DT t="Tipo de desligamento" v={row.desligamento_subtipo.replaceAll("_"," ")} />}
          {motivoPossuiRetorno(row.motivo) && (
            <>
              <DT t="Retorno previsto" v={data(row.data_retorno)} />
              {row.retorno_indefinido ? <DT t="Retorno indefinido" v="Sim" /> : <>
                {row.destino_retorno && <DT t="Destino de retorno" v={row.destino_retorno} />}
                {row.centro_custo_retorno_id && <DT t="Centro de custo de retorno" v={formatCentroCustoLabel(row.centro_custo_retorno)} />}
              </>}
            </>
          )}
          <DT
            t="Justificativa de exceção"
            v={row.justificativa_excecao_prazo}
          />
          <DT t="Observações" v={row.observacoes_solicitante} />
        </dl>
      </section>
      {(access.isRh||access.isRO||access.isAdmin)&&documentosInternos.length>0&&<section className="card"><h2>Documentos internos restritos</h2>{documentosInternos.map((d)=><div className="actions" key={d.id}><span>{d.categoria==="termo_justa_causa"?"Termo de justa causa":"Carta de pedido de demissão"}</span>{d.url&&<a className="btn secondary" href={d.url} target="_blank" rel="noreferrer">Abrir PDF</a>}</div>)}</section>}
      {access.canOperateRO && <RecusarSolicitacao row={row} onDone={load} />}
      {row.status === "recusada" && row.solicitante_id === userId && <div className="actions rejection-recreate"><Link className="btn primary" to="/nova" state={{refazer:row.id}}>Criar nova a partir desta</Link></div>}
      {access.canOperateRO && row.status === "solicitada" && (
        <Assumir row={row} onDone={load} />
      )}
      {access.canOperateRO && !["solicitada","recusada"].includes(row.status) && (
        <Operacoes row={row} onDone={load} />
      )}
      {access.canOperateRO &&
        ["em_analise", "em_andamento"].includes(row.status) && compraFolgaLiberada(row.folga_antecipacao_status) && (
          <Compra row={row} onDone={load} />
        )}
      {access.canOperateRO && row.status === "passagem_comprada" && (
        <Compra row={row} onDone={load} complementar />
      )}
      <PassagemComprada
        anexos={row.anexos || []}
        custos={row.custos || []}
        canViewCosts={canViewFinancialCosts(access)}
      />
      <div className="grid two detail">
        <section className="card">
          <h2>Notificações</h2>
          {!row.notificacoes?.length ? (
            <Empty />
          ) : (
            <div className="timeline">
              {deduplicateNotifications(row.notificacoes).map((n) => (
                <div key={n.id}>
                  <i />
                  <div>
                    <strong>{n.destinatario_tipo}</strong>
                    <p>{n.mensagem}</p>
                    <small>
                      {dataHora(n.created_at)} · {n.status}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <h2>Histórico</h2>
          <div className="timeline">
            {row.historico?.map((h) => (
              <div key={h.id}>
                <i />
                <div>
                  <strong>
                    {h.status_novo
                      ? statusLabel[h.status_novo as Status] || h.status_novo
                      : "Registro"}
                  </strong>
                  <p>{h.descricao}</p>
                  <small>{dataHora(h.created_at)}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}
function RecusarSolicitacao({row,onDone}:{row:Solicitacao;onDone:()=>void}) {
  const [aberto,setAberto]=useState(false);
  const [motivo,setMotivo]=useState("");
  const [busy,setBusy]=useState(false);
  const [erro,setErro]=useState("");
  if(!podeRecusarSolicitacao(true,row))return null;
  const util=motivo.trim();
  async function confirmar(){
    if(busy||!motivoRecusaValido(util))return;
    setBusy(true);setErro("");
    const {error}=await supabase.rpc("ro_recusar_solicitacao",{p_solicitacao_id:row.id,p_motivo:util});
    if(error){
      const mensagens:Record<string,string>={NAO_PERTENCE_EQUIPE_RO:"Somente integrantes ativos da equipe RO podem recusar.",SOLICITACAO_NAO_ENCONTRADA:"Solicitação não encontrada.",SOLICITACAO_JA_RECUSADA:"Esta solicitação já foi recusada.",PASSAGEM_JA_COMPRADA:"A passagem já foi comprada e não pode mais ser recusada.",STATUS_NAO_PERMITE_RECUSA:"O status atual não permite recusa.",MOTIVO_RECUSA_OBRIGATORIO:"Informe ao menos 10 caracteres úteis."};
      setErro(Object.entries(mensagens).find(([codigo])=>error.message.includes(codigo))?.[1]||"Não foi possível recusar a solicitação.");setBusy(false);return;
    }
    setAberto(false);setMotivo("");setBusy(false);onDone();
  }
  return <>
    <section className="card rejection-action"><h2>Análise imediata</h2><p>Se houver dados ou documentos incorretos, recuse antes de registrar a compra.</p><button className="btn danger" onClick={()=>setAberto(true)}>Recusar solicitação</button></section>
    {aberto&&<div className="rejection-backdrop" role="dialog" aria-modal="true" aria-labelledby="rejection-title"><div className="rejection-modal"><h2 id="rejection-title">Recusar solicitação</h2><div className="error">Esta ação é definitiva. O solicitante precisará criar uma nova solicitação com os dados corrigidos.</div>{erro&&<div className="error">{erro}</div>}<label>Motivo da recusa *<textarea rows={5} value={motivo} onChange={(e)=>setMotivo(e.target.value)} autoFocus/><small>{util.length}/10 caracteres mínimos</small></label><div className="actions"><button className="btn secondary" disabled={busy} onClick={()=>{setAberto(false);setErro("");}}>Cancelar</button><button className="btn danger" disabled={busy||!motivoRecusaValido(util)} onClick={confirmar}>{busy?"Recusando...":"Confirmar recusa"}</button></div></div></div>}
  </>;
}
function AprovarAntecipacao({row,onDone}:{row:Solicitacao;onDone:()=>void}){const[busy,setBusy]=useState(false);const[erro,setErro]=useState("");async function aprovar(){if(busy)return;setBusy(true);const{error}=await supabase.rpc("ro_aprovar_antecipacao_folga",{p_solicitacao_id:row.id});setErro(error?"Não foi possível aprovar a antecipação.":"");setBusy(false);if(!error)onDone();}return <div className="wide">{erro&&<div className="error">{erro}</div>}<button className="btn primary" disabled={busy} onClick={aprovar}>{busy?"Aprovando...":"Aprovar antecipação"}</button></div>}
function Assumir({ row, onDone }: { row: Solicitacao; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  async function assumir() {
    setBusy(true);
    const { error } = await supabase.rpc("ro_alterar_status", {
      p_solicitacao_id: row.id,
      p_status: "em_andamento",
    });
    setErro(error?.message || "");
    setBusy(false);
    if (!error) onDone();
  }
  return (
    <section className="card operations">
      <h2>Ações operacionais</h2>
      {erro && <div className="error">{erro}</div>}
      <p>
        Marque a solicitação como Em andamento antes de executar ações
        operacionais.
      </p>
      <button className="btn primary" disabled={busy} onClick={assumir}>
        {busy ? "Assumindo..." : "Assumir solicitação"}
      </button>
    </section>
  );
}
function Operacoes({ row, onDone }: { row: Solicitacao; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  async function andamento() {
    setBusy(true);
    const { error } = await supabase.rpc("ro_alterar_status", {
      p_solicitacao_id: row.id,
      p_status: "em_andamento",
    });
    setErro(error?.message || "");
    setBusy(false);
    if (!error) onDone();
  }
  async function cancelar() {
    if (!window.confirm("Cancelar esta solicitação?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("ro_alterar_status", {
      p_solicitacao_id: row.id,
      p_status: "cancelada",
    });
    setErro(error?.message || "");
    setBusy(false);
    if (!error) onDone();
  }
  if (["finalizada", "cancelada", "recusada"].includes(row.status)) return null;
  return (
    <section className="card operations">
      <h2>Ações operacionais</h2>
      {erro && <div className="error">{erro}</div>}
      <div className="actions-row">
        {row.status === "solicitada" && (
          <button className="btn secondary" disabled={busy} onClick={andamento}>
            Marcar em andamento
          </button>
        )}
        <button className="btn danger" disabled={busy} onClick={cancelar}>
          Cancelar solicitação
        </button>
      </div>
    </section>
  );
}
function DT({ t, v }: { t: string; v?: string | null }) {
  return (
    <div>
      <dt>{t}</dt>
      <dd>{v || "—"}</dd>
    </div>
  );
}
function canViewFinancialCosts(access: Access) {
  return access.canViewAll;
}
function PassagemComprada({
  anexos,
  custos,
  canViewCosts,
}: {
  anexos: Anexo[];
  custos: Custo[];
  canViewCosts: boolean;
}) {
  const [erro, setErro] = useState("");
  async function abrir(anexo: Anexo) {
    setErro("");
    const { data, error } = await supabase.storage
      .from("ro-passagem-anexos")
      .createSignedUrl(anexo.storage_path, 60);
    if (error || !data?.signedUrl) {
      setErro("Não foi possível abrir o PDF. Tente novamente.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  const soma = (tipo: Custo["tipo"]) =>
    custos
      .filter((c) => c.tipo === tipo)
      .reduce((total, c) => total + Number(c.valor), 0);
  const complementares = anexos.filter((a) => a.complementar);
  const custoComplementar = custos
    .filter(
      (c) =>
        c.tipo === "passagem" &&
        c.descricao?.toLocaleLowerCase("pt-BR").startsWith("passagem complementar:"),
    )
    .reduce((total, custo) => total + Number(custo.valor), 0);
  const totalPassagens = soma("passagem");
  const uber = soma("uber");
  const refeicao = soma("refeicao");
  const outros = soma("outros");
  const totalGeral = totalPassagens + uber + refeicao + outros;
  const custoLabel = (custo: Custo) =>
    custo.descricao ||
    {
      passagem: "Passagem",
      uber: "Uber/local",
      refeicao: "Refeição/ajuda",
      outros: "Outros",
    }[custo.tipo];
  return (
    <section className="card attachment-card">
      <div className="attachment-title">
        <FileText />
        <div>
          <h2>Passagem comprada</h2>
          <p>
            {canViewCosts
              ? "PDFs e custos registrados em modo leitura."
              : "Documentos registrados para consulta."}
          </p>
        </div>
      </div>
      {erro && <div className="error">{erro}</div>}
      {canViewCosts && complementares.length > 0 && (
        <div className="complementary-summary">
          <strong>Imprevistos com passagens</strong>
          <span>
            {complementares.length} passagem(ns) complementar(es) ·{" "}
            {dinheiro(custoComplementar)}
          </span>
        </div>
      )}
      {canViewCosts && (
        <section className="financial-costs">
          <h3>Custos financeiros</h3>
          {custos.length === 0 ? (
            <p className="attachment-empty">
              Nenhum custo financeiro registrado.
            </p>
          ) : (
            <div className="financial-cost-list">
              {custos.map((custo) => (
                <div key={custo.id}>
                  <span>
                    <strong>{custoLabel(custo)}</strong>
                    <small>
                      {custo.tipo === "passagem"
                        ? "Passagem comprada"
                        : "Custo adicional"}
                    </small>
                  </span>
                  <strong>{dinheiro(Number(custo.valor))}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <h3 className="documents-heading">Documentos anexados</h3>
      {anexos.length === 0 ? (
        <p className="attachment-empty">Nenhum PDF anexado.</p>
      ) : (
        <div className="attachment-list">
          {anexos.map((anexo) => (
            <div
              key={anexo.id}
              className={`purchased-ticket ${anexo.complementar ? "complementary-ticket" : ""}`}
            >
              <div>
                <FileText size={20} />
                <span>
                  <strong>
                    {anexo.nome_arquivo}
                    {anexo.complementar ? " · Complementar" : ""}
                  </strong>
                  <small>
                    Partida: {dataHora(anexo.partida_em)} · Documento de apoio,
                    sem custo financeiro próprio
                  </small>
                  {anexo.imprevisto && (
                    <small className="sensitive">Imprevisto</small>
                  )}
                  {anexo.motivo_complementar && (
                    <small>Motivo: {anexo.motivo_complementar}</small>
                  )}
                  <small>
                    Lançada por{" "}
                    {(anexo as Anexo & { criado_por_nome?: string | null })
                      .criado_por_nome || "Responsável não identificado"}{" "}
                    em {dataHora(anexo.criado_em || anexo.created_at)}
                  </small>
                  {anexo.observacao && <small>{anexo.observacao}</small>}
                </span>
              </div>
              <button
                className="btn secondary"
                type="button"
                onClick={() => abrir(anexo)}
              >
                <ExternalLink size={16} />
                Abrir PDF
              </button>
            </div>
          ))}
        </div>
      )}
      {canViewCosts && (
        <div className="purchase-summary">
          <div>
            <span>Passagens</span>
            <strong>{dinheiro(totalPassagens)}</strong>
          </div>
          <div>
            <span>Uber/local</span>
            <strong>{dinheiro(uber)}</strong>
          </div>
          <div>
            <span>Refeição/ajuda</span>
            <strong>{dinheiro(refeicao)}</strong>
          </div>
          <div>
            <span>Outros</span>
            <strong>{dinheiro(outros)}</strong>
          </div>
          <div className="grand-total">
            <span>Total geral</span>
            <strong>{dinheiro(totalGeral)}</strong>
          </div>
        </div>
      )}
    </section>
  );
}
type PdfDraft = {
  id: string;
  file: File;
  partida_em: string;
  valor: string;
  observacao: string;
  passageiro: string;
  documento: string;
  origem: string;
  destino: string;
  poltrona: string;
  localizador: string;
  numero_bilhete: string;
  tipo_documento: "voucher" | "bilhete_embarque" | "documento_sem_valor" | "documento";
  valores_financeiros_divergentes: boolean;
  extracting: boolean;
  message: { kind: "success" | "warning"; text: string } | null;
};
type CompraForm = {
  observacoes_ro: string;
  uber: string;
  refeicao: string;
  outros: string;
  centro_custo_id: string;
  imprevisto: boolean;
  motivo_complementar: string;
};
type PurchaseDraft = {
  pdfs: PdfDraft[];
  form: CompraForm;
  updatedAt: number;
};
const purchaseDraftBySolicitacaoId = new Map<string, PurchaseDraft>();
const initialCompraForm = (row: Solicitacao): CompraForm => ({
  observacoes_ro: row.observacoes_ro || "",
  uber: "",
  refeicao: "",
  outros: "",
  centro_custo_id: "",
  imprevisto: false,
  motivo_complementar: "",
});
function Compra({
  row,
  onDone,
  complementar = false,
}: {
  row: Solicitacao;
  onDone: () => void;
  complementar?: boolean;
}) {
  const { obras } = useCatalogos();
  const draftKey = `${row.id}:${complementar ? "complementar" : "inicial"}`;
  const savedDraft = purchaseDraftBySolicitacaoId.get(draftKey);
  const [busy, setBusy] = useState(false);
  const [pdfs, setPdfs] = useState<PdfDraft[]>(savedDraft?.pdfs || []);
  const [minimized, setMinimized] = useState(false);
  const [draggingPdfs, setDraggingPdfs] = useState(false);
  const dragDepth = useRef(0);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState<CompraForm>(
    savedDraft?.form || initialCompraForm(row),
  );
  useEffect(() => {
    purchaseDraftBySolicitacaoId.set(draftKey, {
      pdfs,
      form,
      updatedAt: Date.now(),
    });
  }, [draftKey, form, pdfs]);
  const extracting = pdfs.some((pdf) => pdf.extracting);
  const documentos = pdfs.map((pdf) => ({
    ...pdf,
    nome_arquivo: pdf.file.name,
  }));
  const grupos = calcularCustosSemDuplicidade(documentos);
  const grupoPorDocumento = new Map(
    grupos.flatMap((grupo) =>
      grupo.documents.map((documento) => [documento.id, grupo] as const),
    ),
  );
  const totalPassagens = totalTicketValues(documentos);
  const valoresDivergentes = grupos.some((grupo) => grupo.conflictingValues);
  const updatePdf = (id: string, patch: Partial<PdfDraft>) => {
    const stored = purchaseDraftBySolicitacaoId.get(draftKey);
    if (stored)
      purchaseDraftBySolicitacaoId.set(draftKey, {
        ...stored,
        pdfs: stored.pdfs.map((pdf) =>
          pdf.id === id ? { ...pdf, ...patch } : pdf,
        ),
        updatedAt: Date.now(),
      });
    setPdfs((current) =>
      current.map((pdf) => (pdf.id === id ? { ...pdf, ...patch } : pdf)),
    );
  };
  async function lerPdf(draft: PdfDraft) {
    try {
      const extracted = await extractTicketDataFromPdf(draft.file);
      const found = Boolean(extracted.partida_em || extracted.valor_passagem);
      updatePdf(draft.id, {
        partida_em: extracted.partida_em || "",
        valor: extracted.valor_passagem || "",
        passageiro: extracted.passageiro || "",
        documento: extracted.documento || "",
        origem: extracted.origem || "",
        destino: extracted.destino || "",
        poltrona: extracted.poltrona || "",
        localizador: extracted.localizador || "",
        numero_bilhete: extracted.numero_bilhete || "",
        tipo_documento: extracted.tipo_documento || "documento",
        valores_financeiros_divergentes:
          extracted.valores_financeiros_divergentes || false,
        extracting: false,
        message: found
          ? {
              kind: "success",
              text: "Dados extraídos automaticamente. Confira partida e valor.",
            }
          : {
              kind: "warning",
              text: "Não foi possível identificar automaticamente os dados desta passagem. Preencha as informações manualmente.",
            },
      });
    } catch {
      updatePdf(draft.id, {
        extracting: false,
        message: {
          kind: "warning",
          text: "Não foi possível identificar automaticamente os dados desta passagem. Preencha as informações manualmente.",
        },
      });
    }
  }

  function adicionarPdfs(files: File[]) {
    setErro("");
    for (const file of files) {
      const validationError = validatePdfFile(file);
      if (validationError) {
        setErro((current) =>
          current
            ? current + " " + file.name + ": " + validationError
            : file.name + ": " + validationError,
        );
        continue;
      }
      const draft: PdfDraft = {
        id: crypto.randomUUID(),
        file,
        partida_em: "",
        valor: "",
        observacao: "",
        passageiro: "",
        documento: "",
        origem: "",
        destino: "",
        poltrona: "",
        localizador: "",
        numero_bilhete: "",
        tipo_documento: "documento",
        valores_financeiros_divergentes: false,
        extracting: true,
        message: null,
      };
      setPdfs((current) => {
        const next = [...current, draft];
        purchaseDraftBySolicitacaoId.set(draftKey, {
          pdfs: next,
          form,
          updatedAt: Date.now(),
        });
        return next;
      });
      void lerPdf(draft);
    }
  }

  function selecionarPdfs(event: React.ChangeEvent<HTMLInputElement>) {
    adicionarPdfs(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function entrarNaArea(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (busy) return;
    dragDepth.current += 1;
    setDraggingPdfs(true);
  }

  function sairDaArea(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDraggingPdfs(false);
  }

  function soltarPdfs(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingPdfs(false);
    if (!busy) adicionarPdfs(Array.from(event.dataTransfer.files));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (extracting) return;
    if (valoresDivergentes) {
      setErro(
        "Documentos parecem ser da mesma passagem, mas possuem valores diferentes. Revise antes de confirmar.",
      );
      return;
    }
    setBusy(true);
    setErro("");
    const storagePaths: string[] = [];
    const anexoIds: string[] = [];
    const anexosComplementares: Record<string, unknown>[] = [];
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      const financeiroPorDocumento = new Map(
        grupos.flatMap((grupo) =>
          grupo.documents.map((documento) => [
            documento.id,
            documento.id === grupo.financialDocumentId ? grupo.value : 0,
          ] as const),
        ),
      );
      const agrupamentoPorDocumento = new Map(
        grupos.flatMap((grupo, indice) =>
          grupo.documents.map((documento) => [
            documento.id,
            {
              indice: indice + 1,
              quantidade: grupo.documents.length,
              valor: grupo.value,
            },
          ] as const),
        ),
      );
      for (const pdf of pdfs) {
        const safeName = pdf.file.name
          .normalize("NFD")
          .replace(/[\\u0300-\\u036f]/g, "")
          .replace(/[^a-zA-Z0-9._-]/g, "-");
        const storagePath = row.id + "/" + crypto.randomUUID() + "-" + safeName;
        storagePaths.push(storagePath);
        const upload = await supabase.storage
          .from("ro-passagem-anexos")
          .upload(storagePath, pdf.file, {
            contentType: "application/pdf",
            upsert: false,
          });
        if (upload.error)
          throw new Error("Não foi possível enviar " + pdf.file.name + ".");
        const agrupamento = agrupamentoPorDocumento.get(pdf.id);
        const valorFinanceiro = financeiroPorDocumento.get(pdf.id) || 0;
        const notaAgrupamento = agrupamento
          ? `Grupo ${agrupamento.indice}: ${agrupamento.quantidade} documento(s), valor único R$ ${agrupamento.valor.toFixed(2)}. Tipo: ${pdf.tipo_documento}.`
          : "";
        const metadata = {
          nome_arquivo: pdf.file.name,
          storage_path: storagePath,
          mime_type: pdf.file.type,
          tamanho_bytes: pdf.file.size,
          partida_em: pdf.partida_em
            ? new Date(pdf.partida_em).toISOString()
            : "",
          valor: valorFinanceiro || "",
          observacao: [notaAgrupamento, pdf.observacao.trim()]
            .filter(Boolean)
            .join(" "),
        };
        if (complementar) anexosComplementares.push(metadata);
        else {
          const attachment = await supabase
            .from("ro_passagem_anexos")
            .insert({
              solicitacao_id: row.id,
              tipo: "passagem_pdf",
              ...metadata,
              uploaded_by: user.id,
              partida_em: metadata.partida_em || null,
              valor: metadata.valor ? Number(metadata.valor) : null,
              observacao: metadata.observacao || null,
            })
            .select("id")
            .single();
          if (attachment.error || !attachment.data)
            throw new Error(
              "Não foi possível vincular " + pdf.file.name + " à solicitação.",
            );
          anexoIds.push(attachment.data.id);
        }
      }
      const custos = buildPurchaseCosts(
        row.id,
        documentos,
        form,
        form.centro_custo_id,
      );
      const primeiraPartidaLocal = pdfs
        .map((pdf) => pdf.partida_em)
        .filter(Boolean)
        .sort()[0];
      const primeiraPartida = primeiraPartidaLocal
        ? new Date(primeiraPartidaLocal).toISOString()
        : null;
      const { error } = complementar
        ? await supabase.rpc("ro_registrar_passagem_complementar", {
            p_solicitacao_id: row.id,
            p_anexos: anexosComplementares,
            p_imprevisto: form.imprevisto,
            p_motivo_complementar: form.motivo_complementar,
          })
        : await supabase.rpc("ro_registrar_compra", {
            p_solicitacao_id: row.id,
            p_tipo_transporte: null,
            p_companhia: null,
            p_localizador: null,
            p_origem_comprada: null,
            p_destino_comprado: null,
            p_partida_em: primeiraPartida,
            p_chegada_em: null,
            p_observacoes_ro: form.observacoes_ro,
            p_custos: custos,
          });
      if (error) throw new Error(error.message);
      purchaseDraftBySolicitacaoId.delete(draftKey);
      window.alert("Passagem registrada com sucesso.");
      onDone();
    } catch (error) {
      if (anexoIds.length)
        await supabase.from("ro_passagem_anexos").delete().in("id", anexoIds);
      if (storagePaths.length)
        await supabase.storage.from("ro-passagem-anexos").remove(storagePaths);
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar a compra.",
      );
    } finally {
      setBusy(false);
    }
  }

  function descartarRascunho() {
    if (
      pdfs.length > 0 &&
      !window.confirm(
        "Existem arquivos selecionados ainda não salvos. Deseja descartar?",
      )
    )
      return;
    purchaseDraftBySolicitacaoId.delete(draftKey);
    setPdfs([]);
    setForm(initialCompraForm(row));
    setErro("");
  }

  if (minimized)
    return (
      <section className="card purchase-draft-collapsed">
        <div>
          <strong>Compra minimizada</strong>
          <small>
            {pdfs.length} PDF(s) preservado(s) localmente, sem upload.
          </small>
        </div>
        <button
          type="button"
          className="btn secondary"
          onClick={() => setMinimized(false)}
        >
          Reabrir compra
        </button>
      </section>
    );

  return (
    <form className="card form purchase" onSubmit={submit}>
      <div className="wide section-title">
        <ShoppingCart />
        <div>
          <h2>
            {complementar
              ? "Adicionar passagem complementar"
              : "Registrar compra"}
          </h2>
          <p>Anexe uma ou mais passagens e confira partida e valor.</p>
        </div>
        <button
          type="button"
          className="btn secondary purchase-minimize"
          onClick={() => setMinimized(true)}
          disabled={busy}
        >
          Minimizar
        </button>
      </div>
      {erro && <div className="error wide">{erro}</div>}
      {valoresDivergentes && (
        <div className="error wide">
          Documentos parecem ser da mesma passagem, mas possuem valores
          diferentes. Revise antes de confirmar.
        </div>
      )}
      <section className="wide pdfs-section">
        <div className="pdfs-heading">
          <div>
            <h3>PDFs das passagens</h3>
            <p>Opcional · PDF de até 10 MB por arquivo</p>
          </div>
        </div>
        <label
          className={`pdf-drop-zone${draggingPdfs ? " dragging" : ""}${busy ? " disabled" : ""}`}
          onDragEnter={entrarNaArea}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={sairDaArea}
          onDrop={soltarPdfs}
        >
          <Upload size={20} />
          <span>
            <strong>{draggingPdfs ? "Solte o PDF aqui" : "Arraste o PDF aqui ou clique para selecionar"}</strong>
            <small>Você pode adicionar vários PDFs de até 10 MB cada.</small>
          </span>
          <input type="file" accept="application/pdf,.pdf" multiple onChange={selecionarPdfs} disabled={busy}/>
        </label>
        {pdfs.length === 0 ? (
          <div className="pdfs-empty">
            <FileText />
            <span>
              Nenhum PDF selecionado. A compra também pode ser registrada
              manualmente.
            </span>
          </div>
        ) : (
          <div className="pdf-drafts">
            {pdfs.map((pdf) => {
              const grupoDoPdf = grupoPorDocumento.get(pdf.id);
              const bilheteInformativo =
                pdf.tipo_documento === "bilhete_embarque" &&
                grupoDoPdf?.valueSource === "voucher";
              return (
              <article key={pdf.id} className="pdf-draft">
                <div className="pdf-draft-head">
                  <div>
                    <FileText size={20} />
                    <span>
                      <strong>{pdf.file.name}</strong>
                      <small>
                        {(pdf.file.size / 1024 / 1024).toFixed(2)} MB
                      </small>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon danger-icon"
                    aria-label={`Remover ${pdf.file.name}`}
                    onClick={() =>
                      setPdfs((current) =>
                        current.filter((item) => item.id !== pdf.id),
                      )
                    }
                    disabled={busy}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                {pdf.extracting ? (
                  <div className="pdf-reading">Lendo dados do PDF...</div>
                ) : (
                  pdf.message && (
                    <div className={`pdf-message ${pdf.message.kind}`}>
                      {pdf.message.text}
                    </div>
                  )
                )}
                <div className="pdf-fields">
                  <label>
                    Data e hora de partida
                    <input
                      type="datetime-local"
                      value={pdf.partida_em}
                      onChange={(e) =>
                        updatePdf(pdf.id, { partida_em: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {bilheteInformativo
                      ? "Valor informativo do bilhete (R$)"
                      : "Valor da passagem (R$)"}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pdf.valor}
                      readOnly={bilheteInformativo}
                      aria-describedby={
                        bilheteInformativo
                          ? `ticket-value-help-${pdf.id}`
                          : undefined
                      }
                      onChange={(e) =>
                        updatePdf(pdf.id, { valor: e.target.value })
                      }
                    />
                    {bilheteInformativo && (
                      <small id={`ticket-value-help-${pdf.id}`}>
                        Valor tarifário do BP-e. O custo financeiro deste grupo
                        é definido pelo voucher.
                      </small>
                    )}
                  </label>
                  <label className="wide">
                    Observação
                    <textarea
                      rows={2}
                      value={pdf.observacao}
                      onChange={(e) =>
                        updatePdf(pdf.id, { observacao: e.target.value })
                      }
                      placeholder="Opcional"
                    />
                  </label>
                </div>
                <small className="pdf-classification">
                  Tipo reconhecido:{" "}
                  {pdf.tipo_documento === "voucher"
                    ? "Voucher/comprovante"
                    : pdf.tipo_documento === "bilhete_embarque"
                      ? "Bilhete de embarque"
                      : pdf.valor
                        ? "Documento financeiro"
                        : "Documento sem valor"}
                  {pdf.localizador && ` · Localizador ${pdf.localizador}`}
                  {pdf.numero_bilhete && ` · Bilhete ${pdf.numero_bilhete}`}
                  {pdf.passageiro && ` · ${pdf.passageiro}`}
                </small>
              </article>
              );
            })}
          </div>
        )}
        {grupos.length > 0 && !extracting && (
          <div className="passagem-groups">
            {grupos.map((grupo, index) => {
              return (
                <div
                  key={`${grupo.key}-${index}`}
                  className={grupo.conflictingValues ? "conflict" : ""}
                >
                  <strong>Passagem reconhecida</strong>
                  <span>
                    {grupo.consolidatedPassenger ||
                      "Passageiro não identificado"}
                    {" · "}
                    {grupo.consolidatedOrigin && grupo.consolidatedDestination
                      ? `${grupo.consolidatedOrigin} → ${grupo.consolidatedDestination}`
                      : "Trecho não identificado"}
                    {grupo.consolidatedDeparture &&
                      ` · ${dataHora(grupo.consolidatedDeparture)}`}
                    {grupo.consolidatedSeat &&
                      ` · Poltrona ${grupo.consolidatedSeat}`}
                  </span>
                  <small>
                    Documentos: {grupo.documents.length} · Valor considerado:{" "}
                    {grupo.value > 0 ? dinheiro(grupo.value) : "sem custo"}
                    {grupo.valueSource === "voucher" && " (voucher/comprovante)"}
                    {grupo.valueSource === "bilhete_oficial" &&
                      " (bilhete oficial)"}
                    {grupo.needsReview && " · Pendente de revisão"}
                  </small>
                  {grupo.valueHierarchyNotice && (
                    <small>
                      Bilhete oficial possui valor tarifário de{" "}
                      {grupo.informationalTicketValues
                        .map((value) => dinheiro(value))
                        .join(", ")}
                      . Valor financeiro considerado pelo voucher:{" "}
                      {dinheiro(grupo.value)}.
                    </small>
                  )}
                  {grupo.documentMismatch && (
                    <small>
                      Documento divergente entre arquivos; agrupado por nome,
                      data, poltrona e trecho.
                    </small>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="tickets-total">
          <span>Total das passagens</span>
          <strong>{dinheiro(totalPassagens)}</strong>
        </div>
      </section>
      {complementar ? (
        <>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.imprevisto}
              onChange={(e) =>
                setForm({ ...form, imprevisto: e.target.checked })
              }
            />{" "}
            Decorrente de imprevisto
          </label>
          <label className="wide">
            Motivo da passagem complementar
            <textarea
              required={form.imprevisto}
              value={form.motivo_complementar}
              onChange={(e) =>
                setForm({ ...form, motivo_complementar: e.target.value })
              }
            />
          </label>
        </>
      ) : (
        <>
          <label className="wide">
            Centro de custo financeiro *
            <select
              required
              value={form.centro_custo_id}
              onChange={(e) =>
                setForm({ ...form, centro_custo_id: e.target.value })
              }
            >
              <option value="">Selecione</option>
              {obras.map((obra) => (
                <option key={obra.id} value={obra.id}>
                  {formatCentroCustoLabel(obra)}
                </option>
              ))}
            </select>
            <small>Pode ser diferente do centro informado na solicitação.</small>
          </label>
          <label>
            Uber/local (R$)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.uber}
              onChange={(e) => setForm({ ...form, uber: e.target.value })}
            />
          </label>
          <label>
            Refeição/ajuda (R$)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.refeicao}
              onChange={(e) => setForm({ ...form, refeicao: e.target.value })}
            />
          </label>
          <label>
            Outros (R$)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.outros}
              onChange={(e) => setForm({ ...form, outros: e.target.value })}
            />
          </label>
          <label className="wide">
            Observações do RO
            <textarea
              value={form.observacoes_ro}
              onChange={(e) =>
                setForm({ ...form, observacoes_ro: e.target.value })
              }
            />
          </label>
        </>
      )}
      <div className="actions wide">
        <button
          type="button"
          className="btn secondary"
          onClick={descartarRascunho}
          disabled={busy}
        >
          Cancelar
        </button>
        <button
          className="btn primary"
          disabled={
            busy ||
            extracting ||
            valoresDivergentes ||
            (complementar && pdfs.length === 0)
          }
        >
          <CheckCircle2 size={17} />
          {busy
            ? "Registrando..."
            : extracting
              ? "Lendo PDFs..."
              : complementar
                ? "Adicionar passagem complementar"
                : "Confirmar passagem comprada"}
        </button>
      </div>
    </form>
  );
}

type ImportResult = {
  importados: number;
  atualizados: number;
  ignorados: number;
  erros: Array<{ linha: number; nome: string; motivo: string }>;
};

type CostCenterImportRow = { linha: number; codigo: string; descricao: string };
type CostCenterImportResult = Omit<ImportResult, "erros"> & {
  erros: Array<CostCenterImportRow & { motivo: string }>;
};

function cellText(value: unknown) {
  return String(value ?? "").trim();
}

function looksLikeCostCenterHeader(row: unknown[]) {
  const normalize = (value: unknown) => cellText(value).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalize(row[0]).includes("codigo") &&
    (normalize(row[1]).includes("descricao") || normalize(row[1]).includes("nome"));
}

function prepareCostCenterRows(rows: unknown[][]) {
  const nonEmpty = rows.map((row, index) => ({ row, linha: index + 1 }))
    .filter(({ row }) => row.some((cell) => cellText(cell) !== ""));
  const data = nonEmpty.length && looksLikeCostCenterHeader(nonEmpty[0].row)
    ? nonEmpty.slice(1) : nonEmpty;
  return data.map(({ row, linha }) => ({
    linha,
    codigo: cellText(row[0]),
    descricao: cellText(row[1]),
  }));
}

export function ImportacaoCentrosCusto({ embedded = false }: { embedded?: boolean } = {}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [linhas, setLinhas] = useState<CostCenterImportRow[]>([]);
  const [resultado, setResultado] = useState<CostCenterImportResult | null>(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  async function selecionar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setArquivo(file); setResultado(null); setErro(""); setLinhas([]);
    if (!file) return;
    try {
      let rows: unknown[][];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const csv = Papa.parse<unknown[]>(await file.text(), { header: false, skipEmptyLines: false });
        if (csv.errors.length) throw new Error(csv.errors[0].message);
        rows = csv.data;
      } else if (file.name.toLowerCase().endsWith(".xlsx")) {
        const sheets = await readXlsxFile(file, { parseNumber: (value) => value });
        rows = sheets[0]?.data || [];
      } else throw new Error("Formato inválido");
      const parsed = prepareCostCenterRows(rows);
      setLinhas(parsed);
      if (!parsed.length) setErro("A planilha não contém linhas para importar.");
    } catch {
      setErro("Não foi possível ler a planilha. Use um arquivo XLSX ou CSV com duas colunas.");
    }
  }

  async function importar() {
    setBusy(true); setErro(""); setResultado(null);
    const { data, error } = await supabase.rpc("ro_importar_centros_custo_restritos", { p_linhas: linhas });
    if (error) setErro(error.message); else setResultado(data as unknown as CostCenterImportResult);
    setBusy(false);
  }

  const conteudo = <>
    {embedded && <h2>Centros de custo</h2>}
    <section className="card form">
      <div className="wide">
        <p><strong>Importe uma planilha sem cabeçalho, com:</strong><br/>Coluna A = Código<br/>Coluna B = Descrição</p>
        <p>Os códigos serão mantidos como texto. Os centros serão exclusivos do RO Passagens e não aparecerão no Obras Control.</p>
      </div>
      <label className="wide">Planilha<input type="file" accept=".xlsx,.csv" onChange={selecionar}/></label>
      {arquivo && <div className="wide"><strong>{arquivo.name}</strong><p>{linhas.length} linha(s) pronta(s) para validação.</p></div>}
      {erro && <div className="error wide">{erro}</div>}
      {resultado && <div className="success wide">
        <strong>Importação concluída.</strong>
        <p>{resultado.importados} importados · {resultado.atualizados} atualizados · {resultado.ignorados} ignorados · {resultado.erros.length} erros</p>
        {resultado.erros.length > 0 && <div className="table-wrap"><table><thead><tr><th>Linha</th><th>Código</th><th>Descrição</th><th>Motivo</th></tr></thead><tbody>{resultado.erros.map((item, index) => <tr key={`${item.linha}-${item.codigo}-${index}`}><td>{item.linha}</td><td>{item.codigo || "—"}</td><td>{item.descricao || "—"}</td><td>{item.motivo}</td></tr>)}</tbody></table></div>}
      </div>}
      <div className="actions wide"><button className="btn primary" type="button" disabled={busy || linhas.length === 0} onClick={importar}>{busy ? "Importando..." : "Importar centros de custo"}</button></div>
    </section>
  </>;
  return embedded ? conteudo : <Page title="Importar centros de custo" subtitle="Área restrita da administradora do sistema">{conteudo}</Page>;
}

export function ImportacaoFuncionarios({ embedded = false }: { embedded?: boolean } = {}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [linhas, setLinhas] = useState<Array<{ linha: number; nome: string }>>([]);
  const [resultado, setResultado] = useState<ImportResult | null>(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  function normalizarNome(value: unknown) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  function ehCabecalhoAcidental(value: string) {
    const normalized = value.toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return ["nome", "funcionario", "colaborador"].includes(normalized);
  }

  function prepararLinhas(rows: unknown[][]) {
    const nonEmpty = rows.map((row, index) => ({
      linha: index + 1,
      nome: normalizarNome(row[0]),
    })).filter(({ nome }) => nome !== "");
    return nonEmpty.length && ehCabecalhoAcidental(nonEmpty[0].nome)
      ? nonEmpty.slice(1)
      : nonEmpty;
  }

  async function selecionar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setArquivo(file); setResultado(null); setErro(""); setLinhas([]);
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Formato inválido");
      const sheets = await readXlsxFile(file);
      const parsed = prepararLinhas(sheets[0]?.data || []);
      setLinhas(parsed);
      if (!parsed.length) setErro("A planilha não contém nomes para importar.");
    } catch { setErro("Não foi possível ler a planilha. Use um arquivo XLSX válido."); }
  }

  async function importar() {
    setBusy(true); setErro(""); setResultado(null);
    const { data, error } = await supabase.rpc("ro_importar_funcionarios", { p_linhas: linhas });
    if (error) setErro(error.message); else setResultado(data as unknown as ImportResult);
    setBusy(false);
  }

  const conteudo = <>
    {embedded && <h2>Funcionários</h2>}
    <section className="card form">
      <div className="wide">
        <p><strong>Importe uma planilha XLSX sem cabeçalho, com:</strong><br/>Coluna A = Nome do funcionário</p>
        <p>A primeira aba será lida. Linhas vazias e um cabeçalho acidental serão ignorados. Os registros serão restritos ao RO e não aparecerão no Obras Control.</p>
      </div>
      <label className="wide">Planilha
        <input type="file" accept=".xlsx" onChange={selecionar}/>
      </label>
      {arquivo&&<div className="wide"><strong>{arquivo.name}</strong><p>{linhas.length} linha(s) pronta(s) para validação.</p></div>}
      {erro&&<div className="error wide">{erro}</div>}
      {resultado&&<div className="success wide"><strong>Importação concluída.</strong><p>{resultado.importados} importados · {resultado.atualizados} atualizados · {resultado.ignorados} ignorados · {resultado.erros.length} erros</p>{resultado.erros.length>0&&<div className="table-wrap"><table><thead><tr><th>Linha</th><th>Nome</th><th>Motivo</th></tr></thead><tbody>{resultado.erros.map((item,index)=><tr key={`${item.linha}-${item.nome}-${index}`}><td>{item.linha}</td><td>{item.nome||"—"}</td><td>{item.motivo}</td></tr>)}</tbody></table></div>}</div>}
      <div className="actions wide"><button className="btn primary" type="button" disabled={busy||linhas.length===0} onClick={importar}>{busy?"Importando...":"Importar funcionários"}</button></div>
    </section>
  </>;
  return embedded ? conteudo : <Page title="Importar funcionários" subtitle="Área restrita da administradora do sistema">{conteudo}</Page>;
}

export function Responsaveis({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<
    { id: string; user_id: string; ativo: boolean }[]
  >([]);
  const [profiles, setProfiles] = useState<
    { id: string; full_name?: string }[]
  >([]);
  const [selected, setSelected] = useState("");
  const load = useCallback(() => {
    supabase
      .from("ro_responsaveis")
      .select("*")
      .order("created_at")
      .then(({ data }) => setRows((data || []) as typeof rows));
    supabase
      .from("users_profiles")
      .select("id,full_name")
      .order("full_name")
      .then(({ data }) => setProfiles((data || []) as typeof profiles));
  }, []);
  useEffect(load, [load]);
  async function add() {
    if (!selected) return;
    await supabase
      .from("ro_responsaveis")
      .upsert({ user_id: selected, ativo: true }, { onConflict: "user_id" });
    setSelected("");
    load();
  }
  async function toggle(id: string, ativo: boolean) {
    await supabase
      .from("ro_responsaveis")
      .update({ ativo: !ativo })
      .eq("id", id);
    load();
  }
  const conteudo = <ResponsibleAdminSection
    users={profiles}
    rows={rows}
    selected={selected}
    onSelect={setSelected}
    onAdd={add}
    onToggle={(row) => toggle(row.id, row.ativo)}
    busy={null}
    loading={false}
    emptyText="Nenhum responsável RO cadastrado."
  />;
  return embedded ? conteudo : <Page title="Responsáveis RO" subtitle="Gerencie quem recebe e processa solicitações">{conteudo}</Page>;
}
