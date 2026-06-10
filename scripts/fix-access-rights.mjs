import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PERMISSIONS = {
  perm_create: true,
  perm_read: true,
  perm_unlink: true,
  perm_write: true,
};

const env = { ...readDotEnv(".env"), ...process.env };
const config = {
  apiKey: env.VITE_ODOO_API_KEY || env.VITE_ODOO_PASSWORD || "",
  baseUrl: stripTrailingSlash(env.VITE_ODOO_URL || ""),
  database: env.VITE_ODOO_DB || "",
  groupXmlId: env.ODOO_ACCESS_GROUP_XMLID || "base.group_user",
  maxRetries: readPositiveInteger(env.ODOO_SETUP_MAX_RETRIES, 8),
  mode: env.VITE_ODOO_API_MODE === "json2" ? "json2" : "legacy",
  requestDelayMs: readPositiveInteger(env.ODOO_SETUP_REQUEST_DELAY_MS, 1000),
  targetModels: readCsvList(env.ODOO_ACCESS_MODELS),
  username: env.VITE_ODOO_USERNAME || "",
};

if (!config.baseUrl || !config.apiKey) {
  fail("Missing VITE_ODOO_URL or VITE_ODOO_API_KEY in .env.");
}

if (config.mode === "legacy" && (!config.database || !config.username)) {
  fail("Legacy mode also needs VITE_ODOO_DB and VITE_ODOO_USERNAME in .env.");
}

let legacyUid;
let lastRequestAt = 0;
const changed = [];
const unchanged = [];
const missing = [];

const groupId = await resolveAccessGroup();
const models = config.targetModels.length
  ? await loadExplicitModels(config.targetModels)
  : await discoverCustomModels();

if (models.length === 0) {
  fail("No target custom models found.");
}

for (const modelRecord of models) {
  await ensureFullAccess(modelRecord, groupId);
}

console.log("Access-right setup complete.");
console.log(`Group: ${groupId ? config.groupXmlId : "all users / no group"}`);
console.log(`Updated/created: ${changed.length ? changed.join(", ") : "none"}`);
console.log(`Already OK: ${unchanged.length}`);
if (missing.length) {
  console.warn(`Missing models: ${missing.join(", ")}`);
}

async function discoverCustomModels() {
  const records = await searchRead(
    "ir.model",
    [["state", "=", "manual"]],
    ["id", "model", "name", "transient"],
    { limit: 1000, order: "model asc" },
  );

  return records.filter((record) =>
    record.id &&
    typeof record.model === "string" &&
    record.model.startsWith("x_") &&
    !record.transient
  );
}

async function loadExplicitModels(modelNames) {
  const records = await searchRead(
    "ir.model",
    [["model", "in", modelNames]],
    ["id", "model", "name", "transient"],
    { limit: modelNames.length },
  );
  const byName = new Map(records.map((record) => [record.model, record]));

  for (const modelName of modelNames) {
    if (!byName.has(modelName)) {
      missing.push(modelName);
    }
  }

  return modelNames
    .map((modelName) => byName.get(modelName))
    .filter((record) => record?.id && !record.transient);
}

async function ensureFullAccess(modelRecord, groupId) {
  const domain = [
    ["model_id", "=", modelRecord.id],
    ["group_id", "=", groupId || false],
  ];
  const existing = await findOne(
    "ir.model.access",
    domain,
    ["id", "name", "perm_create", "perm_read", "perm_unlink", "perm_write"],
  );

  if (existing) {
    const missingPermissions = Object.entries(PERMISSIONS)
      .filter(([field, value]) => existing[field] !== value)
      .reduce((values, [field, value]) => {
        values[field] = value;
        return values;
      }, {});

    if (Object.keys(missingPermissions).length === 0) {
      unchanged.push(modelRecord.model);
      return;
    }

    await write("ir.model.access", [existing.id], missingPermissions);
    changed.push(`${modelRecord.model}:updated`);
    return;
  }

  await create("ir.model.access", {
    ...PERMISSIONS,
    group_id: groupId || false,
    model_id: modelRecord.id,
    name: `${modelRecord.model} full access`,
  });
  changed.push(`${modelRecord.model}:created`);
}

