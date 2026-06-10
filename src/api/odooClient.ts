export type OdooApiMode = "legacy" | "json2";

export type OdooClientConfig = {
  apiKey: string;
  baseUrl: string;
  database: string;
  enabled: boolean;
  liveGameId?: number;
  maxRetries: number;
  mode: OdooApiMode;
  pollMs: number;
  requestDelayMs: number;
  username: string;
};

type SearchReadOptions = {
  limit?: number;
  offset?: number;
  order?: string;
};

type JsonRpcEnvelope<T> = {
  error?: {
    data?: {
      message?: string;
    };
    message?: string;
  };
  result?: T;
};

export type OdooRecord = Record<string, unknown> & { id?: number };

const DEFAULT_POLL_MS = 60000;
const MIN_POLL_MS = 30000;
const DEFAULT_REQUEST_DELAY_MS = 750;
const DEFAULT_MAX_RETRIES = 3;

export function getOdooConfig(): OdooClientConfig {
  const proxyPath = stripTrailingSlash(import.meta.env.VITE_ODOO_PROXY_PATH ?? "");
  const baseUrl = proxyPath || stripTrailingSlash(import.meta.env.VITE_ODOO_URL ?? "");
  const database = import.meta.env.VITE_ODOO_DB ?? "";
  const username = import.meta.env.VITE_ODOO_USERNAME ?? "";
  const apiKey = import.meta.env.VITE_ODOO_API_KEY ?? import.meta.env.VITE_ODOO_PASSWORD ?? "";
  const mode = import.meta.env.VITE_ODOO_API_MODE === "json2" ? "json2" : "legacy";
  const pollMs = readNumber(import.meta.env.VITE_MATCH_POLL_MS, DEFAULT_POLL_MS);
  const requestDelayMs = readNonNegativeNumber(
    import.meta.env.VITE_ODOO_REQUEST_DELAY_MS,
    DEFAULT_REQUEST_DELAY_MS,
  );
  const maxRetries = readPositiveInteger(
    import.meta.env.VITE_ODOO_MAX_RETRIES,
    DEFAULT_MAX_RETRIES,
  );
  const liveGameId = readOptionalNumber(import.meta.env.VITE_LIVE_GAME_ID);
  const enabled =
    mode === "json2"
      ? Boolean(baseUrl && apiKey)
      : Boolean(baseUrl && database && username && apiKey);

  return {
    apiKey,
    baseUrl,
    database,
    enabled,
    liveGameId,
    maxRetries,
    mode,
    pollMs,
    requestDelayMs,
    username,
  };
}

