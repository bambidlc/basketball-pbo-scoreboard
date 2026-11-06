import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ClipboardCheck,
  Cloud,
  CloudOff,
  FileSignature,
  FileText,
  IdCard,
  Loader2,
  Megaphone,
  PenLine,
  Plus,
  Printer,
  Send,
  Shirt,
  ShieldCheck,
  Trash2,
  Undo2,
  UserRound,
  Users,
} from "lucide-react";
import { api, ApiError } from "../api";
import { Footer } from "../components/Brand";
import { FileUpload } from "../components/FileUpload";
import { colorHex, ColorPicker, Jersey } from "../components/Jersey";
import { Alert, CenterLoad, Check, EmailField, PhoneField, Progress, Seg, SelectField, StateBadge, TextArea, TextField, toast } from "../components/ui";
import { errorFor } from "../clubForm";
import { usePortal } from "../portal";
import { Link, navigate } from "../router";
import {
  ADULT_SIZES,
  CATEGORIES,
  COACH_SHORTS_FEE,
  DEPOSIT_PER_TEAM,
  EXTRA_UNIFORM_FEE,
  GUARDIAN_RELATIONS,
  KID_SIZES,
  MAX_PLAYERS,
  MUNICIPALITIES,
  RULES,
  SCHEDULE_PREFS,
  SCHOOL_GRADES,
  UNIFORMS_INCLUDED,
  categoryBirthYear,
  eligibility,
  money,
  seasonAge,
  teamCosts,
} from "../../shared/tournament.js";
import { validateTeam } from "../../shared/validation.js";
import type { Issue, Player, Team, TeamPayload, TeamSummary } from "../types";

const TEAM_KEYS = [
  "program", "category", "gender", "division", "teamName", "shirtColor", "numberColor", "pantsColor",
  "coachName", "coachPhone", "coachEmail", "coachLic", "coachCert", "coachShorts", "coachWaist",
  "asstName", "asstPhone", "asstEmail", "asstLic", "asstCert", "asstShorts", "asstWaist",
  "scorerName", "scorerPhone", "scorerEmail", "scorerLic", "scorerCert",
  "managerName", "managerPhone", "managerEmail", "coachOtherTeam", "schedulePref", "paymentPlan", "notes",
] as const;
const PLAYER_KEYS = [
  "id", "number", "firstName", "lastName", "birthdate", "phone", "town", "school", "grade",
  "guardianName", "guardianRelation", "guardianPhone", "guardianEmail", "consent", "consentName", "shirtSize", "pantsSize",
] as const;

const TABS = [
  { id: "equipo", label: "Equipo", icon: Megaphone, sections: ["equipo"] },
  { id: "personal", label: "Personal técnico", icon: UserRound, sections: ["personal"] },
  { id: "uniformes", label: "Uniformes", icon: Shirt, sections: ["uniformes"] },
  { id: "jugadores", label: "Jugadores", icon: Users, sections: ["jugadores"] },
  { id: "revision", label: "Revisión y envío", icon: ClipboardCheck, sections: ["club"] },
] as const;
type TabId = (typeof TABS)[number]["id"];

const SECTION_TAB: Record<string, TabId> = { equipo: "equipo", personal: "personal", uniformes: "uniformes", jugadores: "jugadores", club: "revision" };
const SECTION_LABEL: Record<string, string> = { equipo: "Equipo", personal: "Personal técnico", uniformes: "Uniformes", jugadores: "Jugadores", club: "Club" };

const SIZE_OPTIONS = [
  ...KID_SIZES.map((s) => ({ value: s.value, label: `Niño ${s.label}` })),
  ...ADULT_SIZES.map((s) => ({ value: s.value, label: `Adulto ${s.label}` })),
];
const WAISTS = Array.from({ length: 14 }, (_, i) => String(26 + i * 2)).map((w) => ({ value: w, label: `${w}"` }));

let keySeed = 0;
const newKey = () => `n${Date.now().toString(36)}${(keySeed++).toString(36)}`;

function pick<T extends object>(obj: T, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj) out[k] = (obj as Record<string, unknown>)[k];
  return out;
}

function emptyPlayer(): Player {
  return {
    key: newKey(),
    number: "",
    firstName: "",
    lastName: "",
    birthdate: "",
    phone: "",
    town: "",
    school: "",
    grade: "",
    guardianName: "",
    guardianRelation: "",
    guardianPhone: "",
    guardianEmail: "",
    consent: false,
    consentName: "",
    shirtSize: "",
    pantsSize: "",
  };
}

