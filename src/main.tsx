import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { deviceStorage } from "./api/deviceStorage";

const root = createRoot(document.getElementById("root")!);
async function start() {
  try {
    await deviceStorage.initialize();
    root.render(<App />);
  } catch {
    root.render(<main className="min-h-dvh bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-lg font-semibold text-balance">No se pudo abrir el respaldo local</h1>
      <p role="alert" className="mt-3 text-pretty">Reintenta sin borrar los datos del navegador. Se conservan las copias anteriores.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-11 rounded-md bg-amber-300 px-4 font-semibold text-neutral-950">Reintentar</button>
    </main>);
  }
}
// Two tabs with independent in-memory queues must not overwrite the same backup.
if (navigator.locks) {
  void navigator.locks.request("pbo-scorer", { ifAvailable: true }, async lock => {
    if (!lock) {
      root.render(<main className="min-h-dvh bg-neutral-950 p-6 text-neutral-100">
        <h1 className="text-lg font-semibold text-balance">La consola está abierta en otra pestaña</h1>
        <p className="mt-3 text-pretty">Continúa allí o cierra esa pestaña antes de abrir esta consola.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-11 rounded-md bg-amber-300 px-4 font-semibold text-neutral-950">Reintentar</button>
      </main>);
      return;
    }
    await start();
    await new Promise(() => {}); // Browser releases the lock when this tab closes.
  });
} else { void start(); }
