import { useState } from "react";
import { AlertTriangle, ArrowRight, BadgeCheck, CircleAlert, CircleDot, Plus, ShieldCheck, UserRound, Users } from "lucide-react";
import { api } from "../api";
import { Footer } from "../components/Brand";
import { Alert, Modal, Progress, Seg, StateBadge, TextField, toast } from "../components/ui";
import { usePortal } from "../portal";
import { Link, navigate } from "../router";
import {
  CATEGORIES,
  DEPOSIT_PER_TEAM,
  KEY_DATES,
  categoryBirthYear,
  feeForCategory,
  formatDateLong,
  money,
} from "../../shared/tournament.js";
import type { TeamSummary } from "../types";

function daysUntil(iso: string) {
  const target = new Date(`${iso}T12:00:00-04:00`).getTime();
  return Math.ceil((target - Date.now()) / 86400_000);
}

export function NewTeamModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<number | null>(null);
  const [division, setDivision] = useState("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!category) return toast("Seleccione la categoría", "error");
    setBusy(true);
    try {
      // Programa (Regular/Alternativo) and rama are set by the ACB, not by the club.
      const { id } = await api.post<{ id: number }>("/api/teams", { category, division, teamName });
      navigate(`/portal/equipo/${id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nuevo equipo"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" disabled={busy || !category} onClick={create}>
            {busy ? "Creando…" : "Crear equipo"} <ArrowRight />
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 18 }}>
        <div>
          <div className="field__label" style={{ marginBottom: 8 }}>
            Categoría (edad)
          </div>
          <Seg className="seg--cats" value={category} options={CATEGORIES.map((c) => ({ value: c, label: `${c}U` }))} onChange={setCategory} />
        </div>
        <div className="grid grid--2">
          <TextField label="Letra / sección" value={division} onChange={(v) => setDivision(v.toUpperCase().slice(0, 10))} placeholder="A, B…" hint="Si el club tiene más de un equipo en la categoría" />
          <TextField label="Nombre del equipo" value={teamName} onChange={setTeamName} placeholder="Opcional" maxLength={80} />
        </div>
        {category && (
          <Alert kind="info" title={`${category} años · nacidos en ${categoryBirthYear(category)} o después`}>
            Inscripción: <b>{money(feeForCategory(category))}</b> (incluye un balón). Depósito para separar: {money(DEPOSIT_PER_TEAM)}.
          </Alert>
        )}
      </div>
    </Modal>
  );
}

function TeamCard({ team }: { team: TeamSummary }) {
  return (
    <Link to={`/portal/equipo/${team.id}`} className="team-card">
      <div className="team-card__top">
        <div className={`cat-badge ${team.program === "alternativo" ? "cat-badge--alt" : ""}`}>
          {team.category}
          <small>{team.gender === "F" ? "FEM" : "MASC"}</small>
        </div>
        <div style={{ minWidth: 0 }}>
          <h3>
            {team.category}U {team.gender} {team.division}
            {team.teamName ? ` · ${team.teamName}` : ""}
          </h3>
          <div className="small muted">{team.program === "alternativo" ? "ACB Alternativo" : "ACB Regular"}</div>
        </div>
      </div>
      <div className="team-card__meta">
        <span>
          <UserRound /> {team.coachName || "Sin dirigente"}
        </span>
        <span>
          <Users /> {team.playerCount}/13 jugadores
        </span>
        <span>{money(team.total)}</span>
      </div>
      {team.state === "changes" && team.adminFeedback && (
        <div className="alert alert--warn" style={{ padding: "10px 12px" }}>
          <AlertTriangle />
          <span className="small">{team.adminFeedback}</span>
        </div>
      )}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
          <span className="muted">Progreso</span>
          <span>{team.state === "draft" || team.state === "changes" ? `${team.completion || 0}%` : "100%"}</span>
        </div>
        <Progress value={team.state === "draft" || team.state === "changes" ? team.completion : 100} />
      </div>
      <div className="team-card__foot">
        <StateBadge state={team.state} />
        <span className="small" style={{ fontWeight: 700, color: "#1d4ed8" }}>
          {team.state === "draft" || team.state === "changes" ? "Completar →" : "Ver →"}
        </span>
      </div>
    </Link>
  );
}

export function Dashboard() {
  const { me } = usePortal();
  const [adding, setAdding] = useState(false);
  const { club, teams, clubValidation } = me;
  const today = new Date().toISOString().slice(0, 10);
  const next = KEY_DATES.find((d) => (d.end || d.date) >= today);
  const total = teams.reduce((sum, t) => sum + (t.total || 0), 0);
  const paid = teams.reduce((sum, t) => sum + (t.amountPaid || 0), 0);
  const players = teams.reduce((sum, t) => sum + (t.playerCount || 0), 0);
  const sent = teams.filter((t) => t.state === "submitted" || t.state === "approved").length;
  const missing = clubValidation.errors;
  const recommended = clubValidation.warnings;

  return (
    <>
      <main className="page">
        <div className="wrap">
          <div className="welcome">
            <div className="welcome__logo">
              <img src={club.logoName ? `/api/files/club/${club.id}/x_logo` : "/acb-logo-256.png"} alt="" />
            </div>
            <div>
              <p className="eyebrow" style={{ color: "#ffb27a" }}>
                Portal del club · Torneo #30
              </p>
              <h1>{club.name}</h1>
              <p>
                {club.municipality} · {club.email}
              </p>
              <span className={`welcome__review${club.review === "verified" ? " is-verified" : ""}`}>
                {club.review === "verified" ? <BadgeCheck /> : <ShieldCheck />}
                {club.review === "verified" ? "Club verificado por la ACB" : "En revisión de la ACB · puede seguir trabajando"}
              </span>
            </div>
            {next && (
              <div className="countdown">
                <b>{Math.max(0, daysUntil(next.date))}</b>
                <span>
                  días para
                  <br />
                  {next.title}
                </span>
              </div>
            )}
          </div>

          <div className="stats">
            <div className="stat stat--accent">
              <b>{teams.length}</b>
              <span>Equipos</span>
            </div>
            <div className="stat">
              <b>{players}</b>
              <span>Jugadores inscritos</span>
            </div>
            <div className="stat">
              <b>
                {sent}/{teams.length}
              </b>
              <span>Equipos enviados</span>
            </div>
            <div className="stat">
              <b>{money(total)}</b>
              <span>
                Total estimado · depósitos {money(teams.length * DEPOSIT_PER_TEAM)}
                {paid ? ` · pagado ${money(paid)}` : ""}
              </span>
            </div>
          </div>

          {(missing.length > 0 || recommended.length > 0) && (
            <div className={`club-card${missing.length ? " club-card--warn" : ""}`}>
              <div>
                <div className="h3">
                  {missing.length + recommended.length === 1
                    ? "Falta 1 dato en el perfil del club"
                    : `Faltan ${missing.length + recommended.length} datos en el perfil del club`}
                </div>
                <ul className="club-card__list">
                  {missing.map((i) => (
                    <li key={i.field}>
                      <CircleAlert /> {i.message}
                    </li>
                  ))}
                  {recommended.map((i) => (
                    <li key={i.field} className="is-optional">
                      <CircleDot /> {i.message}
                    </li>
                  ))}
                </ul>
              </div>
              <Link to="/portal/club" className={`btn ${missing.length ? "btn--primary" : "btn--blue"}`}>
                Completar perfil
              </Link>
            </div>
          )}

          <div className="page-head">
            <div>
              <p className="eyebrow">Equipos del club</p>
              <h2 className="display" style={{ fontSize: "clamp(28px, 3.6vw, 44px)" }}>
                Mis <em>equipos</em>
              </h2>
            </div>
            <button className="btn btn--primary" onClick={() => setAdding(true)}>
              <Plus /> Agregar equipo
            </button>
          </div>

          <div className="teams">
            {teams.map((t) => (
              <TeamCard key={t.id} team={t} />
            ))}
            <button type="button" className="team-card team-card--add" onClick={() => setAdding(true)}>
              <Plus />
              Agregar equipo
              <span className="small muted" style={{ textTransform: "none", letterSpacing: 0, fontFamily: "var(--acb-font-body)", fontWeight: 500 }}>
                Categorías de 6 a 19 años
              </span>
            </button>
          </div>

          <div className="split" style={{ marginTop: 34 }}>
            <div className="panel">
              <div className="h3">Próximas fechas</div>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {KEY_DATES.filter((d) => (d.end || d.date) >= today)
                  .slice(0, 4)
                  .map((d) => (
                    <div key={d.id} style={{ display: "flex", gap: 12 }}>
                      <span className="badge badge--submitted" style={{ alignSelf: "flex-start", textTransform: "capitalize" }}>
                        {formatDateLong(d.date).split(" de 20")[0]}
                      </span>
                      <div className="small">
                        <b>{d.title}</b>
                        <div className="muted">{d.where}</div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <div className="panel">
              <div className="h3">Después de enviar</div>
              <ul className="reqs" style={{ fontSize: 15 }}>
                <li>Imprima desde cada equipo la Hoja de Uniformes, la Lista Oficial, el Carnet y el Roster (3 copias).</li>
                <li>Lleve los certificados de nacimiento ORIGINALES y las copias de las tarjetas federativas.</li>
                <li>Entrega y pago final: sábado 23 de enero de 2027, 1:00 – 4:00 PM, Colegio Universitario de San Juan.</li>
                <li>La ACB le dejará comentarios en el portal si un equipo requiere cambios.</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
      {adding && <NewTeamModal onClose={() => setAdding(false)} />}
      <Footer />
    </>
  );
}
