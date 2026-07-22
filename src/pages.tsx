import { useCallback, useEffect, useState } from "react";
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
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { Access } from "./App";
import { EnvWarning } from "./App";
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
import { validatePdfFile } from "./pdfFileValidation";
import { extractTicketDataFromPdf } from "./pdfPassagem";
import { buildPurchaseCosts, totalTicketValues } from "./purchaseCosts";
import { supabase } from "./supabase";
import type {
  Anexo,
  Custo,
  Funcionario,
  Motivo,
  Obra,
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
export function Dashboard({ access }: { access: Access }) {
  const [rows, setRows] = useState<Solicitacao[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase
      .from("ro_passagem_solicitacoes")
      .select(join)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setRows((data || []) as unknown as Solicitacao[]);
        setLoading(false);
      });
  }, []);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const mes = new Date().toISOString().slice(0, 7);
  const compradas = rows.filter((r) => r.comprado_em?.startsWith(mes));
  const solicitacoesImprevisto = rows.filter(
    (r) =>
      r.houve_imprevisto ||
      (r.anexos || []).some(
        (a) =>
          (a.complementar || a.imprevisto) &&
          (a.criado_em || a.created_at).startsWith(mes),
      ),
  );
  const custoImprevistos = solicitacoesImprevisto
    .flatMap((r) =>
      (r.anexos || []).filter(
        (a) =>
          (a.complementar || a.imprevisto) &&
          (a.criado_em || a.created_at).startsWith(mes),
      ),
    )
    .reduce((s, a) => s + Number(a.valor || 0), 0);
  const abertas = rows.filter(
    (r) => !["passagem_comprada", "finalizada", "cancelada"].includes(r.status),
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
    const itens = rows.filter(
      (r) =>
        r.motivo === motivo && !["finalizada", "cancelada"].includes(r.status),
    );
    const custo = itens
      .flatMap((r) => r.custos || [])
      .reduce((s, c) => s + Number(c.valor), 0);
    return (
      <section className="card operational-alert">
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
              .join(", ") || "Nenhuma solicitação ativa"}
          </small>
        </div>
        <Link to={`/solicitacoes?motivo=${motivo}`}>Ver solicitações</Link>
      </section>
    );
  };
  const alertaImprevistos = (
    <section className="card operational-alert">
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
      <Link to="/solicitacoes?imprevisto=true">Ver solicitações</Link>
    </section>
  );
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
      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="stats">
            <Stat label="Solicitações abertas" value={abertas.length} />
            <Stat
              label="Aguardando compra"
              value={
                rows.filter((r) =>
                  ["em_analise", "em_andamento"].includes(r.status),
                ).length
              }
            />
            <Stat label="Solicitações atrasadas" value={atrasadas.length} />
            <Stat label="Compradas no mês" value={compradas.length} />
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
    </Page>
  );
}
function Stat({
  label,
  value,
  money,
}: {
  label: string;
  value: string | number;
  money?: boolean;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={money ? "money" : ""}>{value}</strong>
      <small>Período atual</small>
    </div>
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
    if (!access.canViewAll) q = q.eq("solicitante_id", userId);
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
  }, [access.canViewAll, userId]);
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
export function NovaSolicitacao({ userId }: { userId: string }) {
  const { funcionarios, obras } = useCatalogos();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [solicitante, setSolicitante] = useState("");
  const [podeExceder, setPodeExceder] = useState(false);
  const [form, setForm] = useState({
    funcionario_id: "",
    obra_id: "",
    origem: "",
    destino: "",
    motivo: "" as Motivo | "",
    data_ida: "",
    data_retorno: "",
    centro_custo_retorno_id: "",
    retorno_indefinido: false,
    centro_custo_destino_id: "",
    justificativa_excecao_prazo: "",
    observacoes_solicitante: "",
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
    supabase
      .rpc("ro_is_admin", { p_user: userId })
      .then(({ data }) => setPodeExceder(Boolean(data)));
  }, [userId]);
  const idaMinima = (() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + 10);
    return d.toISOString().slice(0, 10);
  })();
  const exigePrazo = ["ferias", "folga_campo"].includes(form.motivo);
  const funcionarioSelecionado = funcionarios.find((x) => x.id === form.funcionario_id);
  const funcionarioRestrito = Boolean(
    funcionarioSelecionado &&
    funcionarioSelecionado.visivel_obras_control === false &&
    funcionarioSelecionado.visivel_passagens === true &&
    funcionarioSelecionado.escopo_passagens === "restrito_ro",
  );
  const foraPrazo =
    exigePrazo && Boolean(form.data_ida) && form.data_ida < idaMinima;
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
    const temRetorno = ["ferias", "folga_campo"].includes(motivo);
    setForm({
      ...form,
      motivo,
      data_retorno: temRetorno ? form.data_retorno : "",
      centro_custo_retorno_id: ["ferias", "folga_campo"].includes(motivo)
        ? form.centro_custo_retorno_id
        : "",
      retorno_indefinido: ["ferias", "folga_campo"].includes(motivo)
        ? form.retorno_indefinido
        : false,
      centro_custo_destino_id:
        motivo === "transferencia_obra" ? form.centro_custo_destino_id : "",
    });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!funcionarioRestrito && !form.motivo) {
      setErro("Selecione o motivo da solicitação.");
      return;
    }
    if (foraPrazo && !podeExceder) {
      setErro(
        `Solicitações de férias e folga de campo devem ser feitas com pelo menos 10 dias de antecedência. A primeira data permitida é ${data(idaMinima)}.`,
      );
      return;
    }
    if (foraPrazo && podeExceder && !form.justificativa_excecao_prazo.trim()) {
      setErro(
        "Informe a justificativa obrigatória para criar a solicitação fora do prazo.",
      );
      return;
    }
    setBusy(true);
    const { data: created, error } = await supabase
      .from("ro_passagem_solicitacoes")
      .insert({
        ...form,
        motivo: form.motivo || null,
        obra_id: form.obra_id || null,
        data_retorno: form.data_retorno || null,
        centro_custo_retorno_id: form.centro_custo_retorno_id || null,
        centro_custo_destino_id: form.centro_custo_destino_id || null,
        justificativa_excecao_prazo: form.justificativa_excecao_prazo || null,
        solicitante_id: userId,
      })
      .select("id")
      .single();
    if (error) {
      setErro(error.message);
      setBusy(false);
      return;
    }
    nav(`/solicitacoes/${created.id}`);
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
              .filter(([v]) => v !== "viagem_diretoria")
              .map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
          </select>
        </label>
        <label>
          Data de ida *
          <input
            type="date"
            required
            min={exigePrazo && !podeExceder ? idaMinima : undefined}
            value={form.data_ida}
            onChange={(e) => setForm({ ...form, data_ida: e.target.value })}
          />
        </label>
        {exigePrazo && (
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
            <label>
              Centro de custo de retorno
              <select
                disabled={form.retorno_indefinido}
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
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.retorno_indefinido}
                onChange={(e) =>
                  setForm({
                    ...form,
                    retorno_indefinido: e.target.checked,
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
        {foraPrazo && podeExceder && (
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

export function Detalhe({ access }: { access: Access }) {
  const { id } = useParams();
  const [row, setRow] = useState<Solicitacao | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
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
          const ids = [
            found.solicitante_id,
            responsavelId,
            ...anexos.map((a) => a.criado_por),
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
            anexos: anexos.map((a) => ({
              ...a,
              criado_por_nome: a.criado_por
                ? labelMap.get(a.criado_por) || "Responsável sem identificação"
                : null,
            })),
          } as unknown as Solicitacao);
        } else setRow(null);
        setErro(error?.message || "");
        setLoading(false);
      });
  }, [id]);
  useEffect(load, [load]);
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
          {["ferias", "folga_campo"].includes(row.motivo || "") && (
            <>
              <DT t="Retorno previsto" v={data(row.data_retorno)} />
              <DT
                t="Centro de custo de retorno"
                v={
                  row.retorno_indefinido
                    ? "Indefinido"
                    : formatCentroCustoLabel(row.centro_custo_retorno)
                }
              />
            </>
          )}
          <DT
            t="Justificativa de exceção"
            v={row.justificativa_excecao_prazo}
          />
          <DT t="Observações" v={row.observacoes_solicitante} />
        </dl>
      </section>
      {access.canOperateRO && row.status === "solicitada" && (
        <Assumir row={row} onDone={load} />
      )}
      {access.canOperateRO && row.status !== "solicitada" && (
        <Operacoes row={row} onDone={load} />
      )}
      {access.canOperateRO &&
        ["em_analise", "em_andamento"].includes(row.status) && (
          <Compra row={row} onDone={load} />
        )}
      {access.canOperateRO && row.status === "passagem_comprada" && (
        <Compra row={row} onDone={load} complementar />
      )}
      <PassagemComprada anexos={row.anexos || []} custos={row.custos || []} />
      <div className="grid two detail">
        <section className="card">
          <h2>Notificações</h2>
          {!row.notificacoes?.length ? (
            <Empty />
          ) : (
            <div className="timeline">
              {row.notificacoes.map((n) => (
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
  const [finalizar, setFinalizar] = useState(false);
  const [form, setForm] = useState({
    chegou_ao_destino: true,
    data_chegada_confirmada: new Date().toISOString().slice(0, 10),
    houve_imprevisto: false,
    observacao_finalizacao: "",
  });
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
  async function concluir(e: React.FormEvent) {
    e.preventDefault();
    if (
      (form.houve_imprevisto || !form.chegou_ao_destino) &&
      !form.observacao_finalizacao.trim()
    ) {
      setErro(
        "A observação é obrigatória quando houve imprevisto ou a pessoa não chegou ao destino.",
      );
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("ro_finalizar_solicitacao", {
      p_solicitacao_id: row.id,
      p_chegou_ao_destino: form.chegou_ao_destino,
      p_data_chegada_confirmada: form.data_chegada_confirmada,
      p_houve_imprevisto: form.houve_imprevisto,
      p_observacao_finalizacao: form.observacao_finalizacao,
    });
    setErro(error?.message || "");
    setBusy(false);
    if (!error) onDone();
  }
  if (["finalizada", "cancelada"].includes(row.status)) return null;
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
        {row.status === "passagem_comprada" && (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => setFinalizar(!finalizar)}
          >
            Finalizar
          </button>
        )}
      </div>
      {finalizar && (
        <form className="form finish-form" onSubmit={concluir}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.chegou_ao_destino}
              onChange={(e) =>
                setForm({ ...form, chegou_ao_destino: e.target.checked })
              }
            />{" "}
            Chegou ao destino
          </label>
          <label>
            Data de chegada confirmada *
            <input
              type="date"
              required
              value={form.data_chegada_confirmada}
              onChange={(e) =>
                setForm({ ...form, data_chegada_confirmada: e.target.value })
              }
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.houve_imprevisto}
              onChange={(e) =>
                setForm({ ...form, houve_imprevisto: e.target.checked })
              }
            />{" "}
            Houve imprevisto
          </label>
          <label className="wide">
            Observação de finalização
            {(form.houve_imprevisto || !form.chegou_ao_destino) && " *"}
            <textarea
              required={form.houve_imprevisto || !form.chegou_ao_destino}
              value={form.observacao_finalizacao}
              onChange={(e) =>
                setForm({ ...form, observacao_finalizacao: e.target.value })
              }
            />
          </label>
          <button className="btn primary wide" disabled={busy}>
            Confirmar finalização
          </button>
        </form>
      )}
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
function PassagemComprada({
  anexos,
  custos,
}: {
  anexos: Anexo[];
  custos: Custo[];
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
  const totalAnexos = anexos.reduce(
    (total, a) => total + Number(a.valor || 0),
    0,
  );
  const complementares = anexos.filter((a) => a.complementar);
  const custoComplementar = complementares.reduce(
    (total, a) => total + Number(a.valor || 0),
    0,
  );
  const totalPassagens = totalAnexos || soma("passagem");
  const uber = soma("uber");
  const refeicao = soma("refeicao");
  const outros = soma("outros");
  const totalGeral = totalPassagens + uber + refeicao + outros;
  return (
    <section className="card attachment-card">
      <div className="attachment-title">
        <FileText />
        <div>
          <h2>Passagem comprada</h2>
          <p>PDFs e custos registrados em modo leitura.</p>
        </div>
      </div>
      {erro && <div className="error">{erro}</div>}
      {complementares.length > 0 && (
        <div className="complementary-summary">
          <strong>Imprevistos com passagens</strong>
          <span>
            {complementares.length} passagem(ns) complementar(es) ·{" "}
            {dinheiro(custoComplementar)}
          </span>
        </div>
      )}
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
                    Partida: {dataHora(anexo.partida_em)} · Valor:{" "}
                    {anexo.valor == null ? "—" : dinheiro(Number(anexo.valor))}
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
    </section>
  );
}
type PdfDraft = {
  id: string;
  file: File;
  partida_em: string;
  valor: string;
  observacao: string;
  extracting: boolean;
  message: { kind: "success" | "warning"; text: string } | null;
};
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
  const [busy, setBusy] = useState(false);
  const [pdfs, setPdfs] = useState<PdfDraft[]>([]);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({
    observacoes_ro: row.observacoes_ro || "",
    uber: "",
    refeicao: "",
    outros: "",
    centro_custo_id: "",
    imprevisto: false,
    motivo_complementar: "",
  });
  const extracting = pdfs.some((pdf) => pdf.extracting);
  const totalPassagens = totalTicketValues(
    pdfs.map((pdf) => ({ nome_arquivo: pdf.file.name, valor: pdf.valor })),
  );
  const updatePdf = (id: string, patch: Partial<PdfDraft>) =>
    setPdfs((current) =>
      current.map((pdf) => (pdf.id === id ? { ...pdf, ...patch } : pdf)),
    );

  async function lerPdf(draft: PdfDraft) {
    try {
      const extracted = await extractTicketDataFromPdf(draft.file);
      const found = Boolean(extracted.partida_em || extracted.valor_passagem);
      updatePdf(draft.id, {
        partida_em: extracted.partida_em || "",
        valor: extracted.valor_passagem || "",
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

  function selecionarPdfs(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
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
        extracting: true,
        message: null,
      };
      setPdfs((current) => [...current, draft]);
      void lerPdf(draft);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (extracting) return;
    setBusy(true);
    setErro("");
    const storagePaths: string[] = [];
    const anexoIds: string[] = [];
    const anexosComplementares: Record<string, unknown>[] = [];
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
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
        const metadata = {
          nome_arquivo: pdf.file.name,
          storage_path: storagePath,
          mime_type: pdf.file.type,
          tamanho_bytes: pdf.file.size,
          partida_em: pdf.partida_em
            ? new Date(pdf.partida_em).toISOString()
            : "",
          valor: pdf.valor || "",
          observacao: pdf.observacao.trim(),
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
        pdfs.map((pdf) => ({ nome_arquivo: pdf.file.name, valor: pdf.valor })),
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
      </div>
      {erro && <div className="error wide">{erro}</div>}
      <section className="wide pdfs-section">
        <div className="pdfs-heading">
          <div>
            <h3>PDFs das passagens</h3>
            <p>Opcional · PDF de até 10 MB por arquivo</p>
          </div>
          <label className="btn secondary add-pdfs">
            <Upload size={16} />
            Adicionar PDFs
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={selecionarPdfs}
              disabled={busy}
            />
          </label>
        </div>
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
            {pdfs.map((pdf) => (
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
                    Valor da passagem (R$)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pdf.valor}
                      onChange={(e) =>
                        updatePdf(pdf.id, { valor: e.target.value })
                      }
                    />
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
              </article>
            ))}
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
          className="btn primary"
          disabled={busy || extracting || (complementar && pdfs.length === 0)}
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
  erros: Array<{ nome: string; erro: string }>;
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

export function ImportacaoCentrosCusto() {
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

  return <Page title="Importar centros de custo" subtitle="Área restrita da administradora do sistema">
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
  </Page>;
}

export function ImportacaoFuncionarios() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [linhas, setLinhas] = useState<Record<string, string>[]>([]);
  const [resultado, setResultado] = useState<ImportResult | null>(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  function normalizarCabecalho(value: unknown) {
    return String(value ?? "").trim().toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
  }

  function prepararLinhas(raw: Record<string, unknown>[]) {
    return raw.map((row) => {
      const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizarCabecalho(key), String(value ?? "").trim()]));
      return { nome: normalized.nome || "", funcao: normalized.funcao || "", status: normalized.status || "Ativo" };
    });
  }

  async function selecionar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setArquivo(file); setResultado(null); setErro(""); setLinhas([]);
    if (!file) return;
    try {
      let raw: Record<string, unknown>[];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const csv = Papa.parse<Record<string, unknown>>(await file.text(), { header: true, skipEmptyLines: true });
        if (csv.errors.length) throw new Error(csv.errors[0].message);
        raw = csv.data;
      } else {
        const sheets = await readXlsxFile(file);
        const rows = sheets[0]?.data || [];
        const headers = (rows[0] || []).map(normalizarCabecalho);
        raw = rows.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
      }
      const parsed = prepararLinhas(raw);
      setLinhas(parsed);
      if (!parsed.length) setErro("A planilha não contém linhas para importar.");
    } catch { setErro("Não foi possível ler a planilha. Use XLSX ou CSV."); }
  }

  async function importar() {
    setBusy(true); setErro(""); setResultado(null);
    const { data, error } = await supabase.rpc("ro_importar_funcionarios", { p_linhas: linhas });
    if (error) setErro(error.message); else setResultado(data as unknown as ImportResult);
    setBusy(false);
  }

  return <Page title="Importar funcionários" subtitle="Área restrita da administradora do sistema">
    <section className="card form">
      <div className="wide"><p>Colunas aceitas: <strong>nome</strong> (obrigatória), função e status. Os registros serão restritos ao RO e não aparecerão no Obras Control.</p></div>
      <label className="wide">Planilha
        <input type="file" accept=".xlsx,.csv" onChange={selecionar}/>
      </label>
      {arquivo&&<div className="wide"><strong>{arquivo.name}</strong><p>{linhas.length} linha(s) pronta(s) para validação.</p></div>}
      {erro&&<div className="error wide">{erro}</div>}
      {resultado&&<div className="success wide"><strong>Importação concluída.</strong><p>{resultado.importados} importados · {resultado.atualizados} atualizados · {resultado.ignorados} ignorados · {resultado.erros.length} erros</p>{resultado.erros.length>0&&<ul>{resultado.erros.map((item,index)=><li key={`${item.nome}-${index}`}>{item.nome||`Linha ${index+1}`}: {item.erro}</li>)}</ul>}</div>}
      <div className="actions wide"><button className="btn primary" type="button" disabled={busy||linhas.length===0} onClick={importar}>{busy?"Importando...":"Importar funcionários"}</button></div>
    </section>
  </Page>;
}

export function Responsaveis() {
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
  return (
    <Page
      title="Responsáveis RO"
      subtitle="Gerencie quem recebe e processa solicitações"
    >
      <div className="card add-ro">
        <Users />
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Selecione um usuário</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.id}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={add}>
          <Plus size={17} />
          Adicionar
        </button>
      </div>
      <div className="card ro-list">
        {rows.map((r) => {
          const perfil = profiles.find((p) => p.id === r.user_id);
          return (
            <div key={r.id}>
              <div>
                <strong>{perfil?.full_name || r.user_id}</strong>
                <small>
                  {r.ativo ? "Responsável ativo" : "Responsável inativo"}
                </small>
              </div>
              <button
                className={`btn ${r.ativo ? "danger" : "secondary"}`}
                onClick={() => toggle(r.id, r.ativo)}
              >
                {r.ativo ? "Inativar" : "Reativar"}
              </button>
            </div>
          );
        })}
      </div>
    </Page>
  );
}
