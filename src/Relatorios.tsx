import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Empty, Page, Spinner } from "./components";
import {
  dataHora,
  dinheiro,
  formatCentroCustoLabel,
  motivoLabel,
  statusLabel,
  statusOptions,
} from "./lib";
import { Link } from "react-router-dom";
import { supabase } from "./supabase";
import { useAutoFinalization } from "./autoFinalization";
import type { Obra } from "./types";

type LinhaRelatorio = Obra & {
  centro_custo_id: string | null;
  solicitacoes: number;
  compradas: number;
  abertas: number;
  aguardando_compra: number;
  atrasadas: number;
  imprevistos: number;
  valor_total: number;
  valor_complementar: number;
};
type CustoRelatorio = {
  solicitacao_id: string;
  centro_custo_id: string | null;
  tipo: "passagem" | "uber" | "refeicao" | "outros";
  descricao: string | null;
  valor: number;
  created_at: string;
  solicitacao: {
    id: string;
    obra_id: string | null;
    status: string;
    motivo: string | null;
    responsavel_ro_id: string | null;
    houve_imprevisto: boolean | null;
    created_at: string;
    comprado_em: string | null;
    funcionario?: { id: string; nome: string };
    anexos?: Array<{ complementar: boolean; imprevisto: boolean }>;
  };
};
type SolicitacaoAbertaRelatorio = CustoRelatorio["solicitacao"];
type Resumo = {
  solicitacoes: number; compradas: number; abertas: number;
  imprevistos: number; valor_total: number; valor_complementar: number;
};
type RelatorioData = {
  linhas: LinhaRelatorio[];
  centros: Obra[];
  responsaveis: Array<{ id: string; nome: string }>;
  resumo: Resumo;
};
type SortKey =
  | "codigo"
  | "nome"
  | "compradas"
  | "abertas"
  | "imprevistos"
  | "valor_total";

const hoje = new Date().toISOString().slice(0, 10);
const inicioMes = `${hoje.slice(0, 8)}01`;
const vazio: RelatorioData = {
  linhas: [], centros: [], responsaveis: [],
  resumo: { solicitacoes: 0, compradas: 0, abertas: 0, imprevistos: 0, valor_total: 0, valor_complementar: 0 },
};

