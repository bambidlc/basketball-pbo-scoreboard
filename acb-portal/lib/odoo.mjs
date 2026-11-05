// Minimal Odoo JSON-2 client (Odoo 19+) with retry on rate limits / transient
// failures. Zero dependencies. The API key never leaves the server.

const RETRYABLE = new Set([429, 502, 503, 504]);

export class OdooError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "OdooError";
    this.status = status;
  }
}

export function createOdoo({ url, apiKey, db, timeoutMs = 25000, maxRetries = 4 }) {
  const baseUrl = String(url || "").replace(/\/+$/, "");
  if (!baseUrl || !apiKey) {
    throw new Error("ODOO_URL and ODOO_API_KEY must be configured.");
  }

  async function call(model, method, params = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers = {
          Authorization: `bearer ${apiKey}`,
          "Content-Type": "application/json; charset=utf-8",
        };
        if (db) headers["X-Odoo-Database"] = db;
        const response = await fetch(`${baseUrl}/json/2/${model}/${method}`, {
          method: "POST",
          headers,
          body: JSON.stringify(params),
          signal: controller.signal,
        });
        const text = await response.text();
        let payload;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = undefined;
        }
        if (response.ok) return payload;
        const message = payload?.message || payload?.error?.message || `HTTP ${response.status}`;
        if (!RETRYABLE.has(response.status) || attempt === maxRetries) {
          throw new OdooError(`${model}.${method}: ${message}`, response.status);
        }
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 600 * 2 ** attempt));
        lastError = new OdooError(message, response.status);
      } catch (error) {
        if (error instanceof OdooError) throw error;
        lastError = error;
        if (attempt === maxRetries) break;
        await sleep(Math.min(8000, 600 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new OdooError(`${model}.${method}: ${lastError?.message || "request failed"}`, 503);
  }

  return {
    call,
    searchRead: (model, domain, fields, options = {}) =>
      call(model, "search_read", { domain, fields, ...options }),
    read: (model, ids, fields) => call(model, "read", { ids, fields }),
    create: async (model, values) => {
      const result = await call(model, "create", { vals_list: [values] });
      return Array.isArray(result) ? result[0] : result;
    },
    write: (model, ids, values) => call(model, "write", { ids, vals: values }),
    unlink: (model, ids) => call(model, "unlink", { ids }),
    searchCount: (model, domain) => call(model, "search_count", { domain }),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Load KEY=value pairs from a .env file into an object (no overrides). */
export async function readDotEnv(path) {
  const { readFile } = await import("node:fs/promises");
  try {
    const text = await readFile(path, "utf8");
    const env = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const index = line.indexOf("=");
      env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    }
    return env;
  } catch {
    return {};
  }
}
