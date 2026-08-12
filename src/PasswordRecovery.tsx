import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLogo, Spinner } from "./components";
import { clearRecoveryUrl, INVALID_RECOVERY_MESSAGE, PASSWORD_MIN_LENGTH, PASSWORD_RESET_SUCCESS_MESSAGE, recoveryParams } from "./auth";
import { supabase } from "./supabase";

type RecoveryState = "checking" | "ready" | "invalid" | "success";

export function PasswordRecovery() {
  const navigate = useNavigate();
  const [state, setState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    let active = true;
    const params = recoveryParams(globalThis.location);
    const recoveryEvidence = params.type === "recovery" || Boolean(params.code || params.tokenHash || params.hasImplicitSession);
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || event !== "PASSWORD_RECOVERY" || !session) return;
      sessionStorage.setItem("portal-password-recovery", "active");
      clearRecoveryUrl();
      setState("ready");
    });
    async function initialize() {
      try {
        let authError = null;
        if (params.tokenHash) {
          ({ error: authError } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: "recovery" }));
        } else if (params.code) {
          const current = await supabase.auth.getSession();
          if (!current.data.session) ({ error: authError } = await supabase.auth.exchangeCodeForSession(params.code));
        }
        const { data, error: sessionError } = await supabase.auth.getSession();
        const marked = sessionStorage.getItem("portal-password-recovery") === "active";
        if (!active) return;
        if (!authError && !sessionError && data.session && (recoveryEvidence || marked)) {
          sessionStorage.setItem("portal-password-recovery", "active");
          clearRecoveryUrl();
          setState("ready");
        } else setState("invalid");
      } catch {
        if (active) setState("invalid");
      }
    }
    void initialize();
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (password.length < PASSWORD_MIN_LENGTH) return setError(`A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
    if (password !== confirmation) return setError("As senhas não conferem.");
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.status === 401 || updateError.status === 403 ? INVALID_RECOVERY_MESSAGE : "Não foi possível redefinir a senha. Verifique sua conexão e tente novamente.");
      setBusy(false);
      return;
    }
    sessionStorage.removeItem("portal-password-recovery");
    await supabase.auth.signOut();
    setPassword(""); setConfirmation(""); setState("success");
    navigate("/", { replace: true, state: { passwordReset: PASSWORD_RESET_SUCCESS_MESSAGE } });
  }

  if (state === "checking") return <div className="full"><Spinner /></div>;
  if (state === "invalid") return <RecoveryShell><div className="error" role="alert">{INVALID_RECOVERY_MESSAGE}</div><Link className="btn primary auth-submit" to="/" state={{ recoverPassword: true }}>Solicitar novo link</Link></RecoveryShell>;
  return <RecoveryShell>{state === "success" && <div className="success" role="status">{PASSWORD_RESET_SUCCESS_MESSAGE}</div>}{error && <div className="error" role="alert">{error}</div>}<form className="recovery-form" onSubmit={submit}><label>Nova senha<input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres`} /></label><label>Confirmar nova senha<input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Digite a senha novamente" /></label><button className="btn primary auth-submit" disabled={busy}>{busy ? "Aguarde..." : "Redefinir senha"}</button></form></RecoveryShell>;
}

function RecoveryShell({ children }: { children: React.ReactNode }) {
  return <div className="login"><div className="login-accent" /><section className="login-card" aria-labelledby="recovery-title"><BrandLogo className="login-logo" /><div className="login-heading"><h1 id="recovery-title">Redefinir senha</h1><p>Crie uma nova senha para o Portal Tanks BR</p></div>{children}<Link className="auth-link" to="/">Voltar para entrar</Link></section></div>;
}
