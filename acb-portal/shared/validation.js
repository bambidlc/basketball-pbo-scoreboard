// Shared validation for clubs and teams. The portal UI uses it for live
// feedback; the server re-runs it before accepting a submission.

import {
  ALL_SIZES,
  CATEGORIES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RULES,
  eligibility,
} from "./tournament.js";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value) {
  return EMAIL_RE.test(String(value || "").trim());
}

export function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isPhone(value) {
  const digits = phoneDigits(value);
  return digits.length >= 10 && digits.length <= 15;
}

const blank = (value) => value === undefined || value === null || String(value).trim() === "";

function push(list, section, field, message) {
  list.push({ section, field, message });
}

/**
 * Club profile checks.
 * @param {any} club
 * @returns {{ errors: { section: string, field: string, message: string }[], warnings: { section: string, field: string, message: string }[] }}
 */
export function validateClub(club) {
  const errors = [];
  const warnings = [];
  if (blank(club.name)) push(errors, "club", "name", "Escriba el nombre del club");
  if (blank(club.municipality)) push(errors, "club", "municipality", "Indique el municipio del club");
  if (!isPhone(club.phone)) push(errors, "club", "phone", "Teléfono del club inválido (10 dígitos)");
  if (blank(club.presidentName)) push(errors, "directiva", "presidentName", "Escriba el nombre del presidente");
  if (!isPhone(club.presidentPhone)) push(errors, "directiva", "presidentPhone", "Teléfono del presidente inválido");
  if (!blank(club.presidentEmail) && !isEmail(club.presidentEmail)) push(errors, "directiva", "presidentEmail", "Email del presidente inválido");
  if (blank(club.contactName)) push(errors, "directiva", "contactName", "Escriba el contacto principal");
  if (!isPhone(club.contactPhone)) push(errors, "directiva", "contactPhone", "Teléfono del contacto inválido");
  if (!blank(club.contactEmail) && !isEmail(club.contactEmail)) push(errors, "directiva", "contactEmail", "Email del contacto inválido");
  if (blank(club.insuranceCompany) || blank(club.insuranceNumber)) {
    push(warnings, "seguro", "insuranceNumber", "Falta la póliza de seguro de accidentes (requerida para enviar equipos)");
  }
  if (blank(club.courtName)) push(warnings, "cancha", "courtName", "Indique su cancha sede");
  const dates = parseCourtDates(club.courtDates);
  if (!dates.length) push(warnings, "cancha", "courtDates", "Marque las fechas disponibles de su cancha antes del 30 de diciembre");
  return { errors, warnings };
}

