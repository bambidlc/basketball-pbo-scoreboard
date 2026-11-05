import type { DirectoryClub } from "./types";

/** Lowercase without accents, one output char per input char (keeps highlight offsets aligned). */
export function fold(text: string) {
  return Array.from(text, (ch) => {
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return base.length === 1 ? base : ch.toLowerCase();
  }).join("");
}

const tokens = (text: string) => fold(text).split(/[^a-z0-9]+/).filter(Boolean);

/** Words that say nothing about which club it is. */
const GENERIC = new Set(["club", "clubs", "de", "del", "la", "las", "los", "el", "y", "baloncesto", "basketball", "basket", "baskeball", "academy", "academia", "league", "liga", "cb", "bc", "pr", "puerto", "rico", "inc"]);

export function matchesClub(club: DirectoryClub, query: string) {
  const words = tokens(query);
  if (!words.length) return true;
  const haystack = fold(`${club.name} ${club.acronym} ${club.municipality}`);
  return words.every((w) => haystack.includes(w));
}

/** Registered clubs whose name looks like the one being requested. */
export function similarClubs(clubs: DirectoryClub[], name: string, limit = 3) {
  const wanted = tokens(name).filter((w) => w.length >= 4 && !GENERIC.has(w));
  const compact = fold(name).replace(/[^a-z0-9]/g, "");
  if (!wanted.length && compact.length < 5) return [];
  return clubs
    .map((club) => {
      const own = tokens(`${club.name} ${club.acronym}`);
      const shared = wanted.filter((w) => own.some((o) => o === w || (o.length >= 5 && (o.startsWith(w) || w.startsWith(o))))).length;
      const ownCompact = fold(club.name).replace(/[^a-z0-9]/g, "");
      const contains = compact.length >= 5 && (ownCompact.includes(compact) || compact.includes(ownCompact));
      return { club, score: shared + (contains ? 2 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.club);
}

/** Split `text` into plain and matched parts for the words in `query`. */
export function highlightParts(text: string, query: string) {
  const words = tokens(query).filter((w) => w.length >= 2);
  if (!words.length) return [{ text, hit: false }];
  const folded = fold(text);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    let at = folded.indexOf(w);
    while (at >= 0) {
      for (let i = at; i < at + w.length; i++) marks[i] = true;
      at = folded.indexOf(w, at + w.length);
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
}

export function initials(name: string) {
  const words = name.split(/\s+/).filter((w) => w && !GENERIC.has(fold(w)));
  const picked = (words.length ? words : name.split(/\s+/)).slice(0, 2);
  return picked.map((w) => w[0]?.toUpperCase() || "").join("") || "C";
}

/** Stable hue per club, so each avatar keeps its color. */
export function hueFor(id: number) {
  return (id * 47) % 360;
}

/** What the club still has to do, in plain words (most important first). */
export function pendingSteps(club: DirectoryClub) {
  const out: string[] = [];
  if (club.state === "pending") out.push("Confirmar el email de acceso");
  out.push(...(club.profile.items || []));
  if (!club.teams.total) out.push("Crear sus equipos");
  if (club.teams.changes) out.push(`Corregir ${club.teams.changes} ${club.teams.changes === 1 ? "equipo" : "equipos"} que la ACB devolvió`);
  if (club.teams.draft) out.push(`Terminar y enviar ${club.teams.draft} ${club.teams.draft === 1 ? "equipo" : "equipos"}`);
  return out;
}
