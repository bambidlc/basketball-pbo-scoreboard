import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { backupMatches, parseScorerBackup, type ScorerBackup } from "../api/backup";

export function BackupRecovery({ open, busy, onRestore, onClose }: {
  open: boolean; busy: boolean; onRestore: (backup: ScorerBackup) => Promise<number>; onClose: () => void;
}) {
  const [backup, setBackup] = useState<ScorerBackup>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string>();
  const [saving, setSaving] = useState(false);
  async function select(file?: File) {
    setBackup(undefined); setSuccess(undefined); setError("");
    if (!file) return;
    try { setBackup(parseScorerBackup(await file.text())); }
    catch (error) { setError(error instanceof Error ? error.message : "No se pudo leer el respaldo."); }
  }
  async function restore() {
    if (!backup) return;
    setSaving(true); setError("");
    try {
      const pending = await onRestore(backup);
      setSuccess(`Respaldo guardado en este dispositivo. ${pending} cambios pendientes de Odoo. Pulsa Continuar para enviarlos.`);
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo restaurar el respaldo."); }
    finally { setSaving(false); }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !saving) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(95vw,36rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-5 text-neutral-100">
        <Dialog.Title className="text-lg font-semibold text-balance">Recuperar respaldo</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-pretty text-neutral-300">Selecciona el archivo más reciente de «Respaldar datos». Después de descargarlo, cierra la consola anterior para que no envíe cambios antiguos al mismo tiempo.</Dialog.Description>
        <label className="mt-4 block text-sm font-semibold">Archivo de respaldo PBO
          <input type="file" accept=".json,application/json" disabled={saving} onChange={event => void select(event.target.files?.[0])}
            className="mt-2 block w-full rounded-md border border-neutral-700 p-2 text-sm" />
        </label>
        {backup && <div className="mt-3 text-sm text-neutral-300">
          <p className="tabular-nums">{new Date(backup.savedAt).toLocaleString()} · {backup.pendingOps.length} cambios en el archivo</p>
          <ul className="mt-2 space-y-1">{backupMatches(backup, backup.pendingOps).map(match => <li key={match.gameId} className="text-pretty">
            {match.away.name} {match.awayScore} – {match.homeScore} {match.home.name} · período {match.period}
          </li>)}</ul>
        </div>}
        {busy && <p role="status" className="mt-3 text-sm text-amber-300">Terminando el envío actual antes de recuperar…</p>}
        {error && <p role="alert" className="mt-3 text-sm text-pretty text-red-300">{error}</p>}
        {success && <p role="status" className="mt-3 text-sm text-pretty text-lime-300">{success}</p>}
        <div className="mt-5 flex gap-3">
          {!success && <button type="button" disabled={!backup || saving || busy} onClick={() => void restore()}
            className="min-h-11 rounded-md bg-amber-300 px-4 font-semibold text-neutral-950 disabled:opacity-50">{saving ? "Guardando…" : "Restaurar respaldo"}</button>}
          <button type="button" disabled={saving} onClick={onClose} className="min-h-11 rounded-md border border-neutral-700 px-4">{success ? "Continuar y sincronizar" : "Cerrar"}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
