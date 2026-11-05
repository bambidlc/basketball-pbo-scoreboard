import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, MailCheck, RotateCcw } from "lucide-react";
import { api } from "../api";
import { clearPortalCache } from "../portal";
import { navigate, useLocation } from "../router";
import { CodeInput } from "./CodeInput";
import { Alert } from "./ui";

/** Who the code was sent to: a club picked from the directory, or an email typed by the club. */
export type CodeTarget = { clubId: number } | { email: string };

const RESEND_SECONDS = 30;

export function VerifyCode({
  target,
  shownEmail,
  title = "Revise su email",
  intro = "Enviamos un código de 6 dígitos a",
  onBack,
  backLabel = "Volver",
  footer,
}: {
  target: CodeTarget;
  shownEmail: string;
  title?: string;
  intro?: ReactNode;
  onBack: () => void;
  backLabel?: string;
  footer?: ReactNode;
}) {
  const { search } = useLocation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const verify = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/api/login/verify", { ...target, code: value });
      clearPortalCache();
      const next = new URLSearchParams(search).get("next");
      navigate(next && next.startsWith("/portal") ? next : "/portal", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setCode("");
      setBusy(false);
    }
  };

  const resend = async () => {
    setError("");
    setNotice("");
    try {
      if ("clubId" in target) await api.post(`/api/clubs/${target.clubId}/code`);
      else await api.post("/api/login/request", { email: target.email });
      setNotice("Le enviamos un código nuevo. El anterior ya no funciona.");
      setWait(RESEND_SECONDS);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="verify">
      <div className="verify__head">
        <span className="verify__icon">
          <MailCheck />
        </span>
        <div>
          <div className="h3">{title}</div>
          <p className="muted">
            {intro} <b className="verify__email">{shownEmail}</b>
          </p>
        </div>
      </div>
      <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} />
      {error && <Alert kind="error">{error}</Alert>}
      {notice && !error && <Alert kind="ok">{notice}</Alert>}
      <button type="button" className="btn btn--primary btn--lg btn--block" style={{ marginTop: 14 }} disabled={busy || code.length !== 6} onClick={() => void verify()}>
        {busy ? "Verificando…" : "Entrar al portal"}
      </button>
      <div className="verify__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
          <ArrowLeft /> {backLabel}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={resend} disabled={wait > 0}>
          <RotateCcw /> {wait > 0 ? `Reenviar en ${wait}s` : "Reenviar código"}
        </button>
      </div>
      <p className="small muted verify__help">
        El código vence en 15 minutos. ¿No llega? Revise la carpeta de correo no deseado o promociones.
      </p>
      {footer}
    </div>
  );
}
