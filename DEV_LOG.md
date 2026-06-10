# Dev Log

## 2026-04-24 Odoo Capability Guard

- Added one-time Odoo model/field discovery for live scoring.
- Stopped optional game-flow, detail-stat, and event-feed reads/writes when the backing fields or `x_game_event` model are not present.
- Kept core score, period points, total points, and foul writes active while unsupported detail stats stay local.
- Verified with `npm run build`.

## 2026-04-24 Scorer Workflow Pass

- Added a match picker backed by `x_game` records, with live refresh still respecting `VITE_LIVE_GAME_ID`.
- Added explicit player selection through both roster rows and the scorer console player menu.
- Reworked court input so taps classify the shot location as 2PT or 3PT, then log made/missed shots against the selected player.
- Added shooting-foul support that records the correct free throw makes/attempts and adds made free throws to the score.
- Added direct free throw made/missed controls, period selection, and a stat console for assists, rebounds, steals, blocks, turnovers, personal fouls, technical fouls, and substitutions.
- Extended optimistic local updates so player points, period points, fouls, attempts, makes, rebounds, assists, steals, blocks, and turnovers update immediately.
- Added optional persistence for detail stat fields and `x_game_event`; the app falls back to core score/stat writes if those fields do not exist yet.
- Added `scripts/add-scoring-fields.mjs` and `npm run odoo:add-scoring-fields` to create the recommended scoring fields and event model idempotently.
- Removed the fixed page minimum width and rebuilt the dashboard grid so it adapts from mobile/tablet to the full scorer-board layout.
- Verified with `npm run build`.

## 2026-04-24 Live Data Stability Pass

- Removed all sample team, player, score, and event data from the fallback match object.
- Changed real-game normalization so empty event feeds stay empty instead of borrowing sample events.
- Changed refresh handling so API results replace stale events instead of preserving old sample events from hot reload state.
- Increased the default/minimum polling interval to 15 seconds and updated `.env` from `5000` to `15000`.
- Added refresh overlap protection and a 30-second pause after API `429` responses.
- Removed React StrictMode in dev to avoid duplicate mount-time API reads against the live service.
- Verified with `npm run build`.

## 2026-04-24

- Added an Odoo Online-aware API layer for the basketball app.
- Supported two transports:
  - `legacy`: `/jsonrpc` with database, username, and API key. This is the default for current Odoo Online compatibility.
  - `json2`: `/json/2/<model>/<method>` with bearer API key for newer instances that expose JSON-2.
- Mapped the exported Studio models and fields:
  - `x_game`: match name, teams, scores, date, location, status, week, stats relation.
  - `x_team`: team name, category, gender, image, players, record totals.
  - `x_player`: name, jersey number, position, team, total points.
  - `x_player_game_stat`: game, player, team relation, Q1-Q4, OT, fouls, total points.
- Refactored the dashboard to load the live game by `VITE_LIVE_GAME_ID`, or auto-load the latest game with `x_studio_status = Live`.
- Added polling with `VITE_MATCH_POLL_MS`.
- Added optimistic action logging:
  - Made shot updates the game score and player period/total points.
  - Personal/technical foul updates player fouls.
  - Actions without matching fields are retained in the UI log and report that detail fields are needed.
- Added a visible Dev Log panel to the dashboard with neutral data-link language and no backend/vendor name in user-facing match UI.
- Added `.env.example` for local connection setup.
- Added optional same-origin proxy routing through `VITE_ODOO_PROXY_PATH=/odoo` to avoid browser CORS issues during live scoring.
- Verified with `npm run build`.

## Odoo Online Setup Notes

- External API access depends on the Odoo Online plan. Odoo documentation says it is available on Custom plans and not on One App Free or Standard plans.
- For `legacy` mode, create an API key for the scorekeeper user and use it as `VITE_ODOO_API_KEY`. The username remains the user's login.
- For `json2` mode, set `VITE_ODOO_API_MODE=json2` and use a bearer API key.
- For local Vite testing, set `VITE_ODOO_PROXY_PATH=/odoo`; the Vite dev server proxies `/odoo` to `VITE_ODOO_URL`.
- For production, avoid shipping a long-lived API key directly in a public browser bundle. Put a small server/proxy in front of Odoo Online and expose only the minimal match endpoints to the scoreboard app. Configure that proxy to serve the same `/odoo` path or change `VITE_ODOO_PROXY_PATH`.

## Recommended Fields To Add

These additions would make live matches cleaner and reduce local-only state:

- On `x_game`:
  - `x_studio_period` integer or selection for Q1-Q4/OT.
  - `x_studio_game_clock_seconds` integer for the game clock.
  - `x_studio_shot_clock_seconds` integer for the shot clock.
  - `x_studio_possession_team` many2one to `x_team`.
  - `x_studio_home_timeouts` and `x_studio_away_timeouts` integer.
  - `x_studio_home_team_fouls` and `x_studio_away_team_fouls` integer, ideally per period if possible.
- On `x_player_game_stat`:
  - `x_studio_assists`, `x_studio_off_rebounds`, `x_studio_def_rebounds`.
  - `x_studio_steals`, `x_studio_blocks`, `x_studio_turnovers`.
  - `x_studio_ftm`, `x_studio_fta`, `x_studio_2pm`, `x_studio_2pa`, `x_studio_3pm`, `x_studio_3pa`.
  - `x_studio_minutes_played`.
- New model `x_game_event`:
  - Game, team, player, period, clock seconds, action type, points, score after action, note.
  - This would persist the Recent Events feed instead of keeping it local in the browser.
- On `x_player`:
  - `x_studio_roster_status` selection for active, bench, injured, unavailable.
  - `x_studio_starting_five` boolean for match setup.
