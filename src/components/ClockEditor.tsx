import { useState } from "react";
import { ScoringDialog } from "./ScoringControls";

export function ClockEditor({ clock, onClose, onSave }: {
  clock: string; onClose: () => void; onSave: (seconds: number) => void;
}) {
  const [minutes, setMinutes] = useState(clock.split(":")[0]);
  const [seconds, setSeconds] = useState(clock.split(":")[1]);
  const valid = /^\d{1,2}$/.test(minutes) && /^\d{1,2}$/.test(seconds) && Number(minutes) <= 99 && Number(seconds) <= 59;
  const total = Number(minutes) * 60 + Number(seconds);
  const formatted = valid ? `${minutes.padStart(2, "0")}:${seconds.padStart(2, "0")}` : "—:—";
  const adjust = (delta: number) => {
    const next = Math.max(0, Math.min(5999, total + delta));
    setMinutes(String(Math.floor(next / 60)).padStart(2, "0"));
    setSeconds(String(next % 60).padStart(2, "0"));
  };
  return <ScoringDialog title="Editar tiempo" description="El reloj queda pausado. Escribe minutos y segundos y confirma el tiempo exacto." onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); if (valid) onSave(total); }} className="space-y-4 overflow-y-auto p-4">
      <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-center">
        <p className="text-xs text-neutral-400">Tiempo restante</p>
        <output className="mt-2 block font-mono text-5xl font-black tabular-nums">{formatted}</output>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[{ label: "Minutos", value: minutes, set: setMinutes, max: 99 }, { label: "Segundos", value: seconds, set: setSeconds, max: 59 }].map(field =>
          <label key={field.label} className="block text-sm font-semibold">
            {field.label}<span className="ml-2 text-xs text-neutral-400">0–{field.max}</span>
            <input aria-label={field.label} aria-invalid={!/^\d{1,2}$/.test(field.value) || Number(field.value) > field.max}
              aria-describedby={!valid ? "clock-error" : undefined} inputMode="numeric" type="text" maxLength={2}
              value={field.value} onChange={event => field.set(event.currentTarget.value)} onFocus={event => event.currentTarget.select()}
              className="mt-2 h-14 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-center font-mono text-3xl tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-400" />
          </label>)}
      </div>
      {!valid && <p id="clock-error" role="status" className="text-sm text-amber-300 text-pretty">Completa los minutos (0–99) y segundos (0–59).</p>}
      <div aria-label="Ajuste en segundos" role="group" className="grid grid-cols-4 gap-2">
        {[-10, -1, 1, 10].map(delta => <button key={delta} type="button" disabled={!valid} onClick={() => adjust(delta)}
          className="min-h-11 rounded-lg border border-neutral-700 bg-neutral-900 text-sm font-bold tabular-nums hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-40">{delta > 0 ? "+" : ""}{delta} s</button>)}
      </div>
      <div className="flex justify-end gap-2 border-t border-neutral-800 pt-4">
        <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-neutral-700 px-4 text-sm font-semibold">Cancelar</button>
        <button type="submit" disabled={!valid} className="min-h-11 rounded-lg bg-neutral-100 px-4 text-sm font-bold text-neutral-950 disabled:opacity-40">Guardar tiempo</button>
      </div>
    </form>
  </ScoringDialog>;
}
