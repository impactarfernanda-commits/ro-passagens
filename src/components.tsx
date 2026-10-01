import {
  Bell,
  BarChart3,
  CheckCircle2,
  House,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Plane,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import logoTanksBR from "./assets/logo-tanksbr.png";
import { supabase } from "./supabase";
import type { Notificacao } from "./types";
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
  canConfigure,
  canImportAddresses,
  isRh,
  canApprove,
  userName,
  profileLabel,
}: {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  canViewAll: boolean;
  canConfigure: boolean;
  canImportAddresses: boolean;
  isRh: boolean;
  canApprove: boolean;
  userName: string;
  profileLabel: string;
}) {
  const canViewGeneralAreas = canViewAll && (!isRh || canConfigure);
  const links = [
    ["/painel", "Painel", LayoutDashboard],
    ["/solicitacoes", "Solicitações", ListChecks],
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
            .filter(([, label]) => canViewGeneralAreas || label !== "Painel")
            .map(([to, label, Icon]) => (
              <NavLink end key={to} to={to} onClick={onClose}>
                <Icon size={19} />
                {label}
              </NavLink>
            ))}
          {canViewGeneralAreas && (
            <NavLink to="/relatorios" onClick={onClose}>
              <BarChart3 size={19} />
              Relatórios
            </NavLink>
          )}
          {canApprove && <NavLink to="/minhas-aprovacoes" onClick={onClose}><CheckCircle2 size={19} />Minhas aprovações</NavLink>}
          {canImportAddresses && (
            <NavLink to="/rh/enderecos" onClick={onClose}>
              <Upload size={19} />
              Importação
            </NavLink>
          )}
          {canConfigure && (
            <NavLink to="/configuracoes" onClick={onClose}>
              <Settings size={19} />
              Configurações
            </NavLink>
          )}
        </nav>
        <div className="side-foot">
          <NavLink end to="/" onClick={onClose}>
            <House size={18} />
            Portal Tanks BR
          </NavLink>
          <div className="side-user" title={userName}>
            <strong>{userName}</strong>
            <span>{profileLabel}</span>
          </div>
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
type NotificationRow = Notificacao & { solicitacao_id: string; lida_em: string | null };

function NotificationCenter({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase.rpc("ro_listar_minhas_notificacoes");
    if (queryError) setError("Não foi possível carregar as notificações.");
    else setItems((data || []) as NotificationRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load, userId]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const unread = items.filter((item) => !item.lida_em).length;
  async function openNotification(item: NotificationRow) {
    if (!item.lida_em) {
      const { error: markError } = await supabase.rpc("ro_marcar_notificacao_lida", { p_notificacao_id: item.id });
      if (!markError) {
        const readAt = new Date().toISOString();
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, lida_em: readAt } : entry));
      }
    }
    setOpen(false);
    navigate(`/solicitacoes/${item.solicitacao_id}`);
  }
  return (
    <div className="notification-center" ref={root}>
      <button className="icon notification-trigger" type="button" aria-label={unread ? `Notificações: ${unread} não lidas` : "Notificações"} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void load(); }}>
        <Bell size={20} />
        {unread > 0 && <span className="notification-count">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <section className="notification-panel" aria-label="Notificações">
          <div className="notification-head"><strong>Notificações</strong>{unread > 0 && <span>{unread} não {unread === 1 ? "lida" : "lidas"}</span>}</div>
          <div className="notification-list">
            {loading ? <div className="notification-state">Carregando...</div> : error ? <div className="notification-state error">{error}</div> : !items.length ? <div className="notification-state">Você não tem notificações.</div> : items.map((item) => (
              <button type="button" className={`notification-item ${item.lida_em ? "read" : "unread"}`} key={item.id} onClick={() => void openNotification(item)}>
                <span>{item.mensagem}</span>
                <time dateTime={item.created_at}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at))}</time>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function Header({ onMenu, userId }: { onMenu: () => void; userId: string }) {
  return (
    <header>
      <button className="icon mobile" onClick={onMenu}>
        <Menu />
      </button>
      <div className="header-spacer" />
      <NotificationCenter userId={userId} />
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