export class OdooClient {
  private legacyAuth?: Promise<number>;
  private nextRequestAt = 0;
  private requestChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: OdooClientConfig) {}

  get enabled() {
    return this.config.enabled;
  }

  get pollMs() {
    return this.config.pollMs;
  }

  get liveGameId() {
    return this.config.liveGameId;
  }

  get mode() {
    return this.config.mode;
  }

  async read<TRecord extends OdooRecord>(
    model: string,
    ids: number[],
    fields: readonly string[],
  ): Promise<TRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    if (this.config.mode === "json2") {
      return this.callJson2<TRecord[]>(model, "read", { fields, ids });
    }

    return this.callLegacy<TRecord[]>(model, "read", [ids], { fields });
  }

  async searchRead<TRecord extends OdooRecord>(
    model: string,
    domain: unknown[],
    fields: readonly string[],
    options: SearchReadOptions = {},
  ): Promise<TRecord[]> {
    if (this.config.mode === "json2") {
      return this.callJson2<TRecord[]>(model, "search_read", {
        domain,
        fields,
        ...options,
      });
    }

    return this.callLegacy<TRecord[]>(model, "search_read", [domain], {
      fields,
      ...options,
    });
  }

  async write(model: string, ids: number[], values: Record<string, unknown>) {
    if (ids.length === 0) {
      return false;
    }

    if (this.config.mode === "json2") {
      return this.callJson2<boolean>(model, "write", {
        ids,
        vals: values,
      });
    }

    return this.callLegacy<boolean>(model, "write", [ids, values]);
  }

  async create(model: string, values: Record<string, unknown>) {
    if (this.config.mode === "json2") {
      const result = await this.callJson2<number | number[]>(model, "create", {
        vals_list: [values],
      });

      return Array.isArray(result) ? result[0] : result;
    }

    return this.callLegacy<number>(model, "create", [values]);
  }

  async unlink(model: string, ids: number[]) {
    if (ids.length === 0) {
      return false;
    }

    if (this.config.mode === "json2") {
      return this.callJson2<boolean>(model, "unlink", { ids });
    }

    return this.callLegacy<boolean>(model, "unlink", [ids]);
  }

  private async callJson2<TResult>(
    model: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<TResult> {
    const headers: HeadersInit = {
      Authorization: `bearer ${this.config.apiKey}`,
      "Content-Type": "application/json; charset=utf-8",
    };

    if (this.config.database) {
      headers["X-Odoo-Database"] = this.config.database;
    }

    try {
      return await this.requestJson<TResult>(
        `${this.config.baseUrl}/json/2/${model}/${method}`,
        {
          body: JSON.stringify(body),
          headers,
          method: "POST",
        },
      );
    } catch (error) {
      if (isOdooHttpError(error, 404) && this.canUseLegacyFallback()) {
        return this.callLegacyFallback<TResult>(model, method, body);
      }

      throw error;
    }
  }

  private async callLegacy<TResult>(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown> = {},
  ): Promise<TResult> {
    const uid = await this.authenticateLegacy();

    return this.callLegacyService<TResult>("object", "execute_kw", [
      this.config.database,
      uid,
      this.config.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  private authenticateLegacy() {
    this.legacyAuth ??= this.callLegacyService<number>("common", "login", [
      this.config.database,
      this.config.username,
      this.config.apiKey,
    ]);

    return this.legacyAuth;
  }

  private async callLegacyService<TResult>(
    service: string,
    method: string,
    args: unknown[],
  ): Promise<TResult> {
    const payload = await this.requestJson<JsonRpcEnvelope<TResult>>(`${this.config.baseUrl}/jsonrpc`, {
      body: JSON.stringify({
        id: Date.now(),
        jsonrpc: "2.0",
        method: "call",
        params: {
          args,
          method,
          service,
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (payload.error) {
      throw new Error(payload.error?.data?.message ?? payload.error?.message ?? "API request failed");
    }

    if (payload.result === undefined) {
      throw new Error("Empty API response");
    }

    return payload.result;
  }

  private async requestJson<TResult>(url: string, init: RequestInit): Promise<TResult> {
    const run = this.requestChain.then(() => this.requestJsonWithRetry<TResult>(url, init));
    this.requestChain = run.catch(() => undefined);

    return run;
  }

  private async requestJsonWithRetry<TResult>(
    url: string,
    init: RequestInit,
  ): Promise<TResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      await this.waitForRequestSlot(attempt);

      try {
        const response = await fetch(url, init);
        const payload = (await response.json().catch(() => null)) as unknown;

        if (response.ok) {
          return payload as TResult;
        }

        const error = new OdooHttpError(getHttpError(payload, response.status), response.status);

        if (response.status !== 429 || attempt === this.config.maxRetries) {
          throw error;
        }

        lastError = error;
        await sleep(getRetryDelayMs(response, attempt));
      } catch (error) {
        if (isOdooHttpError(error) || attempt === this.config.maxRetries) {
          throw error;
        }

        lastError = error;
        await sleep(getRetryDelayMs(undefined, attempt));
      }
    }

    throw lastError instanceof Error ? lastError : new Error("API request failed");
  }

  private async waitForRequestSlot(attempt: number) {
    const now = Date.now();
    const delay = Math.max(0, this.nextRequestAt - now);

    if (delay > 0) {
      await sleep(delay);
    }

    const attemptDelay = attempt > 0 ? Math.min(5000, 1000 * attempt) : 0;
    if (attemptDelay > 0) {
      await sleep(attemptDelay);
    }

    this.nextRequestAt = Date.now() + this.config.requestDelayMs;
  }

  private canUseLegacyFallback() {
    return Boolean(this.config.database && this.config.username && this.config.apiKey);
  }

  private callLegacyFallback<TResult>(
    model: string,
    method: string,
    body: Record<string, unknown>,
  ) {
    if (method === "read") {
      return this.callLegacy<TResult>(
        model,
        "read",
        [body.ids],
        { fields: body.fields },
      );
    }

    if (method === "search_read") {
      const { domain, fields, limit, offset, order } = body;
      return this.callLegacy<TResult>(
        model,
        "search_read",
        [domain],
        { fields, limit, offset, order },
      );
    }

    if (method === "write") {
      return this.callLegacy<TResult>(model, "write", [body.ids, body.vals]);
    }

    if (method === "create") {
      const values = Array.isArray(body.vals_list) ? body.vals_list[0] : undefined;
      return this.callLegacy<TResult>(model, "create", [values]);
    }

    if (method === "unlink") {
      return this.callLegacy<TResult>(model, "unlink", [body.ids]);
    }

    throw new Error(`JSON-2 endpoint not found for ${model}.${method}`);
  }
}

function stripTrailingSlash(value: string) {
  return value.trim().replace(/\/$/, "");
}

function readNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(parsed, MIN_POLL_MS) : fallback;
}

function readNonNegativeNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getHttpError(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "message" in payload) {
    return String((payload as { message?: unknown }).message);
  }

  return `API request failed with status ${status}`;
}

function getRetryDelayMs(response: Response | undefined, attempt: number) {
  const retryAfter = response?.headers.get("Retry-After");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(30000, retryAfterSeconds * 1000);
  }

  return Math.min(30000, 1500 * 2 ** attempt);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

class OdooHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "OdooHttpError";
  }
}

function isOdooHttpError(error: unknown, status?: number): error is OdooHttpError {
  return error instanceof OdooHttpError && (status === undefined || error.status === status);
}
