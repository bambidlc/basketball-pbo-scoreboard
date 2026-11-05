import { useState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { api } from "../api";
import { TopBar } from "../components/Brand";
import { CodeInput } from "../components/CodeInput";
import { Alert, EmailField } from "../components/ui";
import { clearPortalCache } from "../portal";
import { Link, navigate, useLocation } from "../router";
import { isEmail } from "../../shared/validation.js";

export function VerifyCode({ email, onBack, intro }: { email: string; onBack: () => void; intro?: string }) {
  const { search } = useLocation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);

  const verify = async (value = code) => {
    if (value.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/api/login/verify", { email, code: value });
      clearPortalCache();
      const next = new URLSearchParams(search).get("next");
      navigate(next && next.startsWith("/portal") ? next : "/portal", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError("");
    try {
      await api.post("/api/login/request", { email });
      setResent(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div style={{ textAlign: "center" }}>
        <MailCheck size={36} color="#f26a1b" />
        <div className="h2" style={{ marginTop: 6 }}>
          Revise su email
        </div>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {intro || "Enviamos un código de 6 dígitos a"} <b style={{ color: "#0b1640" }}>{email}</b>
        </p>
      </div>
      <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} />
      {error && <Alert kind="error">{error}</Alert>}
      {resent && !error && <Alert kind="ok">Le enviamos un código nuevo.</Alert>}
      <button className="btn btn--primary btn--lg btn--block" style={{ marginTop: 14 }} disabled={busy || code.length !== 6} onClick={() => void verify()}>
        {busy ? "Verificando…" : "Entrar al portal"}
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 14 }}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
          <ArrowLeft /> Cambiar email
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={resend}>
          Reenviar código
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 16, textAlign: "center" }}>
        ¿No llega? Revise la carpeta de correo no deseado. El código vence en 15 minutos.
      </p>
    </>
  );
}

export function Login() {
  const { search } = useLocation();
  const [email, setEmail] = useState(() => new URLSearchParams(search).get("email") || "");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const request = async () => {
    if (!isEmail(email)) {
      setError("Escriba el email registrado del club.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.post("/api/login/request", { email: email.trim().toLowerCase() });
      setStep("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar />
      <main className="auth">
        <div className="auth__card">
          <img className="auth__logo" src="/acb-logo-256.png" alt="ACB" />
          {step === "email" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void request();
              }}
            >
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <p className="eyebrow" style={{ justifyContent: "center" }}>
                  Portal de clubes
                </p>
                <div className="h2">Entrar</div>
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  Escriba el email con que registró el club. Le enviaremos un código de acceso.
                </p>
              </div>
              <EmailField label="Email del club" required value={email} onChange={setEmail} error={error || undefined} />
              <button className="btn btn--primary btn--lg btn--block" style={{ marginTop: 16 }} disabled={busy}>
                {busy ? "Enviando…" : "Enviarme el código"}
              </button>
              <p className="small muted" style={{ textAlign: "center", marginTop: 18 }}>
                ¿Su club no está registrado? <Link to="/registro">Registrar club</Link>
              </p>
            </form>
          ) : (
            <VerifyCode email={email.trim().toLowerCase()} onBack={() => setStep("email")} intro="Si el email está registrado, enviamos un código de 6 dígitos a" />
          )}
        </div>
      </main>
    </>
  );
}
