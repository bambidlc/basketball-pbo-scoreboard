// Torneo ACB 2027 (#30) — single source of truth shared by the portal UI and
// the server-side validation. Everything here comes from the official 2027
// documents: "Información Inscripción ACB 2027", "Hoja de Uniformes 2027",
// "Carnet y Lista de Jugadores", "Roster de Juego 2027" and
// "Disponibilidad de Cancha y Dirigentes con 2 Equipos 2027".

export const SEASON = 2027;
export const TOURNAMENT_NUMBER = 30;
export const ORG_NAME = "Asociación de Clubes de Baloncesto de Puerto Rico";
export const ORG_SHORT = "ACB";

export const MAX_PLAYERS = 13;
export const MIN_PLAYERS = 5;
export const UNIFORMS_INCLUDED = 12;
export const EXTRA_UNIFORM_FEE = 30;
export const COACH_SHORTS_FEE = 25;
export const DEPOSIT_PER_TEAM = 400;

export const PROGRAMS = [
  { value: "regular", label: "ACB Regular" },
  { value: "alternativo", label: "ACB Alternativo" },
];

export const GENDERS = [
  { value: "M", label: "Masculino" },
  { value: "F", label: "Femenino" },
];

export const CATEGORIES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

/** Birth year that defines each category (e.g. 6 años → nacidos en 2021). */
export function categoryBirthYear(category) {
  return SEASON - Number(category);
}

/** Registration fee per team (includes one ball, minimum 8 games). */
export const FEE_BRACKETS = [
  { from: 6, to: 10, fee: 1099 },
  { from: 11, to: 12, fee: 1199 },
  { from: 13, to: 14, fee: 1275 },
  { from: 15, to: 16, fee: 1299 },
  { from: 17, to: 19, fee: 1500 },
];

export function feeForCategory(category) {
  const c = Number(category);
  const bracket = FEE_BRACKETS.find((b) => c >= b.from && c <= b.to);
  return bracket ? bracket.fee : 0;
}

export const KID_SIZES = [
  { value: "XS (2-4)", label: "XS · 2-4" },
  { value: "S (6-8)", label: "S · 6-8" },
  { value: "M (10-12)", label: "M · 10-12" },
  { value: "L (14-16)", label: "L · 14-16" },
  { value: "XL (18-20)", label: "XL · 18-20" },
];
export const ADULT_SIZES = [
  { value: "Adulto S", label: "S" },
  { value: "Adulto M", label: "M" },
  { value: "Adulto L", label: "L" },
  { value: "Adulto XL", label: "XL" },
  { value: "Adulto XXL", label: "XXL" },
];
export const ALL_SIZES = [...KID_SIZES, ...ADULT_SIZES].map((s) => s.value);

export const SCHOOL_GRADES = [
  "Pre-K", "Kínder", "1ro", "2do", "3ro", "4to", "5to", "6to", "7mo", "8vo", "9no",
  "10mo", "11mo", "12mo", "Universidad", "No estudia",
];

export const GUARDIAN_RELATIONS = ["Madre", "Padre", "Encargado(a)", "Abuelo(a)", "Tutor(a) legal", "Otro"];

export const SCHEDULE_PREFS = [
  { value: "none", label: "Sin acomodo" },
  { value: "am", label: "AM (hasta el mediodía)" },
  { value: "pm", label: "PM (después del mediodía)" },
];

export const UNIFORM_COLORS = [
  { name: "Blanco", hex: "#FFFFFF" },
  { name: "Negro", hex: "#111111" },
  { name: "Gris", hex: "#8A8F98" },
  { name: "Plata", hex: "#C7CCD4" },
  { name: "Azul Marino", hex: "#14213D" },
  { name: "Azul Royal", hex: "#1D4ED8" },
  { name: "Azul Celeste", hex: "#60A5FA" },
  { name: "Turquesa", hex: "#14B8A6" },
  { name: "Verde Kelly", hex: "#16A34A" },
  { name: "Verde Oscuro", hex: "#14532D" },
  { name: "Verde Lima", hex: "#84CC16" },
  { name: "Amarillo", hex: "#FACC15" },
  { name: "Dorado", hex: "#C9A227" },
  { name: "Anaranjado", hex: "#F26A1B" },
  { name: "Rojo", hex: "#DC2626" },
  { name: "Vino", hex: "#7F1D1D" },
  { name: "Rosado", hex: "#EC4899" },
  { name: "Morado", hex: "#7C3AED" },
  { name: "Marrón", hex: "#78350F" },
];

