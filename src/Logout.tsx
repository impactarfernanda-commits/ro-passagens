import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "./components";
import { supabase } from "./supabase";

type LogoutProps = {
  clearLocalAuthState: () => void;
};

export function Logout({ clearLocalAuthState }: LogoutProps) {
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        sessionStorage.removeItem("portal-password-recovery");
        clearLocalAuthState();
        navigate("/", { replace: true });
      }
    })();
  }, [clearLocalAuthState, navigate]);

  return (
    <div className="full" aria-label="Encerrando sessão">
      <Spinner />
    </div>
  );
}
