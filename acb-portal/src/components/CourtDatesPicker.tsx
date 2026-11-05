import { COURT_DAYS, COURT_SLOTS, formatDateShort, monthName } from "../../shared/tournament.js";
import type { CourtDate } from "../types";
import { Seg } from "./ui";

type Slot = CourtDate["slot"] | "";

export function CourtDatesPicker({ value, onChange, disabled }: { value: CourtDate[]; onChange: (v: CourtDate[]) => void; disabled?: boolean }) {
  const byDate = new Map(value.map((d) => [d.date, d.slot]));
  const months = new Map<number, string[]>();
  for (const day of COURT_DAYS as string[]) {
    const m = Number(day.slice(5, 7)) - 1;
    months.set(m, [...(months.get(m) || []), day]);
  }
  const set = (date: string, slot: Slot) => {
    const next = value.filter((d) => d.date !== date);
    if (slot) next.push({ date, slot });
    next.sort((a, b) => a.date.localeCompare(b.date));
    onChange(next);
  };
  // Short labels keep each date on one line; the legend explains "Día".
  const options: { value: Slot; label: string }[] = [{ value: "", label: "No" }, ...COURT_SLOTS.map((s) => ({ value: s.value as Slot, label: s.value === "day" ? "Día" : s.label }))];
  const allFor = (slot: Slot) => onChange(slot ? (COURT_DAYS as string[]).map((date) => ({ date, slot: slot as CourtDate["slot"] })) : []);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span className="field__hint" style={{ alignSelf: "center" }}>
          Marcar todas:
        </span>
        <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => allFor("day")}>
          Todo el día
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => allFor("am")}>
          Solo AM
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => allFor("pm")}>
          Solo PM
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => allFor("")}>
          Limpiar
        </button>
        <span className="field__hint" style={{ alignSelf: "center" }}>
          Día = todo el día (AM y PM)
        </span>
        <span className="badge badge--submitted" style={{ marginLeft: "auto" }}>
          {value.length} fecha(s)
        </span>
      </div>
      <div className="months">
        {Array.from(months, ([m, days]) => (
          <div className="month" key={m}>
            <h5>{monthName(m)} 2027</h5>
            {days.map((day) => (
              <div className="day-row" key={day}>
                <span className="day-row__date">{formatDateShort(day)}</span>
                <Seg<Slot> value={byDate.get(day) || ""} options={options} onChange={(v) => set(day, v)} disabled={disabled} label={day} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
