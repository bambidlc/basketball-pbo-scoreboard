// Named color palette used in Odoo for the club color fields ("Color de Camisa",
// "Color de Letra", "Color de Pantalon"). Those Odoo char fields store the color NAME
// chosen from this palette (e.g. "Verde Boston"), not a hex string — so this app and the
// public website QWeb templates both have to map the name back to a hex value before
// using it as a CSS color. (`resolveClubColor` also accepts a raw hex value, so a field
// that already holds "#039132" / "039132" keeps working.)
//
// This grouped structure is the single source of truth; keep it in sync with the dict
// inlined in the `Odoo Public Html/` templates (they cannot import from here).
export type PaletteColor = { name: string; hex: string };
export type PaletteGroup = { group: string; colors: readonly PaletteColor[] };

export const COLOR_PALETTE: readonly PaletteGroup[] = Object.freeze([
  {
    group: "Neutros / grises",
    colors: [
      { name: "Negro", hex: "#000000" },
      { name: "Gris Charcoal", hex: "#3F4A4C" },
      { name: "Gris Platiado", hex: "#677378" },
      { name: "Gris Claro", hex: "#9BA9B1" },
      { name: "Blanco", hex: "#FEFEFE" },
    ],
  },
  {
    group: "Verdes",
    colors: [
      { name: "Verde Oscuro", hex: "#00471D" },
      { name: "Verde Boston", hex: "#039132" },
      { name: "Teal", hex: "#0FC099" },
      { name: "Verde Neón", hex: "#A5EA53" },
    ],
  },
  {
    group: "Azules",
    colors: [
      { name: "Navy", hex: "#2D345A" },
      { name: "Azul", hex: "#253899" },
      { name: "Royal", hex: "#103FE7" },
      { name: "Cyan", hex: "#0090FE" },
      { name: "Ocean Blue", hex: "#198ECE" },
      { name: "Azul Celeste", hex: "#4FD1FD" },
      { name: "Azul Victory", hex: "#90C3E2" },
      { name: "Azul Cielo", hex: "#9AE2FA" },
    ],
  },
  {
    group: "Rojos / morados / rosados",
    colors: [
      { name: "Marrón", hex: "#471E0B" },
      { name: "Rojo", hex: "#EC100D" },
      { name: "Morado", hex: "#430A75" },
      { name: "Violeta", hex: "#721D80" },
      { name: "Cardinal", hex: "#672748" },
      { name: "Magenta", hex: "#F30781" },
      { name: "Rosado Fucsia", hex: "#F902A2" },
      { name: "Rosado Neón", hex: "#FF1979" },
      { name: "Rosado", hex: "#F6A1B4" },
    ],
  },
  {
    group: "Naranjas / amarillos / dorados",
    colors: [
      { name: "Orange Neón", hex: "#E45B01" },
      { name: "Orange", hex: "#F79D2E" },
      { name: "Amarillo Gold", hex: "#FFCC02" },
      { name: "Amarillo Pollito", hex: "#FFF100" },
      { name: "Dorado", hex: "#C0AA20" },
      { name: "Vegas Gold", hex: "#D6B568" },
    ],
  },
]);

// NFD splits an accented letter into its base letter + a combining mark (U+0300–U+036F);
// dropping those marks lets "Verde Neón" match a stored "Verde Neon". A code-point scan
// keeps this source ASCII-only (no literal combining characters in the file).
function stripCombiningMarks(value: string): string {
  let out = "";
  for (const char of value.normalize("NFD")) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x0300 || code > 0x036f) {
      out += char;
    }
  }
  return out;
}

// Lowercase + accent-insensitive + whitespace-collapsed, so "Verde Neón", "verde neon"
// and "VERDE  NEÓN" all map to the same lookup key.
function normalizeName(value: string): string {
  return stripCombiningMarks(value.toLowerCase()).replace(/\s+/g, " ").trim();
}

const HEX_BY_NAME: ReadonlyMap<string, string> = new Map(
  COLOR_PALETTE.flatMap((group) =>
    group.colors.map((color) => [normalizeName(color.name), color.hex.toLowerCase()] as const),
  ),
);

// Normalizes a hex string ("#abc", "aabbcc", "#AABBCC") to lowercase #rrggbb / #rgb, or
// undefined if it is not a usable hex value. A leading "#" is optional in the stored data.
function normalizeHex(value: string): string | undefined {
  const withHash = value.startsWith("#") ? value : `#${value}`;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(withHash) ? withHash.toLowerCase() : undefined;
}

// Resolves a stored club color field value — a palette NAME like "Verde Boston" or a raw
// hex like "#039132" / "039132" — into a usable #rrggbb string, or undefined for anything
// unrecognized (empty, non-string, or a name that is not in the palette).
export function resolveClubColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return HEX_BY_NAME.get(normalizeName(trimmed)) ?? normalizeHex(trimmed);
}
