import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Attendance model is declared first so the child model and its inverse
// `x_studio_game` many2one exist before x_game's one2many binds to it.
const FIELD_PLAN = [
  {
    createModel: true,
    model: "x_game_attendance",
    label: "Game Attendance",
    fields: [
      field("x_name", "Name", "char"),
      field("x_active", "Active", "boolean"),
      field("x_studio_game", "Game", "many2one", "x_game"),
      field("x_studio_player", "Player", "many2one", "x_player"),
      field("x_studio_team", "Team", "many2one", "x_team"),
      field("x_studio_present", "Present", "boolean"),
      field("x_studio_starter", "Starter", "boolean"),
      field("x_studio_jersey", "Jersey", "integer"),
    ],
  },
  {
    model: "x_game",
    label: "Game",
    fields: [
      field("x_studio_referee", "Referee 1", "char"),
      field("x_studio_referee_2", "Referee 2", "char"),
      field("x_studio_referee_3", "Referee 3", "char"),
      field("x_studio_scorekeeper", "Scorekeeper 1", "char"),
      field("x_studio_scorekeeper_2", "Scorekeeper 2", "char"),
      field("x_studio_away_present", "Away Present Count", "integer"),
      field("x_studio_home_present", "Home Present Count", "integer"),
      field("x_studio_equalization_points", "Equalization Points", "integer"),
      field("x_studio_equalization_team", "Equalization Team", "many2one", "x_team"),
      field("x_studio_equalization_applied", "Equalization Applied", "boolean"),
      field("x_studio_attendance_ids", "Attendance", "one2many", "x_game_attendance", "x_studio_game"),
    ],
  },
  {
    model: "x_game_event",
    label: "Game Event",
    fields: [
      field("x_studio_issued_by_ref", "Issued By Referee", "boolean"),
    ],
  },
];

const env = { ...readDotEnv(".env"), ...process.env };
const config = {
  apiKey: env.VITE_ODOO_API_KEY || env.VITE_ODOO_PASSWORD || "",
  baseUrl: stripTrailingSlash(env.VITE_ODOO_URL || ""),
  database: env.VITE_ODOO_DB || "",
  maxRetries: readPositiveInteger(env.ODOO_SETUP_MAX_RETRIES, 8),
  mode: env.VITE_ODOO_API_MODE === "json2" ? "json2" : "legacy",
  requestDelayMs: readPositiveInteger(env.ODOO_SETUP_REQUEST_DELAY_MS, 1000),
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
const created = [];
const skipped = [];

for (const modelPlan of FIELD_PLAN) {
  const modelRecord = await ensureModel(modelPlan);
  if (!modelRecord?.id) {
    fail(`Model ${modelPlan.model} was not found and could not be created.`);
  }

  if (modelPlan.createModel) {
    await ensureAccess(modelPlan.model, modelRecord.id);
  }

  for (const fieldPlan of modelPlan.fields) {
    await ensureField(modelPlan.model, modelRecord.id, fieldPlan);
  }
}

console.log("Referee / attendance / equalization field setup complete.");
console.log(`Created: ${created.length ? created.join(", ") : "none"}`);
console.log(`Already present: ${skipped.length}`);

function field(name, label, type, relation, relationField) {
  return { label, name, relation, relationField, type };
}

async function ensureModel(plan) {
  const existing = await findOne("ir.model", [["model", "=", plan.model]], ["id", "model", "name"]);
  if (existing) {
    return existing;
  }

  if (!plan.createModel) {
    return undefined;
  }

  const id = await create("ir.model", {
    model: plan.model,
    name: plan.label,
    state: "manual",
  });
  created.push(plan.model);

  return { id, model: plan.model, name: plan.label };
}

async function ensureField(modelName, modelId, plan) {
  const existing = await findOne(
    "ir.model.fields",
    [
      ["model", "=", modelName],
      ["name", "=", plan.name],
    ],
    ["id", "name"],
  );

  if (existing) {
    skipped.push(`${modelName}.${plan.name}`);
    return;
  }

  const values = {
    field_description: plan.label,
    model_id: modelId,
    name: plan.name,
    state: "manual",
    ttype: plan.type,
  };

  if (plan.relation) {
    values.relation = plan.relation;
  }

  if (plan.relationField) {
    values.relation_field = plan.relationField;
  }

  await create("ir.model.fields", values);
  created.push(`${modelName}.${plan.name}`);
}

async function ensureAccess(modelName, modelId) {
  const name = `${modelName} user access`;
  const existing = await findOne(
    "ir.model.access",
    [
      ["model_id", "=", modelId],
      ["name", "=", name],
    ],
    ["id", "name"],
  );

  if (existing) {
    skipped.push(`access:${modelName}`);
    return;
  }

  await create("ir.model.access", {
    name,
    model_id: modelId,
    group_id: false,
    perm_create: true,
    perm_read: true,
    perm_unlink: false,
    perm_write: true,
  });
  created.push(`access:${modelName}`);
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

  const payload = await requestJson(
    `${config.baseUrl}/json/2/${model}/${method}`,
    {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    },
    `${model}.${method}`,
  );

  return payload;
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
