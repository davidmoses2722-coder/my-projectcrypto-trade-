/**
 * src/config/urls.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH for all backend URLs.
 *
 * ❌ NEVER hardcode "http://localhost:3001" or "http://localhost:3002" anywhere.
 *    Always import from here.
 *
 * ✅ To override for production / VPS deploy, set in root .env:
 *    VITE_SERVER_URL=https://your-vps.example.com:3001
 *    VITE_PYTHON_URL=https://your-vps.example.com:3002
 *
 * Rules:
 *  • Strip trailing slash so paths like "/api/status" work cleanly.
 *  • Fall back to localhost only when env var is absent/empty.
 *  • Export both raw URL strings AND a helper that converts http→ws / https→wss.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Raw URL strings ──────────────────────────────────────────────────────────

/** Trading API server. Defaults to same-origin (api-server artifact mounted at /api). */
export const SERVER_URL: string = (
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? ""
).replace(/\/$/, "");

/** Python CCXT bot server  (server/python/bot.py → port 3002) */
export const PYTHON_URL: string = (
  (import.meta.env.VITE_PYTHON_URL as string | undefined) ?? ""
).replace(/\/$/, "") || "http://localhost:3002";

// ── WebSocket URL helpers ────────────────────────────────────────────────────

/**
 * Convert an http/https URL to its ws/wss equivalent.
 * e.g.  "https://vps.example.com:3001" → "wss://vps.example.com:3001"
 *       "http://localhost:3001"         → "ws://localhost:3001"
 */
export function toWsUrl(httpUrl: string): string {
  return httpUrl
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i,  "ws://");
}

/** WebSocket URL for the Node.js server */
export const SERVER_WS_URL: string = toWsUrl(SERVER_URL);

/** WebSocket URL for the Python server */
export const PYTHON_WS_URL: string = toWsUrl(PYTHON_URL);

// ── Display helpers ──────────────────────────────────────────────────────────

/** Short display label — strips protocol for clean UI display */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

/** true when a non-default SERVER_URL is configured (i.e. a real VPS) */
export const isServerRemote: boolean =
  !!import.meta.env.VITE_SERVER_URL && !SERVER_URL.includes("localhost");

/** true when a non-default PYTHON_URL is configured */
export const isPythonRemote: boolean =
  !!import.meta.env.VITE_PYTHON_URL && !PYTHON_URL.includes("localhost");
