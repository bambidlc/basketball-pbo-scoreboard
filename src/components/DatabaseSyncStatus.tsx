import { cn } from "../lib/cn";

export function DatabaseSyncStatus({ online, enabled, pending, error, lastSaved, retrying, reading, localBackupFailed, pendingLabel, onRetry, onExport }: {
  online: boolean; enabled: boolean; pending: number; error?: string; lastSaved?: number;
  retrying: boolean; reading: boolean; onRetry: () => void; onExport: () => void;
  localBackupFailed?: boolean;
  pendingLabel?: string;
}) {
  const label = !enabled ? "Modo local · sin base de datos"
    : !online ? "Sin internet · guardado en este dispositivo"
    : pending ? error ? "Odoo: guardado bloqueado" : "Odoo: cambios pendientes"
    : lastSaved ? "Odoo: guardado confirmado" : reading ? "Odoo: lectura conectada" : "Odoo: sin confirmar conexión";
  return <div className="shrink-0 border-b border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span role="status" className={cn("font-semibold", pending || error ? "text-amber-300" : lastSaved ? "text-lime-300" : "text-neutral-300")}>{label}</span>
      <span className="text-neutral-400">Internet: {online ? "disponible" : "sin conexión"}</span>
      <span className="font-semibold tabular-nums text-neutral-200">{pending} pendientes</span>
      {lastSaved && <span className="tabular-nums text-neutral-400">Último guardado: {new Date(lastSaved).toLocaleTimeString()}</span>}
      <button type="button" onClick={onRetry} disabled={!enabled || !online || retrying}
        className="min-h-9 rounded-md border border-neutral-700 px-2 font-semibold text-neutral-200 disabled:opacity-50">{retrying ? "Sincronizando…" : "Reintentar"}</button>
      <button type="button" onClick={onExport} className="min-h-9 rounded-md border border-neutral-700 px-2 text-neutral-300">Respaldar datos</button>
    </div>
    {error && pending > 0 && <p className="mt-1 break-words text-pretty text-amber-300">No se pudo guardar: {error}</p>}
    {pending > 0 && pendingLabel && <p className="mt-1 text-pretty text-neutral-400">Primero en cola: {pendingLabel}</p>}
    {localBackupFailed ? <p role="alert" className="mt-1 text-pretty font-semibold text-red-300">No se pudo guardar el respaldo local. No recargues ni cierres esta página; descarga «Respaldar datos» ahora.</p>
      : pending > 0 && <p className="mt-1 text-pretty text-neutral-400">El marcador local incluye cambios pendientes. No borres los datos de este navegador.</p>}
  </div>;
}