export function Relatorios() {
  const [filtros, setFiltros] = useState({ inicio: inicioMes, fim: hoje, centro: "", status: "", motivo: "", responsavel: "" });
  const [aplicados, setAplicados] = useState(filtros);
  const [dados, setDados] = useState<RelatorioData>(vazio);
  const [custos, setCustos] = useState<CustoRelatorio[]>([]);
  const [solicitacoesAbertas, setSolicitacoesAbertas] = useState<
    SolicitacaoAbertaRelatorio[]
  >([]);
  const [centroSelecionado, setCentroSelecionado] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [ordem, setOrdem] = useState<SortKey>("codigo");
  const [direcao, setDirecao] = useState<"asc" | "desc">("asc");

  const carregar = useCallback(async () => {
    setLoading(true); setErro("");
    const semCentro = aplicados.centro === "sem-centro";
    const inicio = aplicados.inicio
      ? new Date(`${aplicados.inicio}T00:00:00`).toISOString()
      : null;
    const fimExclusivo = aplicados.fim
      ? (() => {
          const data = new Date(`${aplicados.fim}T00:00:00`);
          data.setDate(data.getDate() + 1);
          return data.toISOString();
        })()
      : null;
    let custosQuery = supabase
      .from("ro_passagem_custos")
      .select(
        "solicitacao_id,centro_custo_id,tipo,descricao,valor,created_at,solicitacao:ro_passagem_solicitacoes!inner(id,obra_id,status,motivo,responsavel_ro_id,houve_imprevisto,created_at,comprado_em,funcionario:funcionarios(id,nome),anexos:ro_passagem_anexos(complementar,imprevisto))",
      )
      .gt("valor", 0);
    if (inicio) custosQuery = custosQuery.gte("created_at", inicio);
    if (fimExclusivo) custosQuery = custosQuery.lt("created_at", fimExclusivo);
    let abertasQuery = supabase
      .from("ro_passagem_solicitacoes")
      .select(
        "id,obra_id,status,motivo,responsavel_ro_id,houve_imprevisto,created_at,comprado_em,funcionario:funcionarios(id,nome),anexos:ro_passagem_anexos(complementar,imprevisto)",
      )
      .in("status", ["solicitada", "em_analise", "em_andamento"]);
    if (inicio) abertasQuery = abertasQuery.gte("created_at", inicio);
    if (fimExclusivo)
      abertasQuery = abertasQuery.lt("created_at", fimExclusivo);
    const [relatorioResult, custosResult, abertasResult] = await Promise.all([
      supabase.rpc("ro_relatorio_centros_custo", {
        p_inicio: aplicados.inicio || null,
        p_fim: aplicados.fim || null,
        p_centro_custo_id:
          semCentro || !aplicados.centro ? null : aplicados.centro,
        p_sem_centro: semCentro,
        p_status: aplicados.status || null,
        p_motivo: aplicados.motivo || null,
        p_responsavel_ro_id: aplicados.responsavel || null,
      }),
      custosQuery,
      abertasQuery,
    ]);
    const { data, error } = relatorioResult;
    if (error) setErro(error.message);
    else setDados((data || vazio) as unknown as RelatorioData);
    if (custosResult.error)
      setErro((atual) => atual || custosResult.error?.message || "");
    else
      setCustos(
        (custosResult.data || []) as unknown as CustoRelatorio[],
      );
    if (abertasResult.error)
      setErro((atual) => atual || abertasResult.error?.message || "");
    else
      setSolicitacoesAbertas(
        (abertasResult.data || []) as unknown as SolicitacaoAbertaRelatorio[],
      );
    setLoading(false);
  }, [aplicados]);
  useAutoFinalization(true, carregar);
  useEffect(() => { void carregar(); }, [carregar]);

  const custosFiltrados = useMemo(() => custos.filter((custo) => {
    const solicitacao = custo.solicitacao;
    const centroCusto = custo.centro_custo_id || solicitacao.obra_id;
    return solicitacao.status !== "cancelada" &&
      (!aplicados.status || solicitacao.status === aplicados.status) &&
      (!aplicados.motivo || solicitacao.motivo === aplicados.motivo) &&
      (!aplicados.responsavel ||
        solicitacao.responsavel_ro_id === aplicados.responsavel) &&
      (!aplicados.centro ||
        (aplicados.centro === "sem-centro"
          ? !centroCusto
          : centroCusto === aplicados.centro));
  }), [aplicados, custos]);

  const metricasFinanceiras = useMemo(() => {
    const porCentro = new Map<
      string,
      {
        compradas: Set<string>;
        imprevistos: Set<string>;
        valorTotal: number;
      }
    >();
    for (const custo of custosFiltrados) {
      const centro =
        custo.centro_custo_id || custo.solicitacao.obra_id || "sem-centro";
      const metrica = porCentro.get(centro) || {
        compradas: new Set<string>(),
        imprevistos: new Set<string>(),
        valorTotal: 0,
      };
      metrica.valorTotal += Number(custo.valor);
      if (custo.tipo === "passagem")
        metrica.compradas.add(custo.solicitacao_id);
      const descricao = custo.descricao?.toLocaleLowerCase("pt-BR") || "";
      if (
        custo.solicitacao.houve_imprevisto ||
        descricao.includes("complementar") ||
        descricao.includes("imprevisto") ||
        custo.solicitacao.anexos?.some(
          (anexo) => anexo.complementar || anexo.imprevisto,
        )
      )
        metrica.imprevistos.add(custo.solicitacao_id);
      porCentro.set(centro, metrica);
    }
    return porCentro;
  }, [custosFiltrados]);

  const linhasCalculadas = useMemo(() => {
    const operacionais = new Map(
      dados.linhas.map((linha) => [
        linha.centro_custo_id || "sem-centro",
        linha,
      ]),
    );
    const centros = new Set([
      ...operacionais.keys(),
      ...metricasFinanceiras.keys(),
    ]);
    return [...centros].map((centro) => {
      const operacional = operacionais.get(centro);
      const obra = dados.centros.find((item) => item.id === centro);
      const financeira = metricasFinanceiras.get(centro);
      return {
        ...(obra || {}),
        ...(operacional || {}),
        centro_custo_id: centro === "sem-centro" ? null : centro,
        compradas: financeira?.compradas.size || 0,
        abertas: solicitacoesAbertas.filter((s)=>(s.obra_id||"sem-centro")===centro).length,
        imprevistos: financeira?.imprevistos.size || 0,
        valor_total: financeira?.valorTotal || 0,
      } as LinhaRelatorio;
    });
  }, [dados.centros, dados.linhas, metricasFinanceiras, solicitacoesAbertas]);

  const linhas = useMemo(() => [...linhasCalculadas].sort((a, b) => {
    const factor = direcao === "asc" ? 1 : -1;
    if (["compradas", "abertas", "imprevistos", "valor_total"].includes(ordem))
      return (Number(a[ordem]) - Number(b[ordem])) * factor;
    const av = ordem === "codigo" ? (a.codigo || "ZZZZ") : (a.nome || a.descricao || "SEM CENTRO DE CUSTO");
    const bv = ordem === "codigo" ? (b.codigo || "ZZZZ") : (b.nome || b.descricao || "SEM CENTRO DE CUSTO");
    return av.localeCompare(bv, "pt-BR", { sensitivity: "base", numeric: true }) * factor;
  }), [direcao, linhasCalculadas, ordem]);
  const resumoFinanceiro = useMemo(() => ({
    compradas: new Set(
      custosFiltrados
        .filter((custo) => custo.tipo === "passagem")
        .map((custo) => custo.solicitacao_id),
    ).size,
    imprevistos: new Set(
      custosFiltrados
        .filter((custo) => {
          const descricao =
            custo.descricao?.toLocaleLowerCase("pt-BR") || "";
          return (
            custo.solicitacao.houve_imprevisto ||
            descricao.includes("complementar") ||
            descricao.includes("imprevisto") ||
            custo.solicitacao.anexos?.some(
              (anexo) => anexo.complementar || anexo.imprevisto,
            )
          );
        })
        .map((custo) => custo.solicitacao_id),
    ).size,
    valorTotal: custosFiltrados.reduce(
      (total, custo) => total + Number(custo.valor),
      0,
    ),
  }), [custosFiltrados]);
  const detalhe = useMemo(() => {
    if (!centroSelecionado) return null;
    const linha = linhasCalculadas.find(
      (item) => (item.centro_custo_id || "sem-centro") === centroSelecionado,
    );
    if (!linha) return null;
    const custosCentro = custosFiltrados.filter(
      (custo) =>
        (custo.centro_custo_id ||
          custo.solicitacao.obra_id ||
          "sem-centro") === centroSelecionado,
    );
    const abertasCentro = solicitacoesAbertas.filter((solicitacao) => {
      const centro = solicitacao.obra_id || "sem-centro";
      return (
        centro === centroSelecionado &&
        (!aplicados.status || solicitacao.status === aplicados.status) &&
        (!aplicados.motivo || solicitacao.motivo === aplicados.motivo) &&
        (!aplicados.responsavel ||
          solicitacao.responsavel_ro_id === aplicados.responsavel)
      );
    });
    const solicitacoes = new Map<
      string,
      {
        solicitacao: SolicitacaoAbertaRelatorio;
        total: number;
        compradaEm: string | null;
      }
    >();
    for (const custo of custosCentro) {
      const atual = solicitacoes.get(custo.solicitacao_id) || {
        solicitacao: custo.solicitacao,
        total: 0,
        compradaEm: null,
      };
      atual.total += Number(custo.valor);
      if (
        custo.tipo === "passagem" &&
        (!atual.compradaEm || custo.created_at < atual.compradaEm)
      )
        atual.compradaEm = custo.created_at;
      solicitacoes.set(custo.solicitacao_id, atual);
    }
    for (const solicitacao of abertasCentro) {
      if (!solicitacoes.has(solicitacao.id))
        solicitacoes.set(solicitacao.id, {
          solicitacao,
          total: 0,
          compradaEm: null,
        });
    }
    const custoImprevisto = (custo: CustoRelatorio) => {
      const descricao = custo.descricao?.toLocaleLowerCase("pt-BR") || "";
      return (
        custo.solicitacao.houve_imprevisto ||
        descricao.includes("complementar") ||
        descricao.includes("imprevisto") ||
        custo.solicitacao.anexos?.some(
          (anexo) => anexo.complementar || anexo.imprevisto,
        )
      );
    };
    return {
      linha,
      solicitacoes: [...solicitacoes.values()].sort((a, b) =>
        b.solicitacao.created_at.localeCompare(a.solicitacao.created_at),
      ),
      resumo: {
        valorTotal: custosCentro.reduce(
          (total, custo) => total + Number(custo.valor),
          0,
        ),
        passagens: custosCentro
          .filter((custo) => custo.tipo === "passagem")
          .reduce((total, custo) => total + Number(custo.valor), 0),
        uber: custosCentro
          .filter((custo) => custo.tipo === "uber")
          .reduce((total, custo) => total + Number(custo.valor), 0),
        refeicao: custosCentro
          .filter((custo) => custo.tipo === "refeicao")
          .reduce((total, custo) => total + Number(custo.valor), 0),
        complementares: custosCentro
          .filter(custoImprevisto)
          .reduce((total, custo) => total + Number(custo.valor), 0),
        compradas: new Set(
          custosCentro
            .filter((custo) => custo.tipo === "passagem")
            .map((custo) => custo.solicitacao_id),
        ).size,
        abertas: new Set(abertasCentro.map((item) => item.id)).size,
        imprevistos: new Set(
          custosCentro
            .filter(custoImprevisto)
            .map((custo) => custo.solicitacao_id),
        ).size,
      },
    };
  }, [
    aplicados,
    centroSelecionado,
    custosFiltrados,
    linhasCalculadas,
    solicitacoesAbertas,
  ]);

  function label(linha: LinhaRelatorio) {
    return linha.centro_custo_id ? formatCentroCustoLabel(linha) : "SEM CENTRO DE CUSTO";
  }
  function exportarCsv() {
    const cabecalho = ["Centro de custo","Compradas","Em aberto","Imprevistos/complementares","Valor total"];
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const registros = linhas.map((linha) => [label(linha),linha.compradas,linha.abertas,linha.imprevistos,Number(linha.valor_total).toFixed(2)]);
    const csv = `\uFEFF${[cabecalho, ...registros].map((row) => row.map(escape).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `relatorio-centros-custo-${hoje}.csv`; link.click();
    URL.revokeObjectURL(url);
  }
  function aplicar(event: React.FormEvent) { event.preventDefault(); setAplicados({ ...filtros }); }

  return <Page title="Relatórios" subtitle="Análise de solicitações e valores por centro de custo" action={<button className="btn secondary" type="button" onClick={exportarCsv} disabled={!linhas.length}><Download size={17}/>Exportar CSV</button>}>
    <form className="card report-filters" onSubmit={aplicar}>
      <label>Período inicial<input type="date" value={filtros.inicio} onChange={(e) => setFiltros({ ...filtros, inicio: e.target.value })}/></label>
      <label>Período final<input type="date" min={filtros.inicio} value={filtros.fim} onChange={(e) => setFiltros({ ...filtros, fim: e.target.value })}/></label>
      <label>Centro de custo<select value={filtros.centro} onChange={(e) => setFiltros({ ...filtros, centro: e.target.value })}><option value="">Todos</option><option value="sem-centro">SEM CENTRO DE CUSTO</option>{dados.centros.map((centro) => <option key={centro.id} value={centro.id}>{formatCentroCustoLabel(centro)}</option>)}</select></label>
      <label>Status<select value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}><option value="">Todos</option>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}<option value="em_analise">Em análise</option></select></label>
      <label>Motivo<select value={filtros.motivo} onChange={(e) => setFiltros({ ...filtros, motivo: e.target.value })}><option value="">Todos</option>{Object.entries(motivoLabel).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label>Responsável RO<select value={filtros.responsavel} onChange={(e) => setFiltros({ ...filtros, responsavel: e.target.value })}><option value="">Todos</option>{dados.responsaveis.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
      <button className="btn primary" type="submit">Aplicar filtros</button>
    </form>
    {erro && <div className="error">{erro}</div>}
    {loading ? <Spinner/> : <>
      <div className="stats report-stats"><ReportStat label="Total de solicitações" value={dados.resumo.solicitacoes}/><ReportStat label="Total comprado" value={resumoFinanceiro.compradas}/><ReportStat label="Total em aberto" value={solicitacoesAbertas.length}/><ReportStat label="Imprevistos/complementares" value={resumoFinanceiro.imprevistos}/><ReportStat label="Valor total geral" value={dinheiro(resumoFinanceiro.valorTotal)}/></div>
      <div className="report-sort"><label>Ordenar por <select value={ordem} onChange={(e) => setOrdem(e.target.value as SortKey)}><option value="codigo">Código</option><option value="nome">Centro de custo</option><option value="compradas">Compradas</option><option value="abertas">Em aberto</option><option value="imprevistos">Imprevistos/complementares</option><option value="valor_total">Valor total</option></select></label><button className="btn secondary" type="button" onClick={() => setDirecao(direcao === "asc" ? "desc" : "asc")}>{direcao === "asc" ? "Crescente" : "Decrescente"}</button></div>
      <section className="card table-card">{!linhas.length ? <Empty text="Nenhum resultado para os filtros aplicados."/> : <table><thead><tr><th>Centro de custo</th><th>Compradas</th><th>Em aberto</th><th>Imprevistos/complementares</th><th>Valor total</th></tr></thead><tbody>{linhas.map((linha) => <tr key={linha.centro_custo_id || "sem-centro"}><td><button className="report-cost-center-link" type="button" onClick={() => setCentroSelecionado(linha.centro_custo_id || "sem-centro")}>{label(linha)}</button></td><td>{linha.compradas}</td><td>{linha.abertas}</td><td>{linha.imprevistos}</td><td><strong>{dinheiro(Number(linha.valor_total))}</strong></td></tr>)}</tbody></table>}</section>
    </>}
    {detalhe && (
      <div className="report-detail-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setCentroSelecionado(undefined);
      }}>
        <section className="report-detail-modal" role="dialog" aria-modal="true" aria-labelledby="report-detail-title">
          <div className="report-detail-head">
            <div>
              <h2 id="report-detail-title">Detalhamento do centro de custo</h2>
              <strong>Centro de custo: {label(detalhe.linha)}</strong>
              <small>Período: {aplicados.inicio || "início"} a {aplicados.fim || "hoje"}</small>
            </div>
            <button className="btn secondary" type="button" onClick={() => setCentroSelecionado(undefined)}>Fechar</button>
          </div>
          <h3>Resumo financeiro</h3>
          <div className="report-detail-summary">
            <ReportStat label="Valor total" value={dinheiro(detalhe.resumo.valorTotal)}/>
            <ReportStat label="Passagens" value={dinheiro(detalhe.resumo.passagens)}/>
            <ReportStat label="Uber" value={dinheiro(detalhe.resumo.uber)}/>
            <ReportStat label="Refeição" value={dinheiro(detalhe.resumo.refeicao)}/>
            <ReportStat label="Complementares/imprevistos" value={dinheiro(detalhe.resumo.complementares)}/>
            <ReportStat label="Solicitações compradas" value={detalhe.resumo.compradas}/>
            <ReportStat label="Solicitações em aberto" value={detalhe.resumo.abertas}/>
            <ReportStat label="Imprevistos/complementares" value={detalhe.resumo.imprevistos}/>
          </div>
          <h3>Solicitações do centro de custo</h3>
          <div className="report-detail-table">
            {!detalhe.solicitacoes.length ? (
              <Empty text="Nenhuma solicitação encontrada para este centro de custo no período."/>
            ) : (
              <table>
                <thead><tr><th>Funcionário</th><th>Motivo</th><th>Status</th><th>Data da solicitação</th><th>Comprada em</th><th>Total</th><th>Ação</th></tr></thead>
                <tbody>{detalhe.solicitacoes.map((item) => (
                  <tr key={item.solicitacao.id}>
                    <td>{item.solicitacao.funcionario?.nome || "Não identificado"}</td>
                    <td>{item.solicitacao.motivo ? motivoLabel[item.solicitacao.motivo as keyof typeof motivoLabel] : "Não informado"}</td>
                    <td>{statusLabel[item.solicitacao.status as keyof typeof statusLabel] || item.solicitacao.status}</td>
                    <td>{dataHora(item.solicitacao.created_at)}</td>
                    <td>{item.compradaEm ? dataHora(item.compradaEm) : "—"}</td>
                    <td><strong>{dinheiro(item.total)}</strong></td>
                    <td><Link className="btn secondary" to={`/solicitacoes/${item.solicitacao.id}`}>Abrir solicitação</Link></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    )}
  </Page>;
}

function ReportStat({ label, value }: { label: string; value: string | number }) {
  return <section className="stat"><span>{label}</span><strong>{value}</strong></section>;
}
