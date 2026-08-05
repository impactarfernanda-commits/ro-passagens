import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./supabase";
import { Header, Sidebar, Spinner } from "./components";
import {
  Dashboard,
  Detalhe,
  Login,
  NovaSolicitacao,
  Configuracoes,
  Solicitacoes,
} from "./pages";
import { Portal } from "./Portal";
import { Relatorios } from "./Relatorios";

export type Access = {
  isRO: boolean;
  isAdmin: boolean;
  canViewAll: boolean;
  canOperateRO: boolean;
  canManageRO: boolean;
  canImport: boolean;
  role: string | null;
  isRh: boolean;
  canManageRh: boolean;
};

const EMPTY_ACCESS: Access = {
  isRO: false,
  isAdmin: false,
  canViewAll: false,
  canOperateRO: false,
  canManageRO: false,
  canImport: false,
  role: null,
  isRh: false,
  canManageRh: false,
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [side, setSide] = useState(false);
  const [access, setAccess] = useState<Access>(EMPTY_ACCESS);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) {
      setAccess(EMPTY_ACCESS);
      setAccessLoading(false);
      return;
    }
    setAccessLoading(true);
    Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", session.user.id),
      supabase
        .from("ro_responsaveis")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("ativo", true)
        .maybeSingle(),
      supabase.rpc("ro_is_system_admin", { p_user: session.user.id }),
      supabase.rpc("ro_is_rh_active", { p_user_id: session.user.id }),
      supabase.rpc("ro_can_manage_rh"),
    ])
      .then(([roles, ro, systemAdmin, rh, manageRh]) => {
        const names = (roles.data || []).map((r) => String(r.role));
        const role = names.includes("diretor") ? "diretor" : names.includes("gerente") ? "gerente" : names[0] || null;
        const isAdmin = names.some((r) => ["gerente", "diretor"].includes(r));
        const isRO = Boolean(ro.data);
        setAccess({
          role,
          isRO,
          isAdmin,
          canViewAll: isAdmin || isRO,
          canOperateRO: isRO,
          canManageRO: isAdmin,
          canImport: Boolean(systemAdmin.data),
          isRh: Boolean(rh.data),
          canManageRh: Boolean(manageRh.data),
        });
      })
      .finally(() => setAccessLoading(false));
  }, [session]);
  if (loading || accessLoading)
    return (
      <div className="full">
        <Spinner />
      </div>
    );
  if (!session) return <Login />;
  return (
    <Routes>
      <Route
        path="/"
        element={<Portal onLogout={() => supabase.auth.signOut()} />}
      />
      <Route
        path="/*"
        element={
          <div className="shell">
            <Sidebar
              open={side}
              onClose={() => setSide(false)}
              onLogout={() => supabase.auth.signOut()}
              canViewAll={access.canViewAll}
              canConfigure={access.canImport}
            />
            <section className="content">
              <Header onMenu={() => setSide(true)} />
              <Routes>
                <Route
                  path="/painel"
                  element={
                    access.canViewAll ? (
                      <Dashboard access={access} />
                    ) : (
                      <Navigate to="/solicitacoes" replace />
                    )
                  }
                />
                <Route
                  path="/solicitacoes"
                  element={
                    <Solicitacoes access={access} userId={session.user.id} />
                  }
                />
                <Route
                  path="/relatorios"
                  element={
                    access.canViewAll ? (
                      <Relatorios />
                    ) : (
                      <Navigate to="/solicitacoes" replace />
                    )
                  }
                />
                <Route
                  path="/nova"
                  element={<NovaSolicitacao userId={session.user.id} access={access} />}
                />
                <Route
                  path="/configuracoes"
                  element={access.canImport ? <Configuracoes /> : <Navigate to="/painel" replace />}
                />
                <Route
                  path="/configuracoes-rh"
                  element={<Navigate to="/configuracoes?aba=responsaveis-rh" replace />}
                />
                <Route
                  path="/solicitacoes/:id"
                  element={<Detalhe access={access} userId={session.user.id} />}
                />
                <Route
                  path="/responsaveis"
                  element={<Navigate to="/configuracoes?aba=responsaveis-ro" replace />}
                />
                <Route
                  path="/importacao-funcionarios"
                  element={
                    <Navigate to="/configuracoes?aba=importacoes&tipo=funcionarios" replace />
                  }
                />
                <Route
                  path="/importacao-centros-custo"
                  element={
                    <Navigate to="/configuracoes?aba=importacoes&tipo=centros-custo" replace />
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </section>
          </div>
        }
      />
    </Routes>
  );
}

export function EnvWarning() {
  return !configured ? (
    <div className="alert">
      Configure o arquivo <code>.env.local</code> usando o modelo{" "}
      <code>.env.example</code>.
    </div>
  ) : null;
}
