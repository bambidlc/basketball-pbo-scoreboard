import { UNIFORM_COLORS } from "../../shared/tournament.js";

/** Stored as "Nombre (#HEX)". */
export function colorValue(name: string, hex: string) {
  return `${name} (${hex.toUpperCase()})`;
}
export function colorHex(value: string, fallback = "#1D4ED8") {
  const match = /#([0-9a-f]{6})/i.exec(value || "");
  return match ? `#${match[1]}` : fallback;
}
export function colorName(value: string) {
  return (value || "").replace(/\s*\(#[0-9a-f]{6}\)\s*$/i, "");
}

function contrast(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#0b1640" : "#ffffff";
}

export function ColorPicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const current = colorHex(value, "");
  return (
    <div>
      <div className="swatches" role="group">
        {UNIFORM_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            className="swatch"
            disabled={disabled}
            title={c.name}
            aria-label={c.name}
            aria-pressed={current.toUpperCase() === c.hex.toUpperCase()}
            style={{ background: c.hex }}
            onClick={() => onChange(colorValue(c.name, c.hex))}
          />
        ))}
        <label className="swatch" title="Otro color" style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)", display: "grid", placeItems: "center" }}>
          <input
            type="color"
            disabled={disabled}
            value={current || "#1d4ed8"}
            onChange={(e) => onChange(colorValue("Personalizado", e.target.value))}
            style={{ opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
            aria-label="Otro color"
          />
        </label>
      </div>
      <div className="field__hint" style={{ marginTop: 6 }}>
        {value ? `Seleccionado: ${colorName(value)} ${colorHex(value)}` : "Seleccione un color"}
      </div>
    </div>
  );
}

export function Jersey({ shirt, numbers, pants, number = "23", name = "ACB" }: { shirt: string; numbers: string; pants: string; number?: string; name?: string }) {
  const s = colorHex(shirt, "#1D4ED8");
  const n = colorHex(numbers, contrast(s));
  const p = colorHex(pants, s);
  const trim = n;
  return (
    <svg viewBox="0 0 220 300" role="img" aria-label="Vista previa del uniforme">
      <defs>
        <linearGradient id="jShade" x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".18" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".08" />
          <stop offset="1" stopColor="#000" stopOpacity=".2" />
        </linearGradient>
      </defs>
      {/* shirt */}
      <path d="M62 14 Q110 40 158 14 L190 30 Q182 70 186 96 L168 104 L168 196 L52 196 L52 104 L34 96 Q38 70 30 30 Z" fill={s} stroke="#0b1640" strokeOpacity=".35" strokeWidth="2" />
      <path d="M62 14 Q110 40 158 14 L150 10 Q110 32 70 10 Z" fill={trim} />
      <path d="M30 30 Q38 70 34 96 L52 104 M190 30 Q182 70 186 96 L168 104" fill="none" stroke={trim} strokeWidth="5" />
      <path d="M62 14 Q110 40 158 14 L190 30 Q182 70 186 96 L168 104 L168 196 L52 196 L52 104 L34 96 Q38 70 30 30 Z" fill="url(#jShade)" />
      <text x="110" y="80" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontSize="20" fill={n} letterSpacing="2">
        {(name || "ACB").toUpperCase().slice(0, 14)}
      </text>
      <text x="110" y="160" textAnchor="middle" fontFamily="Bungee, Impact, sans-serif" fontSize="64" fill={n} stroke="#0b1640" strokeOpacity=".25" strokeWidth="1.5">
        {number || "23"}
      </text>
      {/* shorts */}
      <path d="M50 206 L170 206 L182 288 L122 288 L110 246 L98 288 L38 288 Z" fill={p} stroke="#0b1640" strokeOpacity=".35" strokeWidth="2" />
      <path d="M50 206 L170 206 L171 216 L49 216 Z" fill={trim} opacity=".9" />
      <path d="M42 270 L98 270 M122 270 L178 270" stroke={trim} strokeWidth="5" />
      <path d="M50 206 L170 206 L182 288 L122 288 L110 246 L98 288 L38 288 Z" fill="url(#jShade)" />
    </svg>
  );
}
