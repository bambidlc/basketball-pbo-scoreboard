import { useEffect, useState } from "react";

export function AppUpdate({ onSave }: { onSave: () => Promise<boolean> }) {
  const [available, setAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const check = async () => {
      try {
        const response = await fetch("/version.json", { cache: "no-store" });
        if (response.ok) setAvailable((await response.json()).version !== __APP_VERSION__);
      } catch { /* Offline scoring remains available. */ }
    };
    void check();
    const timer = window.setInterval(() => { if (!document.hidden) void check(); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function update() {
    setUpdating(true); setError("");
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) {
        await registration.update();
        const worker = registration.installing ?? registration.waiting;
        if (worker && worker.state !== "activated") await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error("La actualización todavía no está lista. Intenta nuevamente.")), 20000);
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated") { clearTimeout(timer); resolve(); }
            if (worker.state === "redundant") { clearTimeout(timer); reject(new Error("No se pudo descargar la actualización.")); }
          });
        });
      }
      if (!await onSave()) throw new Error("Descarga «Respaldar datos» antes de recargar: el respaldo local no se pudo confirmar.");
      // Do not await anything between the durable checkpoint and navigation.
      window.location.reload();
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo actualizar."); setUpdating(false); }
  }
  return <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-400">
    <span>Versión {__APP_VERSION__}</span>
    {available && <button type="button" disabled={updating} onClick={() => void update()} className="min-h-9 rounded-md border border-amber-700 px-2 font-semibold text-amber-300 disabled:opacity-50">
      {updating ? "Preparando actualización…" : "Guardar y actualizar"}
    </button>}
    {error && <p role="alert" className="text-pretty text-red-300">{error}</p>}
  </div>;
}
