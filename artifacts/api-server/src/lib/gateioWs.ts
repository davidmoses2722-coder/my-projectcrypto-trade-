/**
 * gateioWs.ts — Gate.io public WebSocket market data client.
 *
 * Provides real-time ticker and candlestick data via Gate.io's spot
 * WebSocket API (wss://api.gateio.ws/ws/v4/).
 *
 * Features:
 *  • connect() / reconnect()         — establish or restart the connection
 *  • subscribeTicker(symbol)         — real-time last/bid/ask price stream
 *  • subscribeCandles(symbol, int)   — OHLCV candle stream
 *  • getConnectionStatus()           — "disconnected" | "connecting" | "connected" | "error"
 *  • getLastTicker(symbol)           — most recent cached ticker snapshot
 *  • getLastCandles(symbol, int)     — cached candle list (rolling 500-bar window)
 *  • Auto-reconnect with exponential backoff (capped at 60 s)
 *  • Heartbeat: responds to server pings, sends proactive client pings every 20 s
 *  • No duplicate subscriptions — tracked per channel key
 *
 * Fallback contract:
 *   getLastTicker() returns null when disconnected or no data has arrived yet.
 *   Callers (exchangeService.getTicker) detect null and fall back to REST.
 *
 * Uses the Node.js 22+ built-in WebSocket — no extra packages needed.
 */

import { logger } from "./logger";

// ─── Constants ────────────────────────────────────────────────────────────────

const WS_URL              = "wss://api.gateio.ws/ws/v4/";
const CONNECT_TIMEOUT_MS  = 10_000;   // abort connect attempt after 10 s
const PING_INTERVAL_MS    = 20_000;   // proactive client ping every 20 s
const TICKER_MAX_AGE_MS   = 10_000;   // cached ticker treated as stale after 10 s
const RECONNECT_BASE_MS   = 1_000;    // first retry after 1 s
const RECONNECT_MAX_MS    = 60_000;   // backoff cap
const CANDLE_WINDOW       = 500;      // rolling window per symbol+interval

// ─── Public types ─────────────────────────────────────────────────────────────

export type WsStatus = "disconnected" | "connecting" | "connected" | "error";

export interface WsTickerData {
  symbol:    string;   // Gate.io format: "BTC_USDT"
  last:      number;
  bid:       number;
  ask:       number;
  open24h:   number;
  high24h:   number;
  low24h:    number;
  volume24h: number;
  updatedAt: number;   // unix ms — used for staleness check
}

