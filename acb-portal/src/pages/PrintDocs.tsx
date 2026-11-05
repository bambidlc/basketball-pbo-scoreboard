import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import { api } from "../api";
import { colorName } from "../components/Jersey";
import { CenterLoad, Seg } from "../components/ui";
import { navigate, useLocation } from "../router";
import { ADULT_SIZES, KID_SIZES, MAX_PLAYERS, RULES, ageOn } from "../../shared/tournament.js";
import type { Club, MePayload, Player, Team, TeamPayload } from "../types";

const DOCS = [
  { value: "todo", label: "Todo" },
  { value: "uniformes", label: "Uniformes" },
  { value: "lista", label: "Lista oficial" },
  { value: "carnet", label: "Carnet" },
  { value: "roster", label: "Roster (3)" },
];

function fmtDate(iso?: string) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

function Head({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="sheet__head">
      <img src="/acb-logo-256.png" alt="ACB" />
      <div>
        <h2>Asociación de Clubes de Baloncesto de Puerto Rico, Inc. (ACB)</h2>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div />
    </div>
  );
}

const blankRows = (players: Player[], total = MAX_PLAYERS) => [...players, ...Array.from({ length: Math.max(0, total - players.length) }, () => null)];

function Uniformes({ team, players, club }: { team: Team; players: Player[]; club: Club }) {
  const count = (key: "shirtSize" | "pantsSize", value: string) => players.filter((p) => p[key] === value).length || "";
  return (
    <div className="sheet">
      <Head title="Formulario para uniformes 2027" />
      <div className="line">
        <span>
          Nombre del Club: <b>{club.name}</b>
        </span>
        <span>
          Categoría: <b>{team.category} años</b>
        </span>
        <span>
          <b>{team.gender === "F" ? "F" : "M"}</b> ({team.gender === "F" ? "Femenino" : "Masculino"})
        </span>
        <span>
          Programa: <b>{team.program === "alternativo" ? "ACB Alternativo" : "ACB Regular"}</b>
        </span>
      </div>
      <div className="line">
        <span>
          Color de camiseta: <b>{colorName(team.shirtColor)}</b>
        </span>
        <span>
          Color letras y números: <b>{colorName(team.numberColor)}</b>
        </span>
        <span>
          Color de pantalón: <b>{colorName(team.pantsColor)}</b>
        </span>
      </div>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}>Num</th>
            <th>Nombre del jugador</th>
            <th style={{ width: 110 }}>Camiseta</th>
            <th style={{ width: 110 }}>Pantalón</th>
          </tr>
        </thead>
        <tbody>
          {blankRows(players).map((p, i) => (
            <tr key={i} style={{ height: 24 }}>
              <td style={{ textAlign: "center", fontWeight: 700 }}>{p?.number}</td>
              <td>{p ? `${p.firstName} ${p.lastName}`.toUpperCase() : ""}</td>
              <td style={{ textAlign: "center" }}>{p?.shirtSize}</td>
              <td style={{ textAlign: "center" }}>{p?.pantsSize}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Resumen · Tamaño niños</th>
              <th>Camisa</th>
              <th>Pantalón</th>
            </tr>
          </thead>
          <tbody>
            {KID_SIZES.map((s) => (
              <tr key={s.value}>
                <td>{s.label}</td>
                <td style={{ textAlign: "center" }}>{count("shirtSize", s.value)}</td>
                <td style={{ textAlign: "center" }}>{count("pantsSize", s.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>Tamaño adulto</th>
              <th>Camisa</th>
              <th>Pantalón</th>
            </tr>
          </thead>
          <tbody>
            {ADULT_SIZES.map((s) => (
              <tr key={s.value}>
                <td>{s.label}</td>
                <td style={{ textAlign: "center" }}>{count("shirtSize", s.value)}</td>
                <td style={{ textAlign: "center" }}>{count("pantsSize", s.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <table style={{ marginTop: 12 }}>
        <tbody>
          <tr>
            <th style={{ width: "40%" }}>Pantalón corto dirigentes $25.00</th>
            <th>Tamaño de cintura</th>
          </tr>
          <tr>
            <td>Dirigente: {team.coachShorts ? team.coachName : "—"}</td>
            <td>{team.coachShorts ? `${team.coachWaist}"` : ""}</td>
          </tr>
          <tr>
            <td>Asistente: {team.asstShorts ? team.asstName : "—"}</td>
            <td>{team.asstShorts ? `${team.asstWaist}"` : ""}</td>
          </tr>
        </tbody>
      </table>
      <div className="line" style={{ marginTop: 14 }}>
        <span>
          Apoderado(a): <b>{team.managerName}</b>
        </span>
        <span>
          Teléfono: <b>{team.managerPhone}</b>
        </span>
      </div>
      <div className="line">
        <span>
          Dirigente: <b>{team.coachName}</b>
        </span>
        <span>
          Teléfono: <b>{team.coachPhone}</b>
        </span>
      </div>
      <div className="line">
        <span>
          Fecha: <b>{new Date().toLocaleDateString("es-PR")}</b>
        </span>
        <span>
          Uniformes: <b>{players.length}</b> (ACB provee 12; adicionales a $30: <b>{Math.max(0, players.length - 12)}</b>)
        </span>
      </div>
      <p className="fine">{RULES.uniforms}</p>
    </div>
  );
}

function Lista({ team, players, club }: { team: Team; players: Player[]; club: Club }) {
  return (
    <div className="sheet sheet--landscape">
      <Head title="Torneo ACB 2027 · Lista oficial de jugadores" subtitle="Solo se pueden inscribir 13 jugadores" />
      <div className="line">
        <span>
          Organización o Equipo: <b>{club.name}{team.teamName ? ` · ${team.teamName}` : ""}</b>
        </span>
        <span>
          Edad: <b>{team.category} años {team.gender === "F" ? "(F)" : "(M)"} {team.division}</b>
        </span>
        <span>
          Programa: <b>{team.program === "alternativo" ? "ACB Alternativo" : "ACB Regular"}</b>
        </span>
      </div>
      <table style={{ marginTop: 6 }}>
        <thead>
          <tr>
            <th style={{ width: 34 }}>Núm.</th>
            <th>Nombre completo</th>
            <th style={{ width: 70 }}>Fecha nac.</th>
            <th style={{ width: 34 }}>Edad</th>
            <th style={{ width: 92 }}>Teléfono</th>
            <th>Escuela</th>
            <th style={{ width: 46 }}>Grado</th>
            <th style={{ width: 210 }}>Firma padre, madre o encargado</th>
          </tr>
        </thead>
        <tbody>
          {blankRows(players).map((p, i) => (
            <tr key={i} style={{ height: 27 }}>
              <td style={{ textAlign: "center", fontWeight: 700 }}>{p?.number}</td>
              <td>{p ? `${p.firstName} ${p.lastName}` : ""}</td>
              <td>{fmtDate(p?.birthdate)}</td>
              <td style={{ textAlign: "center" }}>{p?.birthdate ? ageOn(p.birthdate) : ""}</td>
              <td>{p?.phone || p?.guardianPhone}</td>
              <td>{p?.school}</td>
              <td>{p?.grade}</td>
              <td className="fine">{p?.consent ? `Autorizado electrónicamente: ${p.consentName}${p.consentOn ? ` · ${fmtDate(p.consentOn)}` : ""}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <th style={{ width: 90 }}></th>
            <th>Nombre</th>
            <th>Teléfonos</th>
            <th># Cert.</th>
            <th># Lic. DRD</th>
          </tr>
          <tr>
            <th>Dirigente</th>
            <td>{team.coachName}</td>
            <td>{team.coachPhone}</td>
            <td>{team.coachCert}</td>
            <td>{team.coachLic}</td>
          </tr>
          <tr>
            <th>Asistente</th>
            <td>{team.asstName}</td>
            <td>{team.asstPhone}</td>
            <td>{team.asstCert}</td>
            <td>{team.asstLic}</td>
          </tr>
          <tr>
            <th>Apoderado</th>
            <td>{team.managerName}</td>
            <td>{team.managerPhone}</td>
            <td colSpan={2}></td>
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 10, fontFamily: "Arial, sans-serif", fontWeight: 700, fontSize: 11 }}>AUTORIZACIÓN DE LA LIGA</div>
      <div className="line">
        <span>
          Club de Baloncesto: <b>{club.name}</b>
        </span>
        <span>
          Teléfonos: <b>{club.phone}</b>
        </span>
      </div>
      <div className="line">
        <span>
          Nombre y firma del presidente del club: <b>{club.presidentName}</b> ________________________
        </span>
      </div>
      <div className="line">
        <span>
          Póliza de seguro de accidentes del club: <b>{club.insuranceNumber}</b> (número) · <b>{club.insuranceCompany}</b> (compañía)
        </span>
      </div>
      <p className="fine" style={{ margin: "6px 0 0" }}>
        * {RULES.consent} Las autorizaciones electrónicas fueron registradas en el Portal de Inscripción ACB.
        <br />* Esta hoja debe ser llenada en su totalidad y acompañada por los Certificados de Nacimiento ORIGINALES. No recibiremos documentos incompletos.
      </p>
    </div>
  );
}

function Carnet({ team, players, club }: { team: Team; players: Player[]; club: Club }) {
  return (
    <div className="sheet">
      <Head title="Carnet de jugadores 2027" subtitle="Solo se pueden inscribir 13 jugadores" />
      <div className="line">
        <span>
          Equipo: <b>{club.name}{team.teamName ? ` · ${team.teamName}` : ""}</b>
        </span>
        <span>
          Edad: <b>{team.category} años {team.gender} {team.division}</b>
        </span>
      </div>
      <div className="carnets" style={{ marginTop: 8 }}>
        {blankRows(players).map((p, i) => (
          <div className="carnet" key={i}>
            <div className="carnet__photo">{p?.photoName && p.id ? <img src={`/api/files/player/${p.id}/x_photo`} alt="" /> : "FOTO"}</div>
            <div>
              <small>Nombre</small>
              <b>{p ? `${p.firstName} ${p.lastName}` : ""}</b>
              <small style={{ marginTop: 4 }}>#</small>
              <span className="num">{p?.number}</span>
              {p?.birthdate && <small>Nac. {fmtDate(p.birthdate)}</small>}
            </div>
          </div>
        ))}
        {(
          [
            ["Dirigente", team.coachName, team.coachLic],
            ["Asistente", team.asstName, team.asstLic],
            ["Anotador", team.scorerName, team.scorerLic],
          ] as const
        ).map(([role, name, lic]) => (
          <div className="carnet" key={role} style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <small>Copia tarjeta Federación / Lic. DRD</small>
              <b>{role}</b>
              <small>{name}</small>
              <small>Lic. DRD: {lic}</small>
            </div>
          </div>
        ))}
      </div>
      <p className="fine">Es obligatorio poner la copia de las tarjetas federativas de los dirigentes, asistente y anotador.</p>
    </div>
  );
}

function Roster({ team, players, club, copy }: { team: Team; players: Player[]; club: Club; copy: number }) {
  return (
    <div className="sheet">
      <div className="stamp">Sello ACB al relieve</div>
      <Head title="Torneo ACB 2027 · Roster oficial de juego" subtitle={`Copia ${copy} de 3 · debe llevar 3 copias para ser ponchadas`} />
      <div className="line">
        <span>
          Equipo: <b>{club.name}{team.teamName ? ` · ${team.teamName}` : ""}</b>
        </span>
        <span>
          Categoría (edad): <b>{team.category} años {team.gender} {team.division}</b>
        </span>
      </div>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Nombre del jugador (en letra de molde)</th>
            <th style={{ width: 90 }}>Número</th>
          </tr>
        </thead>
        <tbody>
          {blankRows(players).map((p, i) => (
            <tr key={i} style={{ height: 30 }}>
              <td style={{ fontSize: 13 }}>{p ? `${p.firstName} ${p.lastName}`.toUpperCase() : ""}</td>
              <td style={{ textAlign: "center", fontSize: 15, fontWeight: 700 }}>{p?.number}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 10.5, marginTop: 10 }}>{RULES.rule3}</p>
      <table>
        <tbody>
          <tr>
            <th style={{ width: 90 }}></th>
            <th>Nombre</th>
            <th># Lic. DRD</th>
            <th>Cert. FBPR</th>
          </tr>
          {(
            [
              ["Dirigente", team.coachName, team.coachLic, team.coachCert],
              ["Asistente", team.asstName, team.asstLic, team.asstCert],
              ["Anotador", team.scorerName, team.scorerLic, team.scorerCert],
            ] as const
          ).map(([role, name, lic, cert]) => (
            <tr key={role} style={{ height: 26 }}>
              <th>{role}</th>
              <td>{name}</td>
              <td>{lic}</td>
              <td>{cert}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {team.certifyName && (
        <p className="fine" style={{ marginTop: 8 }}>
          Certificado electrónicamente por {team.certifyName}
          {team.certifyOn ? ` el ${new Date(team.certifyOn).toLocaleString("es-PR")}` : ""}.
        </p>
      )}
      <p className="fine" style={{ position: "absolute", bottom: "0.4in", left: "0.55in", right: "0.55in", textAlign: "center" }}>
        ASOCIACIÓN DE CLUBES DE BALONCESTO DE PUERTO RICO · Sello ACB al relieve
      </p>
    </div>
  );
}

export function PrintDocs({ id }: { id: number }) {
  const { search } = useLocation();
  const doc = new URLSearchParams(search).get("doc") || "todo";
  const [data, setData] = useState<{ team: TeamPayload; me: MePayload } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.get<TeamPayload>(`/api/teams/${id}`), api.get<MePayload>("/api/me")])
      .then(([team, me]) => setData({ team, me }))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    document.title = `Formularios ${data?.team.team.name || ""} · ACB 2027`;
  }, [data]);

  if (error) return <div className="center-load">{error}</div>;
  if (!data) return <CenterLoad />;
  const { team, players } = data.team;
  const club = data.me.club;
  const show = (d: string) => doc === "todo" || doc === d;

  return (
    <>
      <div className="print-toolbar no-print">
        <b style={{ marginRight: 8 }}>{team.name}</b>
        <Seg value={doc} options={DOCS} onChange={(v) => navigate(`/portal/equipo/${id}/imprimir?doc=${v}`, { replace: true })} />
        <span style={{ flex: 1 }} />
        <button className="btn btn--primary btn--sm" onClick={() => window.print()}>
          <Printer /> Imprimir
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => (window.opener ? window.close() : navigate(`/portal/equipo/${id}`))}>
          <X /> Cerrar
        </button>
      </div>
      <div className="sheets">
        {show("uniformes") && <Uniformes team={team} players={players} club={club} />}
        {show("lista") && <Lista team={team} players={players} club={club} />}
        {show("carnet") && <Carnet team={team} players={players} club={club} />}
        {show("roster") && [1, 2, 3].map((copy) => <Roster key={copy} team={team} players={players} club={club} copy={copy} />)}
      </div>
    </>
  );
}