async function resolveAccessGroup() {
  if (["", "all", "false", "none"].includes(config.groupXmlId.toLowerCase())) {
    return false;
  }

  const [module, name] = config.groupXmlId.split(".");
  if (!module || !name) {
    fail("ODOO_ACCESS_GROUP_XMLID must look like base.group_user, or use all/false for no group.");
  }

  const record = await findOne(
    "ir.model.data",
    [
      ["module", "=", module],
      ["name", "=", name],
      ["model", "=", "res.groups"],
    ],
    ["id", "res_id"],
  );

  if (!record?.res_id) {
    fail(`Could not resolve group XML ID: ${config.groupXmlId}`);
  }

  return record.res_id;
}

async function findOne(model, domain, fields) {
  const records = await searchRead(model, domain, fields, { limit: 1 });
  return records[0];
}

async function searchRead(model, domain, fields, options = {}) {
  if (config.mode === "json2") {
    return callJson2(model, "search_read", {
      domain,
      fields,
      ...options,
    });
  }

  return callLegacy(model, "search_read", [domain], { fields, ...options });
}

async function write(model, ids, values) {
  if (config.mode === "json2") {
    return callJson2(model, "write", { ids, vals: values });
  }

  return callLegacy(model, "write", [ids, values]);
}

async function create(model, values) {
  if (config.mode === "json2") {
    const result = await callJson2(model, "create", { vals_list: [values] });
    return Array.isArray(result) ? result[0] : result;
  }

  return callLegacy(model, "create", [values]);
}

async function callJson2(model, method, body) {
  const headers = {
    Authorization: `bearer ${config.apiKey}`,
    "Content-Type": "application/json; charset=utf-8",
  };

  if (config.database) {
    headers["X-Odoo-Database"] = config.database;
  }

  return requestJson(
    `${config.baseUrl}/json/2/${model}/${method}`,
    {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    },
    `${model}.${method}`,
  );
}

async function callLegacy(model, method, args = [], kwargs = {}) {
  const uid = await authenticateLegacy();
  return callLegacyService("object", "execute_kw", [
    config.database,
    uid,
    config.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}

async function authenticateLegacy() {
  legacyUid ??= callLegacyService("common", "login", [
    config.database,
    config.username,
    config.apiKey,
  ]);

  return legacyUid;
}

async function callLegacyService(service, method, args) {
  const payload = await requestJson(
    `${config.baseUrl}/jsonrpc`,
    {
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
    },
    `${service}.${method}`,
  );

  return payload?.result;
}

async function requestJson(url, init, label) {
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    await waitForRequestSlot();

    const response = await fetch(url, init);
    const payload = await response.json().catch(() => undefined);
    const payloadMessage = getPayloadMessage(payload);
    const rateLimited = response.status === 429 || payloadMessage?.includes("429");

    if (response.ok && !payload?.error) {
      return payload;
    }

    if (!rateLimited || attempt >= config.maxRetries) {
      throw new Error(payloadMessage || response.statusText || `HTTP ${response.status}`);
    }

    const retryAfterMs = getRetryAfterMs(response.headers.get("retry-after"));
    const fallbackBackoffMs = Math.min(60000, 2000 * 2 ** attempt);
    const delayMs = retryAfterMs ?? fallbackBackoffMs;
    console.warn(`${label} hit Odoo rate limit. Retrying in ${Math.ceil(delayMs / 1000)}s...`);
    await sleep(delayMs);
  }
}

async function waitForRequestSlot() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < config.requestDelayMs) {
    await sleep(config.requestDelayMs - elapsed);
  }
  lastRequestAt = Date.now();
}

function getRetryAfterMs(value) {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return undefined;
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function readDotEnv(fileName) {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) {
    return {};
  }

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return values;
      }

      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) {
        return values;
      }

      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim();
      values[key] = rawValue.replace(/^['"]|['"]$/g, "");
      return values;
    }, {});
}

function readCsvList(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripTrailingSlash(value) {
  return value.trim().replace(/\/$/, "");
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getPayloadMessage(payload) {
  return payload?.error?.data?.message || payload?.error?.message || payload?.message;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
