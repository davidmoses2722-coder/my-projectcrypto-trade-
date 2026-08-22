/// <reference types="vite/client" />

interface ImportMetaEnv {
  // ── Binance (browser-side public endpoints only — private calls go via server) ──
  readonly VITE_BINANCE_API_KEY:    string;
  readonly VITE_BINANCE_SECRET_KEY: string;

  // ── Telegram (browser-side alerts) ────────────────────────────────────────────
  readonly VITE_TELEGRAM_TOKEN:  string;
  readonly VITE_TELEGRAM_CHAT_ID: string;

  // ── Backend server URLs ───────────────────────────────────────────────────────
  /**
   * Node.js Express bot server URL (server/index.js)
   * Default (if not set): http://localhost:3001
   * For VPS: VITE_SERVER_URL=https://your-vps.example.com:3001
   */
  readonly VITE_SERVER_URL: string;

  /**
   * Python CCXT bot server URL (server/python/bot.py)
   * Default (if not set): http://localhost:3002
   * For VPS: VITE_PYTHON_URL=https://your-vps.example.com:3002
   */
  readonly VITE_PYTHON_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