export const KEY_DATES = [
  {
    id: "inscripcion",
    date: "2026-12-12",
    end: "2026-12-19",
    title: "Inscripción de equipos",
    when: "Sábados 12 y 19 de diciembre de 2026 · 10:00 AM – 3:00 PM",
    where: "Club de Baloncesto Fraigcomar",
    detail: "Hoja de uniformes completada y pago total o depósito de $400 por equipo.",
  },
  {
    id: "acomodos",
    date: "2026-12-30",
    title: "Fecha límite: canchas y acomodos",
    when: "Miércoles 30 de diciembre de 2026",
    where: "Portal de Inscripción ACB",
    detail: "Fechas disponibles de su cancha para los carnavales y dirigentes con 2 equipos (acomodo AM o PM).",
  },
  {
    id: "entrega",
    date: "2027-01-23",
    title: "Entrega de uniformes y documentos · pago final",
    when: "Sábado 23 de enero de 2027 · 1:00 – 4:00 PM",
    where: "Colegio Universitario de San Juan · Ave. José Oliver #180, San Juan",
    detail: "Categorías 6 – 16 años. Traer certificados de nacimiento ORIGINALES y copias de tarjetas federativas.",
  },
  {
    id: "congresillo",
    date: "2027-01-30",
    title: "Congresillo técnico virtual",
    when: "Sábado 30 de enero de 2027 · 7:00 – 8:00 PM",
    where: "Microsoft Teams",
    detail: "Reunión obligatoria de dirigentes y apoderados.",
  },
  {
    id: "inicio",
    date: "2027-02-06",
    title: "¡Inicio del Torneo #30!",
    when: "Sábado 6 de febrero de 2027",
    where: "Canchas sede de los clubes",
    detail: "Se garantizan 8 juegos como mínimo por equipo.",
  },
  {
    id: "uniformes1719",
    date: "2027-04-24",
    title: "Entrega de uniformes 17 – 19 años",
    when: "Sábado 24 de abril de 2027",
    where: "Por anunciar",
    detail: "Categorías 17, 18 y 19 años.",
  },
];

/** Season calendar, grouped the way the official document groups it. */
export const CALENDAR = [
  {
    group: "Categorías 6 a 13 años (ACB Regular) y ACB Alternativo",
    phases: [
      { phase: "Serie regular", dates: ["2027-02-06", "2027-02-07", "2027-02-13", "2027-02-14", "2027-02-15", "2027-02-20", "2027-02-21", "2027-02-27", "2027-02-28", "2027-03-06", "2027-03-07"], note: "Lunes 15 de febrero es feriado" },
      { phase: "Series postemporada", dates: ["2027-03-13", "2027-03-14", "2027-03-20"] },
      { phase: "Final Four (6 a 13 ACB Regular)", dates: ["2027-03-21"] },
      { phase: "Finales (6 a 13 ACB Regular)", dates: ["2027-04-02", "2027-04-03", "2027-04-04"] },
      { phase: "Finales ACB Alternativo", dates: ["2027-04-10", "2027-04-11"] },
    ],
  },
  {
    group: "Categorías 14, 15 y 16 años (ACB Regular)",
    phases: [
      { phase: "Serie regular", dates: ["2027-02-07", "2027-02-14", "2027-02-21", "2027-02-28", "2027-03-06", "2027-03-07", "2027-03-13", "2027-03-14", "2027-03-20", "2027-03-21"] },
      { phase: "Series postemporada", dates: ["2027-04-03", "2027-04-04", "2027-04-10"] },
      { phase: "Finales", dates: ["2027-04-11"] },
    ],
  },
  {
    group: "Categorías 17 a 19 años",
    phases: [
      { phase: "Entrega de uniformes", dates: ["2027-04-24"] },
      { phase: "Serie regular", dates: ["2027-05-01", "2027-05-02", "2027-05-08", "2027-05-15", "2027-05-16", "2027-05-22", "2027-05-23", "2027-05-24", "2027-05-29", "2027-05-30"], note: "Lunes 24 de mayo es feriado" },
      { phase: "Postemporada", dates: ["2027-06-05", "2027-06-06", "2027-06-12"] },
      { phase: "Finales", dates: ["2027-06-13"] },
    ],
  },
];

/** Every regular-season game day, used for the court availability picker. */
export const COURT_DAYS = Array.from(
  new Set(
    CALENDAR.flatMap((g) => g.phases.filter((p) => p.phase === "Serie regular").flatMap((p) => p.dates)),
  ),
).sort();

export const COURT_SLOTS = [
  { value: "am", label: "AM" },
  { value: "pm", label: "PM" },
  { value: "day", label: "Todo el día" },
];