export function parseCourtDates(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sameCoach(a, b) {
  const lic = (x) => String(x.coachLic || "").replace(/\s/g, "").toLowerCase();
  const name = (x) => String(x.coachName || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (lic(a) && lic(b)) return lic(a) === lic(b);
  return name(a) !== "" && name(a) === name(b);
}

/**
 * @param {any} team
 * @param {any[]} players
 * @param {{ club?: any, otherTeams?: any[], files?: Record<string, boolean>, playerFiles?: Record<string, { birthCert?: boolean }> }} [context]
 * @returns {{ errors: { section: string, field: string, message: string, player?: any }[], warnings: { section: string, field: string, message: string, player?: any }[] }}
 *
 * Team checks. `otherTeams` are the club's other teams (summaries with
 * id, category, coachName, coachLic, label) for the 2-team coach rule.
 * `files` says which uploads exist: { coachCard, asstCard, scorerCard }.
 */
export function validateTeam(team, players, { club = {}, otherTeams = [], files = {}, playerFiles = {} } = {}) {
  const errors = [];
  const warnings = [];

  // --- Equipo
  if (!["regular", "alternativo"].includes(team.program)) push(errors, "equipo", "program", "Seleccione ACB Regular o ACB Alternativo");
  if (!CATEGORIES.includes(Number(team.category))) push(errors, "equipo", "category", "Seleccione la categoría (edad)");
  if (!["M", "F"].includes(team.gender)) push(errors, "equipo", "gender", "Seleccione la rama (masculino o femenino)");

  // --- Personal técnico
  if (blank(team.coachName)) push(errors, "personal", "coachName", "Escriba el nombre del dirigente");
  if (!isPhone(team.coachPhone)) push(errors, "personal", "coachPhone", "Teléfono del dirigente inválido");
  if (blank(team.coachLic)) push(errors, "personal", "coachLic", "Falta el # de licencia DRD del dirigente");
  if (!files.coachCard) push(errors, "personal", "coachCard", "Suba la copia de la tarjeta federativa del dirigente");
  if (blank(team.coachCert)) push(warnings, "personal", "coachCert", "Falta la certificación FBPR del dirigente");
  if (team.coachShorts && blank(team.coachWaist)) push(errors, "personal", "coachWaist", "Indique el tamaño de cintura del pantalón del dirigente");

  if (blank(team.asstName)) {
    push(warnings, "personal", "asstName", "No hay asistente registrado");
  } else {
    if (!isPhone(team.asstPhone)) push(errors, "personal", "asstPhone", "Teléfono del asistente inválido");
    if (blank(team.asstLic)) push(errors, "personal", "asstLic", "Falta el # de licencia DRD del asistente");
    if (!files.asstCard) push(errors, "personal", "asstCard", "Suba la copia de la tarjeta federativa del asistente");
  }
  if (team.asstShorts && blank(team.asstWaist)) push(errors, "personal", "asstWaist", "Indique el tamaño de cintura del pantalón del asistente");

  if (blank(team.scorerName)) push(errors, "personal", "scorerName", "Escriba el nombre del anotador");
  if (blank(team.scorerLic)) push(errors, "personal", "scorerLic", "Falta el # de licencia DRD del anotador");
  if (!files.scorerCard) push(errors, "personal", "scorerCard", "Suba la copia de la tarjeta federativa del anotador");
  if (blank(team.managerName)) push(errors, "personal", "managerName", "Escriba el nombre del apoderado");
  if (!isPhone(team.managerPhone)) push(errors, "personal", "managerPhone", "Teléfono del apoderado inválido");

  for (const role of ["coach", "asst", "scorer", "manager"]) {
    const email = team[`${role}Email`];
    if (!blank(email) && !isEmail(email)) push(errors, "personal", `${role}Email`, "Email inválido");
  }

  // Dirigentes con 2 equipos
  const coachTeams = otherTeams.filter((other) => other.id !== team.id && sameCoach(other, team));
  if (coachTeams.length) {
    if (coachTeams.length + 1 > 2) {
      push(errors, "personal", "coachName", `Este dirigente ya dirige ${coachTeams.length} equipo(s) del club. Máximo 2 equipos por dirigente.`);
    }
    const sameCategory = coachTeams.find((other) => Number(other.category) === Number(team.category));
    if (sameCategory) {
      push(errors, "personal", "coachName", `Un dirigente no puede dirigir dos equipos en la misma categoría (${sameCategory.label}).`);
    }
    if (!team.schedulePref || team.schedulePref === "none") {
      push(warnings, "personal", "schedulePref", "El dirigente tiene 2 equipos: solicite acomodo AM o PM antes del 30 de diciembre");
    }
  }

  // --- Uniformes
  if (blank(team.shirtColor)) push(errors, "uniformes", "shirtColor", "Seleccione el color de camiseta");
  if (blank(team.numberColor)) push(errors, "uniformes", "numberColor", "Seleccione el color de letras y números");
  if (blank(team.pantsColor)) push(errors, "uniformes", "pantsColor", "Seleccione el color de pantalón");

  // --- Jugadores
  const list = players || [];
  if (list.length < MIN_PLAYERS) push(errors, "jugadores", "players", `Inscriba al menos ${MIN_PLAYERS} jugadores`);
  if (list.length > MAX_PLAYERS) push(errors, "jugadores", "players", `Máximo ${MAX_PLAYERS} jugadores por equipo`);
  const numbers = new Map();
  list.forEach((player, index) => {
    const who = player.firstName || player.lastName ? `${player.firstName || ""} ${player.lastName || ""}`.trim() : `Jugador ${index + 1}`;
    const key = player.id || player.key || index;
    const perr = (field, message) => errors.push({ section: "jugadores", field, player: key, message: `${who}: ${message}` });
    if (blank(player.firstName) || blank(player.lastName)) perr("firstName", "nombre y apellidos requeridos");
    const number = String(player.number ?? "").trim();
    if (!/^\d{1,2}$/.test(number)) {
      perr("number", "número de camiseta (0 – 99) requerido");
    } else {
      const normalized = number === "00" ? "00" : String(Number(number));
      if (numbers.has(normalized)) perr("number", `el número ${number} está repetido`);
      numbers.set(normalized, true);
    }
    const elig = eligibility(player.birthdate, team.category);
    if (elig.level === "missing") perr("birthdate", "fecha de nacimiento requerida");
    else if (elig.level === "error") perr("birthdate", elig.message);
    if (blank(player.school)) perr("school", "escuela requerida");
    if (blank(player.grade)) perr("grade", "grado requerido");
    if (blank(player.guardianName)) perr("guardianName", "nombre del padre, madre o encargado requerido");
    if (!isPhone(player.guardianPhone)) perr("guardianPhone", "teléfono del encargado inválido");
    if (!blank(player.guardianEmail) && !isEmail(player.guardianEmail)) perr("guardianEmail", "email del encargado inválido");
    if (!player.consent || blank(player.consentName)) perr("consent", "falta la autorización firmada del encargado");
    if (!ALL_SIZES.includes(player.shirtSize)) perr("shirtSize", "talla de camiseta requerida");
    if (!ALL_SIZES.includes(player.pantsSize)) perr("pantsSize", "talla de pantalón requerida");
    if (!playerFiles[key]?.birthCert) {
      warnings.push({ section: "jugadores", field: "birthCert", player: key, message: `${who}: suba copia del certificado de nacimiento (el original se entrega el 23 de enero)` });
    }
  });

  // --- Club prerequisites
  if (blank(club.insuranceCompany) || blank(club.insuranceNumber)) {
    push(errors, "club", "insuranceNumber", "El club debe registrar su póliza de seguro de accidentes (Perfil del club → Seguro)");
  }
  if (!parseCourtDates(club.courtDates).length) {
    push(warnings, "club", "courtDates", "El club no ha marcado la disponibilidad de su cancha para los carnavales");
  }

  return { errors, warnings };
}

export const RULE_TEXT = RULES;