export interface WsCandleData {
  openTime: number;    // unix ms
  open:     number;
  high:     number;
  low:      number;
  close:    number;
  volume:   number;
  interval: string;    // "1m", "5m", "1h", …
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert any common symbol format to Gate.io WS format: "BTC_USDT" */
function normalise(symbol: string): string {
  return symbol.replace(/[/: ]/g, "_").toUpperCase();
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── GateioWsClient ───────────────────────────────────────────────────────────

class GateioWsClient {
  private ws:                WebSocket | null = null;
  private _status:           WsStatus = "disconnected";
  private reconnectAttempts  = 0;
  private reconnectTimer:    NodeJS.Timeout | null = null;
  private pingTimer:         NodeJS.Timeout | null = null;
  private destroyed          = false;

  // Per-channel subscription tracking (prevents duplicate SUBSCRIBEs)
  private tickerSubs = new Set<string>();         // normalised symbol
  private candleSubs = new Set<string>();         // "interval:symbol"

  // Market-data caches
  private tickerCache = new Map<string, WsTickerData>();
  private candleCache = new Map<string, WsCandleData[]>(); // key = "interval:symbol"

  // ── Public: status & getters ────────────────────────────────────────────────

  getConnectionStatus(): WsStatus {
    return this._status;
  }

  isConnected(): boolean {
    return this._status === "connected";
  }

  getLastTicker(symbol: string): WsTickerData | null {
    return this.tickerCache.get(normalise(symbol)) ?? null;
  }

  isFreshTicker(symbol: string): boolean {
    const t = this.tickerCache.get(normalise(symbol));
    return t != null && Date.now() - t.updatedAt < TICKER_MAX_AGE_MS;
  }

  getLastCandles(symbol: string, interval: string): WsCandleData[] | null {
    return this.candleCache.get(`${interval}:${normalise(symbol)}`) ?? null;
  }

  // ── Public: connect ─────────────────────────────────────────────────────────

  connect(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this._status === "connecting" || this._status === "connected") {
      return Promise.resolve();
    }

    this._status = "connecting";
    this.clearReconnectTimer();

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Gate.io WS connect timeout (>${CONNECT_TIMEOUT_MS}ms)`));
        this._closeSocket();
      }, CONNECT_TIMEOUT_MS);

      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch (err) {
        clearTimeout(timeout);
        this._status = "error";
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        clearTimeout(timeout);
        this._status = "connected";
        this.reconnectAttempts = 0;
        logger.info("gateioWs: connected to Gate.io market feed");
        this.startPing();
        this.resubscribeAll();
        if (!settled) { settled = true; resolve(); }
      };

      ws.onerror = () => {
        // onerror always fires before onclose — just flag the state.
        // The actual cleanup and reconnect is handled in onclose.
        this._status = "error";
        logger.warn("gateioWs: WebSocket error event");
      };

      ws.onclose = (ev) => {
        clearTimeout(timeout);
        const wasConnecting = !settled;
        settled = true;

        this.stopPing();
        const prevStatus = this._status;
        this._status = "disconnected";
        this.ws = null;

        logger.warn(
          { code: ev.code, reason: ev.reason || "(none)", prevStatus },
          "gateioWs: connection closed",
        );

        if (!this.destroyed) {
          this.scheduleReconnect();
        }

        if (wasConnecting) {
          reject(new Error(`Gate.io WS closed before open (code ${ev.code})`));
        }
      };

      ws.onmessage = (ev) => {
        this.handleMessage(typeof ev.data === "string" ? ev.data : String(ev.data));
      };
    });
  }

  // ── Public: reconnect ───────────────────────────────────────────────────────

  async reconnect(): Promise<void> {
    logger.info({ attempt: this.reconnectAttempts }, "gateioWs: reconnect() called");
    this._closeSocket();
    await this.connect().catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "gateioWs: reconnect failed — automatic retry scheduled",
      );
    });
  }

  // ── Public: subscribe ───────────────────────────────────────────────────────

  subscribeTicker(symbol: string): void {
    const sym = normalise(symbol);
    if (this.tickerSubs.has(sym)) return;
    this.tickerSubs.add(sym);
    if (this._status === "connected") {
      this.sendSubscribe("spot.tickers", [sym]);
    }
    // If not yet connected, resubscribeAll() fires after open
  }

  subscribeCandles(symbol: string, interval = "1m"): void {
    const sym = normalise(symbol);
    const key = `${interval}:${sym}`;
    if (this.candleSubs.has(key)) return;
    this.candleSubs.add(key);
    if (this._status === "connected") {
      this.sendSubscribe("spot.candlesticks", [interval, sym]);
    }
  }

  // ── Public: destroy ─────────────────────────────────────────────────────────

  destroy(): void {
    this.destroyed = true;
    this.stopPing();
    this.clearReconnectTimer();
    this._closeSocket();
  }

  // ── Private: message dispatch ───────────────────────────────────────────────

  private handleMessage(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw) as unknown;
    } catch {
      return; // Gate.io never sends non-JSON but guard anyway
    }
    if (typeof msg !== "object" || msg === null) return;
    const m       = msg as Record<string, unknown>;
    const channel = typeof m["channel"] === "string" ? m["channel"] : "";
    const event   = typeof m["event"]   === "string" ? m["event"]   : "";

    // ── Server ping → respond with pong ──────────────────────────────────────
    if (channel === "spot.ping") {
      this.send(JSON.stringify({ channel: "spot.pong" }));
      return;
    }

    // ── Subscription ack (subscribe / unsubscribe) ────────────────────────────
    if (event === "subscribe" || event === "unsubscribe") {
      const res    = m["result"];
      const status = typeof res === "object" && res !== null
        ? (res as Record<string, unknown>)["status"]
        : null;
      logger.debug({ channel, event, status }, "gateioWs: subscription ack");
      return;
    }

    // ── Ticker update ─────────────────────────────────────────────────────────
    if (channel === "spot.tickers" && event === "update") {
      this.handleTickerUpdate(m["result"]);
      return;
    }

    // ── Candle update ─────────────────────────────────────────────────────────
    if (channel === "spot.candlesticks" && event === "update") {
      this.handleCandleUpdate(m["result"]);
      return;
    }

    // ── Server error message ──────────────────────────────────────────────────
    if (typeof m["error"] === "object" && m["error"] !== null) {
      const e = m["error"] as Record<string, unknown>;
      logger.warn({ channel, code: e["code"], detail: e["message"] }, "gateioWs: server error");
      return;
    }
  }

  // ── Private: message parsers ────────────────────────────────────────────────

  private handleTickerUpdate(result: unknown): void {
    if (typeof result !== "object" || result === null) return;
    const r   = result as Record<string, unknown>;
    const sym = typeof r["currency_pair"] === "string" ? r["currency_pair"] : "";
    if (!sym) return;

    this.tickerCache.set(sym, {
      symbol:    sym,
      last:      parseFloat(String(r["last"]         ?? "0")),
      bid:       parseFloat(String(r["highest_bid"]  ?? r["bid"] ?? "0")),
      ask:       parseFloat(String(r["lowest_ask"]   ?? r["ask"] ?? "0")),
      open24h:   parseFloat(String(r["open_24h"]     ?? "0")),
      high24h:   parseFloat(String(r["high_24h"]     ?? "0")),
      low24h:    parseFloat(String(r["low_24h"]      ?? "0")),
      volume24h: parseFloat(String(r["base_volume"]  ?? "0")),
      updatedAt: Date.now(),
    });
  }

  private handleCandleUpdate(result: unknown): void {
    if (typeof result !== "object" || result === null) return;
    const r = result as Record<string, unknown>;

    // "n" field format: "1m_BTC_USDT"
    const nameField = typeof r["n"] === "string" ? r["n"] : "";
    const dashIdx   = nameField.indexOf("_");
    if (dashIdx < 0) return;
    const interval = nameField.slice(0, dashIdx);
    const sym      = nameField.slice(dashIdx + 1);
    const key      = `${interval}:${sym}`;

    const candle: WsCandleData = {
      openTime: parseInt(String(r["t"] ?? "0"), 10) * 1_000,
      open:     parseFloat(String(r["o"] ?? "0")),
      high:     parseFloat(String(r["h"] ?? "0")),
      low:      parseFloat(String(r["l"] ?? "0")),
      close:    parseFloat(String(r["c"] ?? "0")),
      volume:   parseFloat(String(r["v"] ?? "0")),
      interval,
    };

    const bars = this.candleCache.get(key) ?? [];
    const last  = bars.at(-1);
    if (last && last.openTime === candle.openTime) {
      bars[bars.length - 1] = candle; // update open (unclosed) candle in place
    } else {
      bars.push(candle);
      if (bars.length > CANDLE_WINDOW) bars.shift(); // rolling window
    }
    this.candleCache.set(key, bars);
  }

  // ── Private: send helpers ───────────────────────────────────────────────────

  private send(payload: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(payload);
      } catch (err) {
        logger.warn({ err }, "gateioWs: send failed");
      }
    }
  }

  private sendSubscribe(channel: string, payload: string[]): void {
    this.send(JSON.stringify({ time: nowSec(), channel, event: "subscribe", payload }));
  }

  // ── Private: re-subscribe on reconnect ─────────────────────────────────────

  private resubscribeAll(): void {
    for (const sym of this.tickerSubs) {
      this.sendSubscribe("spot.tickers", [sym]);
    }
    for (const key of this.candleSubs) {
      const idx      = key.indexOf(":");
      const interval = key.slice(0, idx);
      const sym      = key.slice(idx + 1);
      this.sendSubscribe("spot.candlesticks", [interval, sym]);
    }
  }

  // ── Private: heartbeat ──────────────────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this._status !== "connected") return;
      this.send(JSON.stringify({ time: nowSec(), channel: "spot.ping" }));
      logger.debug("gateioWs: ping sent");
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ── Private: reconnect with exponential backoff ─────────────────────────────

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    const jitter  = Math.random() * 500;
    const delay   = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts + jitter, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    logger.info(
      { attempt: this.reconnectAttempts, delayMs: Math.round(delay) },
      "gateioWs: scheduling reconnect",
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) {
        this.connect().catch((err: unknown) => {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "gateioWs: reconnect attempt failed — will retry",
          );
        });
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _closeSocket(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.onopen    = null;
      this.ws.onerror   = null;
      this.ws.onclose   = null;
      this.ws.onmessage = null;
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Singleton Gate.io WebSocket client — import and use anywhere in the server. */
export const gateioWs = new GateioWsClient();
