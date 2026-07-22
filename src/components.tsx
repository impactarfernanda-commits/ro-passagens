import {
  Bell,
  BarChart3,
  FileSpreadsheet,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Plane,
  Plus,
  Settings,
  Ticket,
  X,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import logoTanksBR from "./assets/logo-tanksbr.png";
type LogoSize = "sidebar" | "header" | "login" | "compact";
export function TanksBRLogo({
  className = "",
  size = "header",
}: {
  className?: string;
  size?: LogoSize;
}) {
  return (
    <img
      src={logoTanksBR}
      alt="TanksBR"
      width={1881}
      height={430}
      className={`brand-logo brand-logo-${size} ${className}`}
    />
  );
}
export function BrandLogo({ className = "" }: { className?: string }) {
  return <TanksBRLogo className={className} size="login" />;
}
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="logo">
      <TanksBRLogo size={compact ? "compact" : "sidebar"} />
    </div>
  );
}
export function Sidebar({
  open,
  onClose,
  onLogout,
  canViewAll,
  admin,
  canImport,
}: {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  canViewAll: boolean;
  admin: boolean;
  canImport: boolean;
}) {
  const links = [
    ["/", "Portal", LayoutDashboard],
    ["/painel", "Painel", LayoutDashboard],
    ["/solicitacoes", "Solicitações", ListChecks],
    ["/nova", "Nova solicitação", Plus],
  ] as const;
  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="side-top">
          <Logo />
          <button className="icon mobile" onClick={onClose}>
            <X />
          </button>
        </div>
        <nav>
          {links
            .filter(([, label]) => canViewAll || label !== "Painel")
            .map(([to, label, Icon]) => (
              <NavLink end key={to} to={to} onClick={onClose}>
                <Icon size={19} />
                {label}
              </NavLink>
            ))}
          {admin && (
            <NavLink to="/responsaveis" onClick={onClose}>
              <Settings size={19} />
              Responsáveis RO
            </NavLink>
          )}
          {canViewAll && (
            <NavLink to="/relatorios" onClick={onClose}>
              <BarChart3 size={19} />
              Relatórios
            </NavLink>
          )}
          {canImport && (
            <>
              <NavLink to="/importacao-funcionarios" onClick={onClose}>
                <FileSpreadsheet size={19} />
                Importar funcionários
              </NavLink>
              <NavLink to="/importacao-centros-custo" onClick={onClose}>
                <FileSpreadsheet size={19} />
                Importar centros de custo
              </NavLink>
            </>
          )}
        </nav>
        <div className="side-foot">
          <button onClick={onLogout}>
            <LogOut size={18} />
            Sair
          </button>
        </div>
      </aside>
      {open && <div className="overlay" onClick={onClose} />}
    </>
  );
}
export function Header({ onMenu }: { onMenu: () => void }) {
  return (
    <header>
      <button className="icon mobile" onClick={onMenu}>
        <Menu />
      </button>
      <div className="header-brand">
        <TanksBRLogo size="header" />
        <div className="header-title">
          <Ticket size={20} />
          <span>Portal Tanks BR</span>
        </div>
      </div>
      <button className="icon">
        <Bell size={20} />
      </button>
    </header>
  );
}
export function Page({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </main>
  );
}
export function Spinner() {
  return <div className="spinner" aria-label="Carregando" />;
}
export function Empty({
  text = "Nenhum registro encontrado.",
}: {
  text?: string;
}) {
  return (
    <div className="empty">
      <Plane size={32} />
      <p>{text}</p>
    </div>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>{status.replaceAll("_", " ")}</span>
  );
}
