// Isolated browser verification: npm exec -- node scripts/preview-game-workflow.mjs
// In-memory fixtures only; this server never connects to Odoo.
import { createServer } from "vite";

const games = Array.from({ length: 18 }, (_, index) => ({
  id: 90001 + index,
  x_name: `Preview game ${index + 1}`,
  x_studio_match_name: `Falcons vs Lions ${index + 1}`,
  x_studio_away_team: [1, "Falcons"], x_studio_home_team: [2, "Lions"],
  x_studio_datetime: `2026-09-${index < 12 ? "06" : "12"} ${String(10 + index % 8).padStart(2, "0")}:00:00`,
  x_studio_location: index < 8 ? "Central Court" : "Riverside Court",
  x_studio_status: "Scheduled", x_studio_away_score: 0, x_studio_home_score: 0,
}));
const teams = [{ id: 1, x_name: "Falcons" }, { id: 2, x_name: "Lions" }];
const events = [];
let failWrites = false;
const server = await createServer({
  server: { host: "127.0.0.1", port: 5174, strictPort: true, proxy: {} },
  define: Object.fromEntries(Object.entries({
    VITE_ODOO_PROXY_PATH: "/fixture", VITE_ODOO_API_MODE: "json2", VITE_ODOO_API_KEY: "fixture",
    VITE_ODOO_DB: "fixture", VITE_ODOO_USERNAME: "", VITE_LIVE_GAME_ID: "90001", VITE_ODOO_REQUEST_DELAY_MS: "0",
    VITE_ODOO_MAX_RETRIES: "1",
  }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
  plugins: [{ name: "game-workflow-fixture", configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/fixture")) return next();
      res.setHeader("Content-Type", "application/json");
      const reply = value => res.end(JSON.stringify(value));
      if (req.url === "/fixture/fail") { failWrites = true; return reply(true); }
      if (req.url === "/fixture/recover") { failWrites = false; return reply(true); }
      if (req.url === "/fixture/state") return reply({ games, events });
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      const [, model, method] = req.url.match(/\/json\/2\/([^/]+)\/([^/]+)/) || [];
      if (model?.startsWith("ir.")) { res.statusCode = 403; return reply({ message: "Optional metadata disabled in fixture" }); }
      const rows = model === "x_game" ? games : model === "x_team" ? teams : model === "x_game_event" ? events : [];
      const filtered = rows.filter(row => (!body.ids || body.ids.includes(row.id)) && (body.domain || []).every(term => {
        if (!Array.isArray(term)) return true;
        const [key, operator, value] = term;
        const actual = Array.isArray(row[key]) ? row[key][0] : row[key];
        if (operator === "=") return actual === value;
        if (operator === "in") return value.includes(actual);
        if (operator === ">=") return actual >= value;
        return true;
      }));
      if (method === "read" || method === "search_read") return reply(filtered);
      if (failWrites) { res.statusCode = 503; return reply({ message: "Simulated connection interruption" }); }
      if (method === "write") { filtered.forEach(row => Object.assign(row, body.vals)); return reply(true); }
      if (method === "create" && model === "x_game_event") {
        const ids = body.vals_list.map(values => { const id = 91000 + events.length; events.push({ id, ...values, x_studio_game: [values.x_studio_game, "Game"] }); return id; });
        return reply(ids);
      }
      return reply([]);
    });
  } }],
});
await server.listen();
console.log("Isolated game workflow preview: http://127.0.0.1:5174");
