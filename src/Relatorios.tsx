import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Empty, Page, Spinner } from "./components";
import { dinheiro, formatCentroCustoLabel, motivoLabel, statusOptions } from "./lib";
import { supabase } from "./supabase";
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
type SortKey = "codigo" | "nome" | "solicitacoes" | "valor_total";

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
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [ordem, setOrdem] = useState<SortKey>("codigo");
  const [direcao, setDirecao] = useState<"asc" | "desc">("asc");

  const carregar = useCallback(async () => {
    setLoading(true); setErro("");
    const semCentro = aplicados.centro === "sem-centro";
    const { data, error } = await supabase.rpc("ro_relatorio_centros_custo", {
      p_inicio: aplicados.inicio || null,
      p_fim: aplicados.fim || null,
      p_centro_custo_id: semCentro || !aplicados.centro ? null : aplicados.centro,
      p_sem_centro: semCentro,
      p_status: aplicados.status || null,
      p_motivo: aplicados.motivo || null,
      p_responsavel_ro_id: aplicados.responsavel || null,
    });
    if (error) setErro(error.message);
    else setDados((data || vazio) as unknown as RelatorioData);
    setLoading(false);
  }, [aplicados]);
  useEffect(() => { void carregar(); }, [carregar]);

  const linhas = useMemo(() => [...dados.linhas].sort((a, b) => {
    const factor = direcao === "asc" ? 1 : -1;
    if (ordem === "solicitacoes" || ordem === "valor_total") return (Number(a[ordem]) - Number(b[ordem])) * factor;
    const av = ordem === "codigo" ? (a.codigo || "ZZZZ") : (a.nome || a.descricao || "SEM CENTRO DE CUSTO");
    const bv = ordem === "codigo" ? (b.codigo || "ZZZZ") : (b.nome || b.descricao || "SEM CENTRO DE CUSTO");
    return av.localeCompare(bv, "pt-BR", { sensitivity: "base", numeric: true }) * factor;
  }), [dados.linhas, direcao, ordem]);

  function label(linha: LinhaRelatorio) {
    return linha.centro_custo_id ? formatCentroCustoLabel(linha) : "SEM CENTRO DE CUSTO";
  }
  function exportarCsv() {
    const cabecalho = ["Centro de custo","Solicitações","Compradas","Em aberto","Aguardando compra","Atrasadas","Imprevistos/complementares","Valor complementar","Valor total"];
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const registros = linhas.map((linha) => [label(linha),linha.solicitacoes,linha.compradas,linha.abertas,linha.aguardando_compra,linha.atrasadas,linha.imprevistos,Number(linha.valor_complementar).toFixed(2),Number(linha.valor_total).toFixed(2)]);
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
      <div className="stats report-stats"><ReportStat label="Total de solicitações" value={dados.resumo.solicitacoes}/><ReportStat label="Total comprado" value={dados.resumo.compradas}/><ReportStat label="Total em aberto" value={dados.resumo.abertas}/><ReportStat label="Imprevistos/complementares" value={dados.resumo.imprevistos}/><ReportStat label="Valor total geral" value={dinheiro(Number(dados.resumo.valor_total))}/></div>
      <div className="report-sort"><label>Ordenar por <select value={ordem} onChange={(e) => setOrdem(e.target.value as SortKey)}><option value="codigo">Código</option><option value="nome">Nome</option><option value="solicitacoes">Quantidade</option><option value="valor_total">Valor total</option></select></label><button className="btn secondary" type="button" onClick={() => setDirecao(direcao === "asc" ? "desc" : "asc")}>{direcao === "asc" ? "Crescente" : "Decrescente"}</button></div>
      <section className="card table-card">{!linhas.length ? <Empty text="Nenhum resultado para os filtros aplicados."/> : <table><thead><tr><th>Centro de custo</th><th>Solicitações</th><th>Compradas</th><th>Em aberto</th><th>Aguardando</th><th>Atrasadas</th><th>Imprevistos</th><th>Valor complementar</th><th>Valor total</th></tr></thead><tbody>{linhas.map((linha) => <tr key={linha.centro_custo_id || "sem-centro"}><td><strong>{label(linha)}</strong></td><td>{linha.solicitacoes}</td><td>{linha.compradas}</td><td>{linha.abertas}</td><td>{linha.aguardando_compra}</td><td>{linha.atrasadas}</td><td>{linha.imprevistos}</td><td>{dinheiro(Number(linha.valor_complementar))}</td><td><strong>{dinheiro(Number(linha.valor_total))}</strong></td></tr>)}</tbody></table>}</section>
    </>}
  </Page>;
}

function ReportStat({ label, value }: { label: string; value: string | number }) {
  return <section className="stat"><span>{label}</span><strong>{value}</strong></section>;
}