function sameCoach(a: { coachLic?: string; coachName?: string }, b: { coachLic?: string; coachName?: string }) {
  const lic = (x: typeof a) => String(x.coachLic || "").replace(/\s/g, "").toLowerCase();
  const name = (x: typeof a) => String(x.coachName || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (lic(a) && lic(b)) return lic(a) === lic(b);
  return name(a) !== "" && name(a) === name(b);
}

export function TeamEditor({ id }: { id: number }) {
  const { me, refresh } = usePortal();
  const [team, setTeam] = useState<Team | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [otherTeams, setOtherTeams] = useState<TeamSummary[]>([]);
  const [tab, setTab] = useState<TabId>("equipo");
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showErrors, setShowErrors] = useState(false);
  const [certify, setCertify] = useState(false);
  const [certifyName, setCertifyName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");

  const teamRef = useRef(team);
  const playersRef = useRef(players);
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<unknown> | null>(null);
  teamRef.current = team;
  playersRef.current = players;
  dirtyRef.current = dirty;

  const applyPayload = useCallback((payload: TeamPayload) => {
    setTeam(payload.team);
    setPlayers(payload.players.map((p) => ({ ...p, key: `p${p.id}` })));
    setOtherTeams(payload.otherTeams);
    setCertifyName((v) => v || payload.team.coachName || "");
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<TeamPayload>(`/api/teams/${id}`)
      .then((payload) => alive && applyPayload(payload))
      .catch((e: ApiError) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [id, applyPayload]);

  const locked = team?.state === "submitted" || team?.state === "approved";

  const save = useCallback(async (): Promise<Map<string, number | undefined> | undefined> => {
    if (savingRef.current) await savingRef.current.catch(() => undefined);
    const snapTeam = teamRef.current;
    const snapPlayers = playersRef.current;
    if (!snapTeam) return undefined;
    const version = versionRef.current;
    setSaveState("saving");
    const run = (async () => {
      const res = await api.put<TeamPayload>(`/api/teams/${id}`, {
        team: pick(snapTeam, TEAM_KEYS),
        players: snapPlayers.map((p) => pick(p, PLAYER_KEYS)),
      });
      const keyToId = new Map(snapPlayers.map((p, i) => [p.key, res.players[i]?.id]));
      const serverById = new Map(res.players.map((p) => [p.id, p]));
      setPlayers((cur) =>
        cur.map((p) => {
          const pid = p.id ?? keyToId.get(p.key);
          const sp = pid ? serverById.get(pid) : undefined;
          return sp ? { ...p, id: pid, name: sp.name, eligibility: sp.eligibility, consentOn: sp.consentOn, birthCertName: sp.birthCertName, photoName: sp.photoName } : p;
        }),
      );
      setTeam((cur) =>
        cur
          ? {
              ...cur,
              name: res.team.name,
              fee: res.team.fee,
              extraFee: res.team.extraFee,
              shortsFee: res.team.shortsFee,
              total: res.team.total,
              playerCount: res.team.playerCount,
              completion: res.team.completion,
              uniformSummary: res.team.uniformSummary,
              state: res.team.state,
              adminFeedback: res.team.adminFeedback,
            }
          : cur,
      );
      setOtherTeams(res.otherTeams);
      if (versionRef.current === version) setDirty(false);
      setSaveState("saved");
      return keyToId;
    })();
    savingRef.current = run;
    try {
      return await run;
    } catch (e) {
      setSaveState("error");
      toast((e as Error).message, "error");
      throw e;
    } finally {
      if (savingRef.current === run) savingRef.current = null;
    }
  }, [id]);

  // Autosave a few seconds after the last edit.
  useEffect(() => {
    if (!dirty || locked) return;
    const timer = window.setTimeout(() => void save().catch(() => undefined), 2500);
    return () => window.clearTimeout(timer);
  }, [dirty, team, players, locked, save]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = () => {
    versionRef.current += 1;
    setDirty(true);
  };
  const setT = <K extends keyof Team>(key: K, value: Team[K]) => {
    setTeam((t) => (t ? { ...t, [key]: value } : t));
    touch();
  };
  const setP = (key: string, patch: Partial<Player>) => {
    setPlayers((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    touch();
  };

  const ensurePlayerSaved = async (key: string) => {
    const current = playersRef.current.find((p) => p.key === key);
    if (current?.id && !dirtyRef.current) return current.id;
    const map = await save();
    return map?.get(key) ?? playersRef.current.find((p) => p.key === key)?.id;
  };

  const files = useMemo(
    () => ({ coachCard: Boolean(team?.coachCardName), asstCard: Boolean(team?.asstCardName), scorerCard: Boolean(team?.scorerCardName) }),
    [team?.coachCardName, team?.asstCardName, team?.scorerCardName],
  );

  const validation = useMemo(() => {
    if (!team) return { errors: [] as Issue[], warnings: [] as Issue[] };
    return validateTeam(team, players, {
      club: me.club,
      otherTeams: otherTeams.map((t) => ({ ...t, label: t.name })),
      files,
      playerFiles: Object.fromEntries(players.map((p) => [p.id || p.key, { birthCert: Boolean(p.birthCertName) }])),
    }) as { errors: Issue[]; warnings: Issue[] };
  }, [team, players, me.club, otherTeams, files]);

  if (loadError)
    return (
      <main className="page">
        <div className="wrap wrap--narrow">
          <Alert kind="error" title="No se pudo abrir el equipo">
            {loadError} <Link to="/portal">Volver a mis equipos</Link>
          </Alert>
        </div>
      </main>
    );
  if (!team) return <CenterLoad />;

  const issuesFor = (section: string) => validation.errors.filter((e) => e.section === section);
  const err = (field: string) => (showErrors ? errorFor(validation.errors, field) : undefined);
  const playerErrors = (p: Player) => validation.errors.filter((e) => e.player === (p.id || p.key));
  const shortsCount = (team.coachShorts ? 1 : 0) + (team.asstShorts ? 1 : 0);
  const costs = teamCosts(team, players.length, shortsCount);
  const birthYear = categoryBirthYear(team.category);
  const coachTwin = otherTeams.filter((t) => sameCoach(t, team));
  const sectionsOk = ["equipo", "personal", "uniformes", "jugadores", "club"].filter((s) => !issuesFor(s).length).length;
  const percent = Math.round((sectionsOk / 5) * 100);

  const goToIssue = (issue: Issue) => {
    setShowErrors(true);
    setTab(SECTION_TAB[issue.section] || "equipo");
    if (issue.player !== undefined) {
      const p = players.find((x) => (x.id || x.key) === issue.player);
      if (p) setOpen(p.key);
    }
    if (issue.section === "club") navigate("/portal/club");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const addPlayer = () => {
    if (players.length >= MAX_PLAYERS) return toast(`Máximo ${MAX_PLAYERS} jugadores por equipo`, "error");
    const p = emptyPlayer();
    setPlayers((list) => [...list, p]);
    setOpen(p.key);
    touch();
  };
  const removePlayer = (p: Player) => {
    if (!window.confirm(`¿Eliminar a ${p.firstName || "este jugador"} del equipo?`)) return;
    setPlayers((list) => list.filter((x) => x.key !== p.key));
    touch();
  };
  const move = (index: number, delta: number) => {
    setPlayers((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
      return next;
    });
    touch();
  };
  const sortByNumber = () => {
    setPlayers((list) => [...list].sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999)));
    touch();
  };

  const submit = async () => {
    setShowErrors(true);
    if (validation.errors.length) {
      toast("Complete la información pendiente antes de enviar", "error");
      return;
    }
    if (!certify || certifyName.trim().length < 4) {
      toast("Marque la certificación y escriba su nombre", "error");
      return;
    }
    setSubmitting(true);
    try {
      if (dirtyRef.current) await save();
      await api.post(`/api/teams/${id}/submit`, { certify, certifyName });
      toast("¡Equipo enviado a la ACB!");
      const payload = await api.get<TeamPayload>(`/api/teams/${id}`);
      applyPayload(payload);
      void refresh();
    } catch (e) {
      const error = e as ApiError;
      toast(error.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const reopen = async () => {
    if (!window.confirm("¿Retirar el envío para hacer cambios? Deberá enviarlo de nuevo.")) return;
    try {
      await api.post(`/api/teams/${id}/reopen`);
      const payload = await api.get<TeamPayload>(`/api/teams/${id}`);
      applyPayload(payload);
      void refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async () => {
    if (!window.confirm("¿Eliminar este equipo y todos sus jugadores? Esta acción no se puede deshacer.")) return;
    try {
      await api.del(`/api/teams/${id}`);
      await refresh();
      navigate("/portal");
      toast("Equipo eliminado");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const print = async (doc: string) => {
    if (dirtyRef.current) await save().catch(() => undefined);
    window.open(`/portal/equipo/${id}/imprimir?doc=${doc}`, "_blank", "noopener");
  };

  const saveBadge =
    saveState === "saving" ? (
      <span className="save-state">
        <Loader2 className="spin" /> Guardando…
      </span>
    ) : saveState === "error" ? (
      <span className="save-state save-state--error">
        <CloudOff /> Error al guardar
      </span>
    ) : dirty ? (
      <span className="save-state save-state--dirty">
        <PenLine /> Cambios sin guardar
      </span>
    ) : (
      <span className="save-state save-state--ok">
        <Cloud /> Guardado
      </span>
    );

  // ------------------------------------------------------------------ tabs
  const roleCard = (prefix: "coach" | "asst" | "scorer" | "manager", title: string, sub: string, icon: ReactNode) => {
    const k = (s: string) => `${prefix}${s}` as keyof Team;
    const withCard = prefix !== "manager";
    const withShorts = prefix === "coach" || prefix === "asst";
    // The assistant is optional; once named, phone and license become required.
    const named = prefix !== "asst" || String(team.asstName || "").trim() !== "";
    return (
      <div className="role-card">
        <div className="role-card__head">
          <div className="role-card__icon">{icon}</div>
          <div>
            <div className="h3" style={{ margin: 0 }}>
              {title}
            </div>
            <div className="small muted">{sub}</div>
          </div>
        </div>
        <div className="grid grid--3">
          <TextField label="Nombre completo" required={prefix !== "asst"} value={String(team[k("Name")] || "")} onChange={(v) => setT(k("Name"), v as never)} error={err(`${prefix}Name`)} disabled={locked} maxLength={120} />
          <PhoneField label="Teléfono" required={prefix !== "scorer" && named} value={String(team[k("Phone")] || "")} onChange={(v) => setT(k("Phone"), v as never)} error={err(`${prefix}Phone`)} disabled={locked} />
          <EmailField label="Email" value={String(team[k("Email")] || "")} onChange={(v) => setT(k("Email"), v as never)} error={err(`${prefix}Email`)} disabled={locked} />
          {withCard && (
            <>
              <TextField label="# Licencia DRD" required={named} value={String(team[k("Lic")] || "")} onChange={(v) => setT(k("Lic"), v as never)} error={err(`${prefix}Lic`)} disabled={locked} maxLength={40} />
              <TextField label="Cert. FBPR" value={String(team[k("Cert")] || "")} onChange={(v) => setT(k("Cert"), v as never)} disabled={locked} maxLength={40} hint="Certificación de la Federación" />
              <div />
              <div className="span-all">
                <FileUpload
                  owner="team"
                  recordId={team.id}
                  field={`x_${prefix}_card`}
                  label="Copia de tarjeta federativa / Lic. DRD"
                  hint="Foto clara o PDF · obligatoria"
                  fileName={String(team[k("CardName")] || "")}
                  error={showErrors && Boolean(errorFor(validation.errors, `${prefix}Card`))}
                  disabled={locked}
                  capture
                  onChange={(name) => setTeam((t) => (t ? { ...t, [k("CardName")]: name } : t))}
                />
              </div>
            </>
          )}
          {withShorts && (
            <>
              <div className="span-2">
                <Check checked={Boolean(team[k("Shorts")])} onChange={(v) => setT(k("Shorts"), v as never)} disabled={locked}>
                  Ordenar pantalón corto de dirigente ({money(COACH_SHORTS_FEE)})
                </Check>
              </div>
              {team[k("Shorts")] ? (
                <SelectField label="Tamaño de cintura" required value={String(team[k("Waist")] || "")} onChange={(v) => setT(k("Waist"), v as never)} options={WAISTS} error={err(`${prefix}Waist`)} disabled={locked} />
              ) : (
                <div />
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const kidCounts = (key: "shirtSize" | "pantsSize", value: string) => players.filter((p) => p[key] === value).length;

  const tabEquipo = (
    <section className="form-section">
      <div className="form-section__head">
        <div className="form-section__icon">
          <Megaphone />
        </div>
        <div>
          <div className="h3">Categoría</div>
          <p>La categoría define el costo y la elegibilidad de los jugadores.</p>
        </div>
      </div>
      <div style={{ display: "grid", gap: 18 }}>
        <div>
          <div className="field__label" style={{ marginBottom: 8 }}>
            Categoría (edad)
          </div>
          <Seg className="seg--cats" value={team.category} options={CATEGORIES.map((c) => ({ value: c, label: `${c}U` }))} onChange={(v) => setT("category", v)} disabled={locked} />
        </div>
        <Alert kind="info" title={`Categoría ${team.category} años · nacidos en ${birthYear} o después`}>
          Inscripción {money(costs.base)} (incluye un balón y mínimo 8 juegos).
        </Alert>
        <div className="grid grid--2">
          <TextField label="Letra / sección" value={team.division} onChange={(v) => setT("division", v.toUpperCase().slice(0, 10))} placeholder="A, B…" disabled={locked} hint="Si el club tiene más de un equipo en la categoría" />
          <TextField label="Nombre del equipo" value={team.teamName} onChange={(v) => setT("teamName", v)} placeholder="Opcional" maxLength={80} disabled={locked} />
        </div>
        <div>
          <div className="field__label" style={{ marginBottom: 8 }}>
            Forma de pago en la inscripción
          </div>
          <Seg
            value={team.paymentPlan || "deposit"}
            options={[
              { value: "deposit", label: `Depósito ${money(DEPOSIT_PER_TEAM)}` },
              { value: "full", label: `Pago total ${money(costs.total)}` },
            ]}
            onChange={(v) => setT("paymentPlan", v)}
            disabled={locked}
          />
          <p className="field__hint" style={{ marginTop: 6 }}>
            El pago se realiza presencialmente. Pago final: 23 de enero de 2027.
          </p>
        </div>
        <TextArea label="Notas para la ACB" value={team.notes} onChange={(v) => setT("notes", v)} maxLength={2000} disabled={locked} placeholder="Información adicional sobre este equipo" />
      </div>
    </section>
  );

  const tabPersonal = (
    <section className="form-section">
      <div className="form-section__head">
        <div className="form-section__icon">
          <UserRound />
        </div>
        <div>
          <div className="h3">Personal técnico</div>
          <p>Es obligatorio incluir copia de las tarjetas federativas del dirigente, asistente y anotador.</p>
        </div>
      </div>
      {roleCard("coach", "Dirigente", "Responsable del equipo en cancha", <Megaphone />)}
      {roleCard("asst", "Asistente", "Recomendado", <Users />)}
      {roleCard("scorer", "Anotador", "Lleva la hoja de anotación", <PenLine />)}
      {roleCard("manager", "Apoderado(a)", "Contacto administrativo del equipo", <ShieldCheck />)}
      <div className="role-card">
        <div className="role-card__head">
          <div className="role-card__icon">
            <ArrowDownUp />
          </div>
          <div>
            <div className="h3" style={{ margin: 0 }}>
              Dirigente con 2 equipos
            </div>
            <div className="small muted">Solicitud de acomodo · fecha límite 30 de diciembre de 2026</div>
          </div>
        </div>
        {coachTwin.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <Alert kind="warn" title="Detectamos que este dirigente tiene otro equipo en su club">
              {coachTwin.map((t) => t.name).join(", ")}. Indique la preferencia AM o PM.
            </Alert>
          </div>
        )}
        <div className="grid grid--2">
          <TextField label="Otro equipo que dirige (si aplica)" value={team.coachOtherTeam} onChange={(v) => setT("coachOtherTeam", v)} placeholder="Club, categoría" maxLength={160} disabled={locked} />
          <div>
            <div className="field__label" style={{ marginBottom: 8 }}>
              Acomodo de horario
            </div>
            <Seg value={team.schedulePref || "none"} options={SCHEDULE_PREFS.map((s) => ({ value: s.value, label: s.label }))} onChange={(v) => setT("schedulePref", v)} disabled={locked} />
          </div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {RULES.schedule}
        </p>
      </div>
    </section>
  );

  const tabUniformes = (
    <section className="form-section">
      <div className="form-section__head">
        <div className="form-section__icon">
          <Shirt />
        </div>
        <div>
          <div className="h3">Formulario para uniformes 2027</div>
          <p>
            ACB provee {UNIFORMS_INCLUDED} uniformes. El #13 cuesta {money(EXTRA_UNIFORM_FEE)}. {RULES.uniforms}
          </p>
        </div>
      </div>
      <div className="uniform-layout">
        <div style={{ display: "grid", gap: 20 }}>
          <div className={`field ${err("shirtColor") ? "has-error" : ""}`}>
            <span className="field__label">
              Color de camiseta<span className="req">*</span>
            </span>
            <ColorPicker value={team.shirtColor} onChange={(v) => setT("shirtColor", v)} disabled={locked} />
          </div>
          <div className="field">
            <span className="field__label">
              Color de letras y números<span className="req">*</span>
            </span>
            <ColorPicker value={team.numberColor} onChange={(v) => setT("numberColor", v)} disabled={locked} />
          </div>
          <div className="field">
            <span className="field__label">
              Color de pantalón<span className="req">*</span>
            </span>
            <ColorPicker value={team.pantsColor} onChange={(v) => setT("pantsColor", v)} disabled={locked} />
          </div>
          <div>
            <div className="h3" style={{ marginBottom: 10 }}>
              Resumen de tallas
            </div>
            <div className="size-scroll">
            <table className="size-table">
              <thead>
                <tr>
                  <th>Niños</th>
                  <th>Camisa</th>
                  <th>Pantalón</th>
                  <th>Adulto</th>
                  <th>Camisa</th>
                  <th>Pantalón</th>
                </tr>
              </thead>
              <tbody>
                {KID_SIZES.map((k, i) => (
                  <tr key={k.value}>
                    <td>{k.label}</td>
                    <td>
                      <b>{kidCounts("shirtSize", k.value) || "–"}</b>
                    </td>
                    <td>
                      <b>{kidCounts("pantsSize", k.value) || "–"}</b>
                    </td>
                    <td>{ADULT_SIZES[i].label}</td>
                    <td>
                      <b>{kidCounts("shirtSize", ADULT_SIZES[i].value) || "–"}</b>
                    </td>
                    <td>
                      <b>{kidCounts("pantsSize", ADULT_SIZES[i].value) || "–"}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="small muted">
              Uniformes: {players.length} · incluidos {Math.min(players.length, UNIFORMS_INCLUDED)} · adicionales {costs.extraUniforms} ({money(costs.extraFee)}).
              {shortsCount > 0 && ` Pantalones cortos de dirigentes: ${shortsCount} (${money(costs.shortsFee)}).`} Las tallas se asignan en la pestaña Jugadores.
            </p>
          </div>
        </div>
        <div className="jersey">
          <Jersey shirt={team.shirtColor} numbers={team.numberColor} pants={team.pantsColor} number={players[0]?.number || "23"} name={team.teamName || me.club.acronym || "ACB"} />
          <p>Vista previa de colores</p>
        </div>
      </div>
    </section>
  );

  const shirtBg = colorHex(team.shirtColor, "#0b1640");
  const numFg = colorHex(team.numberColor, "#ffffff");

  const tabJugadores = (
    <section className="form-section">
      <div className="roster-head">
        <div>
          <div className="h3">
            Jugadores ({players.length}/{MAX_PLAYERS})
          </div>
          <div className="slots" aria-hidden="true">
            {Array.from({ length: MAX_PLAYERS }, (_, i) => (
              <i key={i} className={i < players.length ? (i >= UNIFORMS_INCLUDED ? "extra" : "on") : ""} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn--ghost btn--sm" type="button" onClick={sortByNumber} disabled={locked || players.length < 2}>
            <ArrowDownUp /> Ordenar por número
          </button>
          <button className="btn btn--primary btn--sm" type="button" onClick={addPlayer} disabled={locked || players.length >= MAX_PLAYERS}>
            <Plus /> Agregar jugador
          </button>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <Alert kind="info">
          Categoría {team.category}: nacidos en <b>{birthYear}</b> o después. Máximo {MAX_PLAYERS} jugadores. La firma del padre, madre o encargado autoriza a la ACB a dar
          su información a los auspiciadores.
        </Alert>
      </div>
      {players.length === 0 && (
        <button type="button" className="team-card team-card--add" style={{ width: "100%", minHeight: 140 }} onClick={addPlayer} disabled={locked}>
          <Plus /> Agregar el primer jugador
        </button>
      )}
      {players.map((p, index) => {
        const perr = playerErrors(p);
        const elig = eligibility(p.birthdate, team.category);
        const isOpen = open === p.key;
        const pe = (field: string) => (showErrors ? perr.find((e) => e.field === field)?.message.replace(/^[^:]+:\s*/, "") : undefined);
        return (
          <div key={p.key} className={`player ${showErrors && perr.length ? "has-error" : ""}`} style={{ ["--jersey" as string]: shirtBg, ["--jersey-num" as string]: numFg }}>
            <div className="player__bar" onClick={() => setOpen(isOpen ? null : p.key)}>
              <div className="player__num">{p.number || "–"}</div>
              <div className="player__name">
                <b>{`${p.firstName} ${p.lastName}`.trim() || `Jugador ${index + 1}`}</b>
                <span>
                  {p.birthdate ? `Nacido ${p.birthdate.slice(0, 4)} · ${seasonAge(p.birthdate)} años` : "Sin fecha de nacimiento"}
                  {p.school ? ` · ${p.school}` : ""}
                  {p.shirtSize ? ` · Camisa ${p.shirtSize}` : ""}
                </span>
              </div>
              <div className="player__flags">
                {p.birthdate && (
                  <span className={`flag ${elig.level === "error" ? "flag--err" : elig.level === "info" ? "flag--info" : "flag--ok"}`} title={elig.message}>
                    {elig.level === "error" ? <CircleAlert /> : <CheckCircle2 />}
                    {elig.level === "error" ? "No elegible" : elig.level === "info" ? "Sube" : "Elegible"}
                  </span>
                )}
                <span className={`flag ${p.consent && p.consentName ? "flag--ok" : "flag--warn"}`} title="Autorización del encargado">
                  <FileSignature /> {p.consent && p.consentName ? "Autorizado" : "Sin firma"}
                </span>
                {perr.length > 0 ? (
                  <span className="flag flag--err">
                    <AlertTriangle /> {perr.length}
                  </span>
                ) : (
                  <span className="flag flag--ok">
                    <CheckCircle2 />
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" type="button" aria-label="Subir" disabled={locked || index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp />
                </button>
                <button className="icon-btn" type="button" aria-label="Bajar" disabled={locked || index === players.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown />
                </button>
                <button className="icon-btn" type="button" aria-label="Eliminar jugador" disabled={locked} onClick={() => removePlayer(p)}>
                  <Trash2 />
                </button>
              </div>
              {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </div>
            {isOpen && (
              <div className="player__body">
                <div className="player__group">
                  <b>Jugador</b>
                  <div className="grid grid--4">
                    <TextField label="Número" required value={p.number} onChange={(v) => setP(p.key, { number: v.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" placeholder="00" error={pe("number")} disabled={locked} />
                    <TextField label="Nombre" required value={p.firstName} onChange={(v) => setP(p.key, { firstName: v })} error={pe("firstName")} disabled={locked} maxLength={60} autoComplete="off" />
                    <TextField className="span-2" label="Apellidos" required value={p.lastName} onChange={(v) => setP(p.key, { lastName: v })} disabled={locked} maxLength={80} autoComplete="off" />
                    <TextField
                      label="Fecha de nacimiento"
                      required
                      type="date"
                      value={p.birthdate}
                      onChange={(v) => setP(p.key, { birthdate: v })}
                      error={pe("birthdate")}
                      hint={p.birthdate ? elig.message : `Nacidos en ${birthYear} o después`}
                      disabled={locked}
                    />
                    <PhoneField label="Teléfono del jugador" value={p.phone} onChange={(v) => setP(p.key, { phone: v })} disabled={locked} />
                    <SelectField label="Pueblo de residencia" value={p.town} onChange={(v) => setP(p.key, { town: v })} options={MUNICIPALITIES} disabled={locked} />
                    <div />
                    <TextField className="span-2" label="Escuela" required value={p.school} onChange={(v) => setP(p.key, { school: v })} error={pe("school")} disabled={locked} maxLength={120} />
                    <SelectField label="Grado" required value={p.grade} onChange={(v) => setP(p.key, { grade: v })} options={SCHOOL_GRADES} error={pe("grade")} disabled={locked} />
                  </div>
                </div>
                <div className="player__group">
                  <b>Uniforme</b>
                  <div className="grid grid--4">
                    <SelectField label="Talla de camiseta" required value={p.shirtSize} onChange={(v) => setP(p.key, { shirtSize: v, pantsSize: p.pantsSize || v })} options={SIZE_OPTIONS} error={pe("shirtSize")} disabled={locked} />
                    <SelectField label="Talla de pantalón" required value={p.pantsSize} onChange={(v) => setP(p.key, { pantsSize: v })} options={SIZE_OPTIONS} error={pe("pantsSize")} disabled={locked} />
                  </div>
                </div>
                <div className="player__group">
                  <b>Padre, madre o encargado</b>
                  <div className="grid grid--4">
                    <TextField className="span-2" label="Nombre completo" required value={p.guardianName} onChange={(v) => setP(p.key, { guardianName: v })} error={pe("guardianName")} disabled={locked} maxLength={120} />
                    <SelectField label="Parentesco" value={p.guardianRelation} onChange={(v) => setP(p.key, { guardianRelation: v })} options={GUARDIAN_RELATIONS} disabled={locked} />
                    <PhoneField label="Teléfono" required value={p.guardianPhone} onChange={(v) => setP(p.key, { guardianPhone: v })} error={pe("guardianPhone")} disabled={locked} />
                    <EmailField className="span-2" label="Email" value={p.guardianEmail} onChange={(v) => setP(p.key, { guardianEmail: v })} error={pe("guardianEmail")} disabled={locked} />
                  </div>
                </div>
                <div className="player__group">
                  <b>Autorización</b>
                  <div className="consent-box">
                    <p style={{ marginTop: 0 }}>
                      Yo, <b>{p.guardianName || "padre, madre o encargado"}</b>, autorizo la participación de <b>{`${p.firstName} ${p.lastName}`.trim() || "el jugador"}</b> en el
                      Torneo ACB 2027 y certifico que la información es correcta. {RULES.consent}
                    </p>
                    <div className="grid grid--2">
                      <Check checked={p.consent} onChange={(v) => setP(p.key, { consent: v, consentName: v ? p.consentName || p.guardianName : p.consentName })} disabled={locked}>
                        El encargado autoriza (firma electrónica)
                      </Check>
                      <TextField label="Nombre del encargado como firma" value={p.consentName} onChange={(v) => setP(p.key, { consentName: v })} error={pe("consent")} disabled={locked || !p.consent} maxLength={120} hint={p.consentOn ? `Registrada ${new Date(p.consentOn).toLocaleString("es-PR")}` : "Escriba el nombre completo"} />
                    </div>
                  </div>
                </div>
                <div className="player__group">
                  <b>Documentos</b>
                  <div className="grid grid--2">
                    <FileUpload
                      owner="player"
                      recordId={p.id}
                      field="x_birth_cert"
                      label="Certificado de nacimiento (copia)"
                      hint="El original se entrega el 23 de enero"
                      fileName={p.birthCertName}
                      disabled={locked}
                      capture
                      ensureSaved={() => ensurePlayerSaved(p.key)}
                      onChange={(name) => setPlayers((list) => list.map((x) => (x.key === p.key ? { ...x, birthCertName: name } : x)))}
                    />
                    <FileUpload
                      owner="player"
                      recordId={p.id}
                      field="x_photo"
                      label="Foto para el carnet"
                      hint="Foto de frente, fondo claro"
                      accept="image/*"
                      fileName={p.photoName}
                      disabled={locked}
                      preview
                      capture
                      ensureSaved={() => ensurePlayerSaved(p.key)}
                      onChange={(name) => setPlayers((list) => list.map((x) => (x.key === p.key ? { ...x, photoName: name } : x)))}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {players.length > 0 && players.length < MAX_PLAYERS && (
        <button className="btn btn--ghost btn--block" style={{ marginTop: 12 }} type="button" onClick={addPlayer} disabled={locked}>
          <Plus /> Agregar jugador ({players.length}/{MAX_PLAYERS})
        </button>
      )}
    </section>
  );

  const grouped = TABS.map((t) => ({ tab: t, errors: validation.errors.filter((e) => t.sections.includes(e.section as never)) })).filter((g) => g.errors.length);

  const tabRevision = (
    <>
      <section className="form-section">
        <div className="form-section__head">
          <div className="form-section__icon">
            <ClipboardCheck />
          </div>
          <div>
            <div className="h3">Revisión</div>
            <p>
              {team.state === "approved"
                ? "Equipo aprobado por la ACB."
                : team.state === "submitted"
                  ? "Equipo enviado a la ACB."
                  : validation.errors.length
                    ? `Faltan ${validation.errors.length} dato(s) para poder enviar.`
                    : "¡Todo listo para enviar a la ACB!"}
            </p>
          </div>
        </div>
        {validation.errors.length === 0 ? (
          <Alert kind="ok" title="Información completa">
            {locked ? "Imprima los documentos y llévelos el 23 de enero con los certificados de nacimiento originales." : "Revise los avisos (si hay) y certifique para enviar."}
          </Alert>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {grouped.map((g) => (
              <div key={g.tab.id}>
                <div className="field__label" style={{ marginBottom: 6 }}>
                  {SECTION_LABEL[g.errors[0].section] || g.tab.label}
                </div>
                <ul className="issues">
                  {g.errors.map((e, i) => (
                    <li key={i} className="is-error">
                      <CircleAlert size={16} /> {e.message}
                      <button type="button" onClick={() => goToIssue(e)}>
                        Ir
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {validation.warnings.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="field__label" style={{ marginBottom: 6 }}>
              Avisos (no impiden el envío)
            </div>
            <ul className="issues">
              {validation.warnings.map((w, i) => (
                <li key={i}>
                  <AlertTriangle size={16} /> {w.message}
                  {w.section !== "club" && (
                    <button type="button" onClick={() => goToIssue(w)}>
                      Ir
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="form-section">
        <div className="form-section__head">
          <div className="form-section__icon">
            <Printer />
          </div>
          <div>
            <div className="h3">Documentos para imprimir</div>
            <p>Generados con la información del equipo. Llévelos el 23 de enero con los certificados de nacimiento originales.</p>
          </div>
        </div>
        <div className="docs-grid">
          <button type="button" className="doc-btn" onClick={() => print("uniformes")}>
            <Shirt />
            <div>
              <b>Hoja de uniformes</b>
              <span>Tallas, colores y resumen</span>
            </div>
          </button>
          <button type="button" className="doc-btn" onClick={() => print("lista")}>
            <FileText />
            <div>
              <b>Lista oficial de jugadores</b>
              <span>Con autorizaciones y póliza</span>
            </div>
          </button>
          <button type="button" className="doc-btn" onClick={() => print("carnet")}>
            <IdCard />
            <div>
              <b>Carnet de jugadores</b>
              <span>Con fotos y números</span>
            </div>
          </button>
          <button type="button" className="doc-btn" onClick={() => print("roster")}>
            <ClipboardCheck />
            <div>
              <b>Roster oficial de juego</b>
              <span>3 copias para ponchar</span>
            </div>
          </button>
        </div>
        <button type="button" className="btn btn--dark btn--block" style={{ marginTop: 12 }} onClick={() => print("todo")}>
          <Printer /> Imprimir todo
        </button>
      </section>

      {!locked && (
        <section className="form-section">
          <div className="form-section__head">
            <div className="form-section__icon">
              <Send />
            </div>
            <div>
              <div className="h3">Certificación y envío</div>
              <p>Regla 3 del Reglamento de ACB.</p>
            </div>
          </div>
          <div className="consent-box" style={{ marginBottom: 14 }}>
            {RULES.rule3}
          </div>
          <div className="grid grid--2">
            <Check checked={certify} onChange={setCertify}>
              Certifico la información de este equipo.
            </Check>
            <TextField label="Nombre de quien certifica" required value={certifyName} onChange={setCertifyName} hint="Dirigente o presidente del club" />
          </div>
          <button type="button" className="btn btn--primary btn--lg btn--block" style={{ marginTop: 16 }} disabled={submitting || validation.errors.length > 0} onClick={submit}>
            <Send /> {submitting ? "Enviando…" : "Enviar equipo a la ACB"}
          </button>
          {validation.errors.length > 0 && (
            <p className="small muted" style={{ textAlign: "center" }}>
              Complete los {validation.errors.length} dato(s) pendientes para habilitar el envío.
            </p>
          )}
        </section>
      )}

      {(team.state === "draft" || team.state === "changes") && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" className="btn btn--danger btn--sm" onClick={remove}>
            <Trash2 /> Eliminar equipo
          </button>
        </div>
      )}
    </>
  );

  const content: Record<TabId, ReactNode> = { equipo: tabEquipo, personal: tabPersonal, uniformes: tabUniformes, jugadores: tabJugadores, revision: tabRevision };
  const tabIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <>
      <main className="page">
        <div className="wrap">
          <div style={{ marginBottom: 12 }}>
            <Link to="/portal" className="small">
              ← Mis equipos
            </Link>
          </div>
          <div className="editor__head">
            <div className={`cat-badge ${team.program === "alternativo" ? "cat-badge--alt" : ""}`}>
              {team.category}
              <small>{team.gender === "F" ? "FEM" : "MASC"}</small>
            </div>
            <div className="editor__title">
              <h1>
                {team.category}U {team.gender} {team.division}
                {team.teamName ? ` · ${team.teamName}` : ""}
              </h1>
              <div className="small muted">
                {me.club.name} · {team.program === "alternativo" ? "ACB Alternativo" : "ACB Regular"}
              </div>
            </div>
            <StateBadge state={team.state} />
            {!locked && saveBadge}
            {!locked && (
              <button type="button" className="btn btn--blue btn--sm" disabled={!dirty || saveState === "saving"} onClick={() => void save().catch(() => undefined)}>
                Guardar
              </button>
            )}
          </div>

          {team.state === "submitted" && (
            <div className="state-banner state-banner--submitted">
              <Send />
              <div style={{ flex: 1 }}>
                <b>Enviado a la ACB</b>
                <span className="small">La ACB está revisando el equipo. Para editar, retire el envío.</span>
              </div>
              <button className="btn btn--ghost btn--sm" type="button" onClick={reopen}>
                <Undo2 /> Retirar envío
              </button>
            </div>
          )}
          {team.state === "approved" && (
            <div className="state-banner state-banner--approved">
              <CheckCircle2 />
              <div>
                <b>Aprobado por la ACB</b>
                <span className="small">Para cualquier cambio, comuníquese con la ACB.</span>
              </div>
            </div>
          )}
          {team.state === "changes" && (
            <div className="state-banner state-banner--changes">
              <AlertTriangle />
              <div>
                <b>La ACB solicita cambios</b>
                <span className="small">{team.adminFeedback || "Revise la información y envíe de nuevo."}</span>
              </div>
            </div>
          )}

          <div className="editor">
            <div>
              <div className="stepper" role="tablist">
                {TABS.map((t, i) => {
                  // The review tab is only "done" once nothing is pending anywhere.
                  const count = t.id === "revision" ? validation.errors.length : validation.errors.filter((e) => (t.sections as readonly string[]).includes(e.section)).length;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-current={t.id === tab ? "step" : undefined}
                      className={count === 0 ? "is-done" : showErrors ? "has-issues" : ""}
                      onClick={() => {
                        setTab(t.id);
                        if (t.id === "revision") setShowErrors(true);
                      }}
                    >
                      <span className="num">{count === 0 ? "✓" : i + 1}</span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
              {content[tab]}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, gap: 10 }}>
                <button type="button" className="btn btn--ghost" disabled={tabIndex === 0} onClick={() => setTab(TABS[Math.max(0, tabIndex - 1)].id)}>
                  Anterior
                </button>
                {tabIndex < TABS.length - 1 && (
                  <button
                    type="button"
                    className="btn btn--blue"
                    onClick={() => {
                      const nextTab = TABS[tabIndex + 1].id;
                      if (nextTab === "revision") setShowErrors(true);
                      setTab(nextTab);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Siguiente: {TABS[tabIndex + 1].label}
                  </button>
                )}
              </div>
            </div>

            <aside className="side">
              <div className="side-card">
                <h4>Progreso</h4>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, marginBottom: 6 }}>
                  <span>{team.state === "approved" ? "Aprobado" : team.state === "submitted" ? "Enviado" : percent === 100 ? "Listo para enviar" : "En progreso"}</span>
                  <span>{percent}%</span>
                </div>
                <Progress value={percent} />
                <ul className="checklist" style={{ marginTop: 14 }}>
                  {["equipo", "personal", "uniformes", "jugadores", "club"].map((s) => {
                    const n = issuesFor(s).length;
                    return (
                      <li key={s}>
                        {n === 0 ? <CheckCircle2 className="ok" /> : <CircleAlert className="bad" />}
                        <span>
                          {SECTION_LABEL[s]}
                          {n > 0 && <span className="muted"> · {n} pendiente(s)</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="side-card">
                <h4>Costos estimados</h4>
                <div className="costs">
                  <div>
                    <span>Inscripción {team.category} años</span>
                    <b>{money(costs.base)}</b>
                  </div>
                  <div>
                    <span>Uniformes adicionales ({costs.extraUniforms})</span>
                    <b>{money(costs.extraFee)}</b>
                  </div>
                  <div>
                    <span>Pantalón dirigentes ({costs.shortsCount})</span>
                    <b>{money(costs.shortsFee)}</b>
                  </div>
                  <div className="total">
                    <span>Total</span>
                    <span>{money(costs.total)}</span>
                  </div>
                  <div className="small muted">
                    {team.paymentPlan === "full" ? "Pago total en la inscripción." : `Depósito de ${money(DEPOSIT_PER_TEAM)} en la inscripción; balance el 23 de enero.`}
                  </div>
                </div>
              </div>
              <div className="side-card">
                <h4>Imprimir</h4>
                <button type="button" className="btn btn--ghost btn--block btn--sm" onClick={() => print("todo")}>
                  <Printer /> Todos los formularios
                </button>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
