// IndexedDB owns the offline state. localStorage is only a migration source/fallback:
// hundreds of full roster snapshots can exceed its small synchronous quota.
export class DeviceStorage {
  private values = new Map<string, string>();
  private dirty = new Map<string, string | undefined>();
  private database?: IDBDatabase;
  private writing?: Promise<boolean>;
  private listeners = new Set<() => void>();
  failed = false;
  pending = false;

  constructor(private legacy?: Storage, private factory?: IDBFactory, private name = "pbo-offline-v1") {}

  async initialize() {
    // Never delete the legacy copy during migration, including on failure.
    try {
      for (let i = 0; i < (this.legacy?.length ?? 0); i++) {
        const key = this.legacy!.key(i);
        if (key?.startsWith("pbo:")) this.values.set(key, this.legacy!.getItem(key)!);
      }
    } catch { /* Restricted storage; IndexedDB may still be available. */ }
    if (!this.factory) return;
    try {
      this.database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory!.open(this.name, 1);
        let abandoned = false;
        const timeout = setTimeout(() => { abandoned = true; reject(new Error("Offline storage unavailable")); }, 8000);
        request.onupgradeneeded = () => request.result.createObjectStore("state");
        request.onerror = () => { clearTimeout(timeout); reject(request.error); };
        request.onblocked = () => { abandoned = true; clearTimeout(timeout); reject(new Error("Offline storage blocked")); };
        request.onsuccess = () => { clearTimeout(timeout); if (abandoned) request.result.close(); else resolve(request.result); };
      });
      this.database.onversionchange = () => this.database?.close();
      const stored = await new Promise<Map<string, string>>((resolve, reject) => {
        const transaction = this.database!.transaction("state", "readonly");
        const entries = new Map<string, string>();
        const request = transaction.objectStore("state").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) { entries.set(String(cursor.key), cursor.value); cursor.continue(); }
        };
        transaction.oncomplete = () => resolve(entries);
        transaction.onabort = () => reject(transaction.error);
      });
      if (stored.has("migrated")) {
        this.values = stored;
      } else {
        this.values.set("migrated", "1");
        this.dirty = new Map(this.values);
        await this.flush();
      }
    } catch {
      this.database?.close();
      this.database = undefined;
      // The legacy copy may be older than a previous IndexedDB commit. Never boot
      // the scorer with stale totals merely because reading the newer copy failed.
      throw new Error("No se pudo abrir el respaldo local. Reintenta sin borrar los datos del navegador.");
    }
  }

  get(key: string) { return this.values.get(key); }
  snapshot() { return Object.fromEntries([...this.values].filter(([key]) => key.startsWith("pbo:"))); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of this.listeners) listener(); }

  set(key: string, value: string | undefined) {
    if (value === this.values.get(key)) return !this.failed;
    if (value === undefined) this.values.delete(key); else this.values.set(key, value);
    this.dirty.set(key, value);
    this.pending = true;
    this.notify();
    // Start one atomic batch after this scoring callback has updated queue and cache.
    void Promise.resolve().then(() => this.flush());
    return !this.failed;
  }

  async flush(): Promise<boolean> {
    if (this.writing) return this.writing;
    if (!this.dirty.size) return !this.failed;
    this.writing = (async () => {
      while (this.dirty.size) {
        const batch = new Map(this.dirty);
        try {
          if (this.database) {
            await new Promise<void>((resolve, reject) => {
              const transaction = this.database!.transaction("state", "readwrite");
              const state = transaction.objectStore("state");
              for (const [key, value] of batch) {
                if (value === undefined) state.delete(key); else state.put(value, key);
              }
              // Request success is not proof of commit. Only oncomplete confirms it.
              transaction.oncomplete = () => resolve();
              transaction.onabort = () => reject(transaction.error);
            });
          } else {
            if (!this.legacy) throw new Error("No offline storage");
            for (const [key, value] of batch) {
              if (key === "migrated") continue;
              if (value === undefined) this.legacy.removeItem(key); else this.legacy.setItem(key, value);
            }
          }
          for (const [key, value] of batch) if (this.dirty.get(key) === value) this.dirty.delete(key);
          this.failed = false;
        } catch {
          this.failed = true;
          break; // Keep the complete in-memory batch for retry/export.
        }
      }
      this.pending = this.dirty.size > 0;
      this.notify();
      return !this.failed;
    })();
    try { return await this.writing; } finally { this.writing = undefined; }
  }
}

function legacyStorage() {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
export const deviceStorage = new DeviceStorage(legacyStorage(), typeof indexedDB === "undefined" ? undefined : indexedDB);
