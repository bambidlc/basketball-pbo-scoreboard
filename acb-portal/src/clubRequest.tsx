import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound, Send, Sparkles } from "lucide-react";
import { api, ApiError } from "./api";
import { Alert, Check, EmailField, toast } from "./components/ui";
import { CanchaSection, ClubInfoSection, DirectivaSection, EMPTY_CLUB, SeguroSection, type ClubDraft, type SetClub } from "./clubForm";
import { similarClubs } from "./clubSearch";
import { isEmail, validateClub } from "../shared/validation.js";
import { RULES } from "../shared/tournament.js";
import type { DirectoryClub, Issue } from "./types";

const STEPS = [
  { id: "club", label: "Club", sections: ["club"] },
  { id: "directiva", label: "Directiva", sections: ["directiva"] },
  { id: "cancha", label: "Cancha", sections: ["cancha"] },
  { id: "acceso", label: "Seguro y acceso", sections: ["seguro"] },
];

const DRAFT_KEY = "acb-register-draft";

function loadDraft(initialName: string): ClubDraft {
  let draft: ClubDraft = { ...EMPTY_CLUB };
  try {
    const saved = window.localStorage.getItem(DRAFT_KEY);
    if (saved) draft = { ...EMPTY_CLUB, ...JSON.parse(saved) };
  } catch {
    /* storage unavailable */
  }
  if (!String(draft.name || "").trim() && initialName.trim()) draft.name = initialName.trim();
  return draft;
}

export function ClubRequestForm({
  initialName,
  clubs,
  onCancel,
  onSubmitted,
  onShowClub,
}: {
  initialName: string;
  clubs: DirectoryClub[];
  onCancel: () => void;
  onSubmitted: (email: string) => void;
  onShowClub: (id: number) => void;
}) {
  const [club, setClub] = useState<ClubDraft>(() => loadDraft(initialName));
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [email2, setEmail2] = useState("");
  const [terms, setTerms] = useState(false);
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<{
    message: string;
    clubId: number;
  } | null>(null);

  const similar = useMemo(() => similarClubs(clubs, String(club.name || "")), [clubs, club.name]);

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
    if (key === "name") setConflict(null);
  };

  const scrollTop = () => document.getElementById("mi-club-main")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const goTo = (index: number) => {
    setStep(index);
    scrollTop();
  };

  const next = () => {
    const { errors } = validateClub(club);
    const found = errors.filter((e: Issue) => STEPS[step].sections.includes(e.section));
    setIssues(found);
    if (found.length) {
      toast(found[0].message, "error");
      return;
    }
    goTo(Math.min(step + 1, STEPS.length - 1));
  };

  const submit = async () => {
    setError("");
    setConflict(null);
    const all = validateClub(club).errors as Issue[];
    if (all.length) {
      const first = STEPS.findIndex((s) => s.sections.includes(all[0].section));
      setIssues(all);
      goTo(Math.max(0, first));
      toast(all[0].message, "error");
      return;
    }
    if (!isEmail(email)) return setError("Escriba un email válido para el acceso del club.");
    if (email.trim().toLowerCase() !== email2.trim().toLowerCase()) return setError("Los emails no coinciden.");
    if (!terms) return setError("Debe aceptar los términos para continuar.");
    setBusy(true);
    try {
      const result = await api.post<{ email: string }>("/api/register", {
        club,
        email: email.trim().toLowerCase(),
        acceptTerms: terms,
        hp,
      });
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      onSubmitted(result.email || email.trim().toLowerCase());
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && typeof err.extra?.clubId === "number") {
        setConflict({
          message: err.message,
          clubId: err.extra.clubId as number,
        });
      } else {
        setError(err.message);
        if (Array.isArray(err.extra?.errors)) setIssues(err.extra.errors as Issue[]);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="request">
      <button type="button" className="link-back" onClick={onCancel}>
        <ArrowLeft /> Volver a la búsqueda
      </button>
      <div className="request__head">
        <span className="request__icon">
          <Sparkles />
        </span>
        <div>
          <h2 className="h2">Solicitar inscripción del club</h2>
          <p className="muted">
            Complete la información de su club. Al final confirmará su email con un código y entrará directo a crear sus equipos. La ACB revisará su solicitud.
          </p>
        </div>
      </div>

      <div className="stepper" role="tablist" aria-label="Pasos de la solicitud">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === step}
            aria-current={i === step ? "step" : undefined}
            className={i < step ? "is-done" : ""}
            onClick={() => (i < step ? goTo(i) : undefined)}
          >
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
                <p>Este email será el usuario del club. Cada vez que entre le enviaremos un código de un solo uso; no hay contraseñas.</p>
              </div>
            </div>
            <div className="grid grid--2">
              <EmailField label="Email de acceso del club" required value={email} onChange={setEmail} />
              <EmailField label="Confirme el email" required value={email2} onChange={setEmail2} />
            </div>
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              className="sr-only"
              aria-hidden="true"
              name="company_url"
            />
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
            {conflict && (
              <div className="similar similar--warn" style={{ marginTop: 14 }} role="alert">
                <div>
                  <b>{conflict.message}</b>
                </div>
                <button type="button" className="btn btn--blue btn--sm" onClick={() => onShowClub(conflict.clubId)}>
                  Ver ese club <ArrowRight />
                </button>
              </div>
            )}
          </section>
        </>
      )}

      <div className="request__nav">
        {step === 0 && similar.length > 0 && (
          <div className="similar" role="status">
            <div>
              <b>¿Su club ya está en el portal?</b>
              <span className="small"> Si es uno de estos, no lo registre otra vez: vea su estado y entre con su código.</span>
            </div>
            <div className="similar__list">
              {similar.map((c) => (
                <button key={c.id} type="button" className="similar__item" onClick={() => onShowClub(c.id)}>
                  <span>
                    <b>{c.name}</b>
                    <span className="small muted">{[c.acronym, c.municipality].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="similar__go">
                    Ver estado <ArrowRight />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="request__nav-row">
          <button type="button" className="btn btn--ghost" onClick={() => (step === 0 ? onCancel() : goTo(step - 1))}>
            <ArrowLeft /> {step === 0 ? "Cancelar" : "Atrás"}
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn--blue" onClick={next}>
              Continuar <ArrowRight />
            </button>
          ) : (
            <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={submit}>
              {busy ? "Enviando…" : "Enviar solicitud y recibir código"} {!busy && <Send />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