export const RULES = {
  coachMaxTeams: 2,
  coachSameCategory: false,
  roster: "Solo se pueden inscribir 13 jugadores por equipo. ACB provee 12 uniformes; el uniforme #13 cuesta $30 y debe incluirse en el formulario inicial.",
  uniforms: "No se recibirán peticiones de uniformes que no estén incluidos en el formulario de uniformes sometido inicialmente.",
  documents: "La lista debe acompañarse con los certificados de nacimiento ORIGINALES y copia de las tarjetas federativas (Lic. DRD) del dirigente, asistente y anotador. No se recibirán documentos incompletos.",
  consent: "La firma del padre, madre o encargado autoriza a la ACB a dar su información a nuestros auspiciadores.",
  rule3: "Certifico que conozco las disposiciones de la Regla 3 del Reglamento de ACB y que todos los jugadores incluidos son los mismos que sometí en la documentación a base de la cual se conformará la Lista de Jugadores y el Carnet oficial del equipo, y que jugadores nuevos son inelegibles y ocasionarán la confiscación de los partidos y otras sanciones.",
  schedule: "Un dirigente no puede dirigir dos equipos en una misma categoría y solo puede dirigir un máximo de 2 equipos. El acomodo de horario será AM (hasta el mediodía) o PM (después del mediodía); no se aceptan solicitudes para horas específicas. No se aceptarán nuevos acomodos luego de iniciado el torneo.",
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function parseIso(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDateLong(iso) {
  const d = parseIso(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

export function formatDateShort(iso) {
  const d = parseIso(iso);
  return `${DAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

export function monthName(index) {
  return MONTHS[index];
}

/** Age the player turns during the season year (how ACB assigns categories). */
export function seasonAge(birthdate) {
  if (!birthdate) return null;
  const year = Number(String(birthdate).slice(0, 4));
  return Number.isFinite(year) ? SEASON - year : null;
}

/** Exact age today, for the printed list ("Edad"). */
export function ageOn(birthdate, today = new Date()) {
  if (!birthdate) return null;
  const b = parseIso(birthdate);
  let age = today.getUTCFullYear() - b.getUTCFullYear();
  const m = today.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

/**
 * Eligibility of a birth date for a category. Players may play up (born
 * later than the category year) but never down (born earlier).
 */
export function eligibility(birthdate, category) {
  if (!birthdate) return { ok: false, level: "missing", message: "Falta la fecha de nacimiento" };
  const year = Number(String(birthdate).slice(0, 4));
  const limit = categoryBirthYear(category);
  if (!Number.isFinite(year)) return { ok: false, level: "missing", message: "Fecha inválida" };
  if (year < limit) {
    return { ok: false, level: "error", message: `No elegible: la categoría ${category} años es para nacidos en ${limit} o después` };
  }
  if (year > limit) {
    return { ok: true, level: "info", message: `Juega en categoría superior (nacido en ${year})` };
  }
  return { ok: true, level: "ok", message: `Elegible · nacido en ${year}` };
}

export function teamLabel(team) {
  const program = team.program === "alternativo" ? "Alternativo" : "Regular";
  const gender = team.gender === "F" ? "F" : "M";
  const division = team.division ? ` ${team.division}` : "";
  return `${team.category || "?"}U ${gender}${division} · ${program}`;
}

/** Fee breakdown for a team, as shown in the portal and stored in Odoo. */
export function teamCosts(team, playerCount, shortsCount) {
  const base = feeForCategory(team.category);
  const extraUniforms = Math.max(0, Number(playerCount || 0) - UNIFORMS_INCLUDED);
  const extraFee = extraUniforms * EXTRA_UNIFORM_FEE;
  const shortsFee = Number(shortsCount || 0) * COACH_SHORTS_FEE;
  return {
    base,
    extraUniforms,
    extraFee,
    shortsCount: Number(shortsCount || 0),
    shortsFee,
    total: base + extraFee + shortsFee,
    deposit: DEPOSIT_PER_TEAM,
  };
}

export function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const MUNICIPALITIES = [
  "Adjuntas", "Aguada", "Aguadilla", "Aguas Buenas", "Aibonito", "Añasco", "Arecibo", "Arroyo", "Barceloneta",
  "Barranquitas", "Bayamón", "Cabo Rojo", "Caguas", "Camuy", "Canóvanas", "Carolina", "Cataño", "Cayey", "Ceiba",
  "Ciales", "Cidra", "Coamo", "Comerío", "Corozal", "Culebra", "Dorado", "Fajardo", "Florida", "Guánica", "Guayama",
  "Guayanilla", "Guaynabo", "Gurabo", "Hatillo", "Hormigueros", "Humacao", "Isabela", "Jayuya", "Juana Díaz", "Juncos",
  "Lajas", "Lares", "Las Marías", "Las Piedras", "Loíza", "Luquillo", "Manatí", "Maricao", "Maunabo", "Mayagüez",
  "Moca", "Morovis", "Naguabo", "Naranjito", "Orocovis", "Patillas", "Peñuelas", "Ponce", "Quebradillas", "Rincón",
  "Río Grande", "Sabana Grande", "Salinas", "San Germán", "San Juan", "San Lorenzo", "San Sebastián", "Santa Isabel",
  "Toa Alta", "Toa Baja", "Trujillo Alto", "Utuado", "Vega Alta", "Vega Baja", "Vieques", "Villalba", "Yabucoa", "Yauco",
];
