// Idempotent setup for the suspension status used by the scoring app.
import { loadEnv } from "vite";

const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
const url = (env.ODOO_URL || env.VITE_ODOO_URL || "").replace(/\/+$/, "");
const key = env.ODOO_API_KEY || env.VITE_ODOO_API_KEY;
if (!url || !key) throw new Error("Odoo URL and API key are required.");

async function call(model, method, body) {
  const response = await fetch(`${url}/json/2/${model}/${method}`, {
    method: "POST",
    headers: { Authorization: `bearer ${key}`, "Content-Type": "application/json",
      "X-Odoo-Database": env.ODOO_DB || env.VITE_ODOO_DB || "" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Odoo setup failed (${response.status}).`);
  return response.json();
}

const [field] = await call("ir.model.fields", "search_read", {
  domain: [["model", "=", "x_game"], ["name", "=", "x_studio_status"]], fields: ["id", "ttype"], limit: 1,
});
if (field?.ttype !== "selection") throw new Error("Expected the game status selection field.");
const domain = [["field_id", "=", field.id], ["value", "=", "Suspended"]];
let choices = await call("ir.model.fields.selection", "search_read", { domain, fields: ["value"] });
if (!choices.length) {
  await call("ir.model.fields.selection", "create", {
    vals_list: [{ field_id: field.id, value: "Suspended", name: "Suspended", sequence: 3 }],
  });
}
choices = await call("ir.model.fields.selection", "search_read", { domain, fields: ["value"] });
if (!choices.length) throw new Error("Suspended status was not persisted.");
console.log("Verified Suspended status is available in Odoo.");
