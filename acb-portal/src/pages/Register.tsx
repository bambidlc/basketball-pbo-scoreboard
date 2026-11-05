import { useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound } from "lucide-react";
import { api, ApiError } from "../api";
import { Footer, TopBar } from "../components/Brand";
import { Alert, Check, EmailField, toast } from "../components/ui";
import { CanchaSection, ClubInfoSection, DirectivaSection, EMPTY_CLUB, SeguroSection, type ClubDraft, type SetClub } from "../clubForm";
import { isEmail, validateClub } from "../../shared/validation.js";
import { RULES } from "../../shared/tournament.js";
import { VerifyCode } from "./Login";
import type { Issue } from "../types";

const STEPS = [
  { id: "club", label: "Club", sections: ["club"] },
  { id: "directiva", label: "Directiva", sections: ["directiva"] },
  { id: "cancha", label: "Cancha", sections: ["cancha"] },
  { id: "acceso", label: "Seguro y acceso", sections: ["seguro"] },
];

const DRAFT_KEY = "acb-register-draft";

function loadDraft(): ClubDraft {
  try {
    const saved = window.localStorage.getItem(DRAFT_KEY);
    return saved ? { ...EMPTY_CLUB, ...JSON.parse(saved) } : { ...EMPTY_CLUB };
  } catch {
    return { ...EMPTY_CLUB };
  }
}

export function Register() {
  const [club, setClub] = useState<ClubDraft>(loadDraft);
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [email2, setEmail2] = useState("");
  const [terms, setTerms] = useState(false);
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState("");
  const [verifyEmail, setVerifyEmail] = useState("");

  const set: SetClub = (key, value) => {
    setClub((c) => {
      const next = { ...c, [key]: value };
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
    setIssues((list) => list.filter((i) => i.field !== key));
  };

  const stepIssues = (index: number) => {
    const { errors } = validateClub(club);
    return errors.filter((e: Issue) => STEPS[index].sections.includes(e.section));
  };

  const next = () => {
    const found = stepIssues(step);
    setIssues(found);
    if (found.length) {
      toast(found[0].message, "error");
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    setError("");
    const all = validateClub(club).errors as Issue[];
    if (all.length) {
      const first = STEPS.findIndex((s) => s.sections.includes(all[0].section));
      setIssues(all);
      setStep(Math.max(0, first));
      toast(all[0].message, "error");
      return;
    }
    if (!isEmail(email)) return setError("Escriba un email válido para el acceso del club.");
    if (email.trim().toLowerCase() !== email2.trim().toLowerCase()) return setError("Los emails no coinciden.");
    if (!terms) return setError("Debe aceptar los términos para continuar.");
    setBusy(true);
    try {
      const result = await api.post<{ email: string }>("/api/register", { club, email: email.trim().toLowerCase(), acceptTerms: terms, hp });
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      setVerifyEmail(result.email);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      if (Array.isArray(err.extra?.errors)) setIssues(err.extra.errors as Issue[]);
    } finally {
      setBusy(false);
    }
  };

  if (verifyEmail) {
    return (
      <>
        <TopBar />
        <main className="auth">
          <div className="auth__card">
            <img className="auth__logo" src="/acb-logo-256.png" alt="ACB" />
            <VerifyCode email={verifyEmail} onBack={() => setVerifyEmail("")} intro="¡Club registrado! Para activar su acceso, escriba el código que enviamos a" />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="wrap" style={{ maxWidth: 980 }}>
          <div className="page-head">
            <div>
              <p className="eyebrow">Torneo #30 · 2027</p>
              <h1 className="display">
                Registrar <em>club</em>
              </h1>
              <p className="lead">Complete la información de su club. Luego recibirá un código por email para entrar y crear sus equipos.</p>
            </div>
          </div>

          <div className="stepper" role="tablist">
            {STEPS.map((s, i) => (
              <button key={s.id} type="button" aria-current={i === step ? "step" : undefined} className={i < step ? "is-done" : ""} onClick={() => (i < step ? setStep(i) : undefined)}>
                <span className="num">{i + 1}</span>
                {s.label}
              </button>
            ))}
          </div>

          {step === 0 && <ClubInfoSection club={club} set={set} issues={issues} />}
          {step === 1 && <DirectivaSection club={club} set={set} issues={issues} />}
          {step === 2 && (
            <>
              <Alert kind="info" title="Puede completar esto después">
                La cancha y las fechas disponibles se pueden editar luego desde el Perfil del club (fecha límite: 30 de diciembre de 2026).
              </Alert>
              <div style={{ height: 14 }} />
              <CanchaSection club={club} set={set} issues={issues} />
            </>
          )}
          {step === 3 && (
            <>
              <SeguroSection club={club} set={set} issues={issues} />
              <section className="form-section">
                <div className="form-section__head">
                  <div className="form-section__icon">
                    <KeyRound />
                  </div>
                  <div>
                    <div className="h3">Acceso al portal</div>
                    <p>Este email será el usuario del club. Cada vez que entre le enviaremos un código de un solo uso.</p>
                  </div>
                </div>
                <div className="grid grid--2">
                  <EmailField label="Email de acceso del club" required value={email} onChange={setEmail} />
                  <EmailField label="Confirme el email" required value={email2} onChange={setEmail2} />
                </div>
                <input type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="sr-only" aria-hidden="true" name="company_url" />
                <div style={{ marginTop: 16 }}>
                  <Check checked={terms} onChange={setTerms}>
                    Certifico que la información es correcta y que represento al club. Acepto que la ACB use estos datos para la inscripción y organización del
                    Torneo #30. <small>{RULES.consent}</small>
                  </Check>
                </div>
                {error && (
                  <div style={{ marginTop: 14 }}>
                    <Alert kind="error">{error}</Alert>
                  </div>
                )}
              </section>
            </>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
            <button type="button" className="btn btn--ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              <ArrowLeft /> Atrás
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn btn--blue" onClick={next}>
                Continuar <ArrowRight />
              </button>
            ) : (
              <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={submit}>
                {busy ? "Registrando…" : "Registrar club y recibir código"}
              </button>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
