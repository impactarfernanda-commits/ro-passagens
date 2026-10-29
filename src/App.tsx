import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./supabase";
import { Header, Sidebar, Spinner } from "./components";
import {
  Dashboard,
  Detalhe,
  Login,
  NovaSolicitacao,
  Configuracoes,
  EnderecosFuncionarios,
  Solicitacoes,
} from "./pages";
import { Portal } from "./Portal";
import { Relatorios } from "./Relatorios";
import { podeAcessarAreasGerais, podeAcessarImportacaoEnderecos } from "./addressAccess";
import { PasswordRecovery } from "./PasswordRecovery";
import { Logout } from "./Logout";
import { EMPTY_ACCESS, invalidateAccess, loadAccess, subscribeAccessInvalidation, type Access } from "./accessCache";
import { setCatalogCacheUser } from "./catalogCache";
import { subscribeVisible } from "./visibilityRevalidation";

export type { Access } from "./accessCache";

function accessLabel(access: Access) {
  if (access.isRO) return "Equipe RO";
  if (access.isRh) return "Recursos Humanos";
  if (access.role === "diretor") return "Diretoria";
  if (access.role === "gerente") return "Gerência";
  if (access.role === "coordenador") return "Coordenação";
  return "Solicitante";
}

export function App() {
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [recoveryOnly, setRecoveryOnly] = useState(() => sessionStorage.getItem("portal-password-recovery") === "active");
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [side, setSide] = useState(false);
  const [access, setAccess] = useState<Access>(EMPTY_ACCESS);
  const [userName, setUserName] = useState("");
  const accessRequest = useRef(0);
  const clearLocalAuthState = useCallback(() => {
    invalidateAccess();
    setCatalogCacheUser(null);
    setSession(null);
    setRecoveryOnly(false);
    setAccess(EMPTY_ACCESS);
    setAccessLoading(false);
    setSide(false);
    setUserName("");
  }, []);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setCatalogCacheUser(s?.user.id || null);
      if (event === "USER_UPDATED" && s) invalidateAccess(s.user.id);
      if (event === "SIGNED_OUT") invalidateAccess();
      if (event === "PASSWORD_RECOVERY") setRecoveryOnly(true);
      if (event === "SIGNED_OUT") setRecoveryOnly(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) {
      setAccess(EMPTY_ACCESS);
      setAccessLoading(false);
      return;
    }
    setCatalogCacheUser(session.user.id);
    setAccessLoading(true);
    let active = true;
    const refresh = () => {
      const request = ++accessRequest.current;
      return loadAccess(session).then((snapshot) => {
        if (!active || request !== accessRequest.current) return;
        setUserName(snapshot.userName);
        setAccess(snapshot.access);
      }).finally(() => { if (active && request === accessRequest.current) setAccessLoading(false); });
    };
    const unsubscribe = subscribeAccessInvalidation((userId) => {
      if (!userId || userId === session.user.id) void refresh();
    });
    const unsubscribeVisibility = subscribeVisible(document, () => { void refresh(); });
    void refresh();
    return () => {
      active = false;
      accessRequest.current += 1;
      unsubscribe();
      unsubscribeVisibility();
    };
  }, [session]);
  if (location.pathname === "/logout") return <Logout clearLocalAuthState={clearLocalAuthState} />;
  if (recoveryOnly && location.pathname !== "/redefinir-senha") return <Navigate to="/redefinir-senha" replace />;
  if (location.pathname === "/redefinir-senha") return <PasswordRecovery />;
  if (loading || accessLoading)
    return (
      <div className="full">
        <Spinner />
      </div>
    );
  if (!session) return <Login />;
  const canAccessAddressImport = podeAcessarImportacaoEnderecos(access);
  const canAccessGeneralAreas = podeAcessarAreasGerais(access);
  return (
    <Routes>
      <Route
        path="/"
        element={<Portal onLogout={() => supabase.auth.signOut({ scope: "local" })} />}
      />
      <Route
        path="/*"
        element={
          <div className="shell">
            <Sidebar
              open={side}
              onClose={() => setSide(false)}
              onLogout={() => supabase.auth.signOut({ scope: "local" })}
              canViewAll={access.canViewAll}
              canConfigure={access.canImport}
              canImportAddresses={canAccessAddressImport}
              isRh={access.isRh}
              canApprove={access.canApprove}
              userName={userName}
              profileLabel={accessLabel(access)}
            />
            <section className="content">
              <Header onMenu={() => setSide(true)} userId={session.user.id} />
              <Routes>
                <Route
                  path="/painel"
                  element={
                    canAccessGeneralAreas ? (
                      <Dashboard access={access} />
                    ) : (
                      <Navigate to="/solicitacoes" replace />
                    )
                  }
                />
                <Route
                  path="/solicitacoes"
                  element={
                    <Solicitacoes key={session.user.id} access={access} userId={session.user.id} />
                  }
                />
                <Route path="/minhas-aprovacoes" element={access.canApprove ? <Solicitacoes key={session.user.id} access={access} userId={session.user.id} approvalsOnly /> : <Navigate to="/solicitacoes" replace />} />
                <Route
                  path="/relatorios"
                  element={
                    canAccessGeneralAreas ? (
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
                  element={access.canImport ? <Configuracoes /> : <Navigate to="/solicitacoes" replace />}
                />
                <Route path="/rh/enderecos" element={canAccessAddressImport ? <EnderecosFuncionarios /> : <Navigate to="/solicitacoes" replace />} />
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
