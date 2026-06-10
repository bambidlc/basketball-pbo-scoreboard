/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIVE_GAME_ID?: string;
  readonly VITE_MATCH_POLL_MS?: string;
  readonly VITE_ODOO_API_KEY?: string;
  readonly VITE_ODOO_API_MODE?: "legacy" | "json2";
  readonly VITE_ODOO_DB?: string;
  readonly VITE_ODOO_MAX_RETRIES?: string;
  readonly VITE_ODOO_PASSWORD?: string;
  readonly VITE_ODOO_PROXY_PATH?: string;
  readonly VITE_ODOO_REQUEST_DELAY_MS?: string;
  readonly VITE_ODOO_URL?: string;
  readonly VITE_ODOO_USERNAME?: string;
}
