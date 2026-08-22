/**
 * Exchange Market Data Service — Gate.io V4
 * ─────────────────────────────────────────────────────────────────────────────
 * Public market data feed for display and signal generation.
 *   • Public WS  → wss://api.gateio.ws/ws/v4/  (real-time tickers, no auth)
 *   • Public REST → https://api.gateio.ws/api/v4 (CORS-open spot endpoints)
 *   • Private orders → executed server-side via Gate.io (no browser CORS)
 *
 * Reconnection strategy:
 *   • Exponential back-off: 5 s → 10 s → 20 s → 30 s (capped)
 *   • Clean close() before every reconnect — prevents ghost stacking
 *   • Watchdog: force-close if no message for 40 s
 *
 * Symbol convention:
 *   - SYMBOL_MAP keeps "BTCUSDT" style so the existing UI
 *     (which strips "USDT" for display) keeps working unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Static env-var keys (kept for compatibility — UI reads these) ────────────
export const BINANCE_API_KEY    = import.meta.env.VITE_BINANCE_API_KEY    || "";
export const BINANCE_SECRET_KEY = import.meta.env.VITE_BINANCE_SECRET_KEY || "";
export const hasValidBinanceKeys: boolean =
  !!BINANCE_API_KEY &&
  BINANCE_API_KEY    !== "your_key" &&
  !!BINANCE_SECRET_KEY &&
  BINANCE_SECRET_KEY !== "your_secret";

// ─── Key accessors (kept for compatibility with existing code) ────────────────
export function getBinanceApiKey(): string  { return BINANCE_API_KEY; }
export function getBinanceSecretKey(): string { return BINANCE_SECRET_KEY; }
export const checkBinanceKeys = (): boolean => hasValidBinanceKeys;

// ─── Endpoints (Gate.io V4) ───────────────────────────────────────────────────
const REST_BASE = "https://api.gateio.ws";
export const WS_BASE = "wss://api.gateio.ws/ws/v4/";

// ─── Symbol map (Binance-style for display compatibility) ─────────────────────
export const SYMBOL_MAP: Record<string, string> = {
  BTC:  "BTCUSDT",
  ETH:  "ETHUSDT",
  BNB:  "BNBUSDT",
  SOL:  "SOLUSDT",
  XRP:  "XRPUSDT",
  ADA:  "ADAUSDT",
  AVAX: "AVAXUSDT",
  DOGE: "DOGEUSDT",
};

// "BTCUSDT" → "BTC_USDT"  |  "BTC_USDT" → "BTCUSDT"
function toGate(symbol: string): string {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) + "_USDT" : symbol;
}
function fromGate(pair: string): string {
  return pair.replace("_", "");
}

// Backwards-compat aliases (used by useLivePrices)
export const toOkx   = toGate;
export const fromOkx = fromGate;

// ─── Types (kept for compatibility) ──────────────────────────────────────────
export interface BinanceTicker {
  symbol:             string;
  priceChange:        string;
  priceChangePercent: string;
  lastPrice:          string;
  highPrice:          string;
  lowPrice:           string;
  volume:             string;
  quoteVolume:        string;
}
export interface BinanceKline {
  openTime:  number;
  open:      string;
  high:      string;
  low:       string;
  close:     string;
  volume:    string;
  closeTime: number;
}
export interface BinanceLivePriceResult {
  symbol:           string;
  price:            number;
  change24h:        number;
  changePercent24h: number;
  high24h:          number;
  low24h:           number;
  volume24h:        number;
  sparkline:        number[];
}
export interface BinanceBalance { asset: string; free: string; locked: string; }
export interface BinanceAccountInfo {
  balances:        BinanceBalance[];
  canTrade:        boolean;
  canWithdraw:     boolean;
  canDeposit:      boolean;
  accountType:     string;
  totalAssetOfBtc: string;
}
export interface BinanceOrderResult {
  symbol:              string;
  orderId:             number;
  side:                string;
  type:                string;
  status:              string;
  executedQty:         string;
  cummulativeQuoteQty: string;
  price:               string;
  transactTime:        number;
}
export interface BinanceOrderBookRaw {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}
export interface BinanceRecentTrade {
  id:           number;
  price:        string;
  qty:          string;
  quoteQty:     string;
  time:         number;
  isBuyerMaker: boolean;
}
export interface PingResult {
  ok:         boolean;
  latencyMs?: number;
  method:     string;
  serverTime?: number;
  error?:     string;
}

// ─── WebSocket stream manager — Gate.io V4 public spot tickers ────────────────
export interface WsTickerData {
  symbol:           string;
  price:            number;
  change24h:        number;
  changePercent24h: number;
  high24h:          number;
  low24h:           number;
  volume24h:        number;
}
type WsTickerCallback = (data: WsTickerData[]) => void;

let _wsSocket:         WebSocket | null = null;
let _wsCallback:       WsTickerCallback | null = null;
let _wsReconnectTimer: ReturnType<typeof setTimeout>  | null = null;
let _wsPingTimer:      ReturnType<typeof setInterval> | null = null;
let _wsWatchdog:       ReturnType<typeof setInterval> | null = null;
let _wsConnected       = false;

export function isWsConnected(): boolean {
  return _wsConnected;
}

export function subscribeToTickers(onData: WsTickerCallback): () => void {
  _wsCallback = onData;

  const pairs = Object.values(SYMBOL_MAP).map(toGate);

  // Reconnection state
  let reconnDelay = 5_000;           // 5 s → 10 s → 20 s → 30 s max
  let lastMsgTime = Date.now();
  let destroyed   = false;

  function clearTimers() {
    if (_wsPingTimer)      { clearInterval(_wsPingTimer);      _wsPingTimer  = null; }
    if (_wsWatchdog)       { clearInterval(_wsWatchdog);       _wsWatchdog   = null; }
    if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer);  _wsReconnectTimer = null; }
  }

  function scheduleReconnect() {
    if (destroyed) return;
    if (_wsReconnectTimer) clearTimeout(_wsReconnectTimer);
    console.warn(`[Market WS] Reconnecting in ${reconnDelay / 1000}s…`);
    _wsReconnectTimer = setTimeout(() => {
      // Exponential back-off: 5s → 10s → 20s → 30s
      reconnDelay = Math.min(reconnDelay * 2, 30_000);
      connect(); // eslint-disable-line @typescript-eslint/no-use-before-define
    }, reconnDelay);
  }

  function connect() {
    // ── 1. Explicitly close any stale socket before creating a new one ────────
    if (_wsSocket) {
      const stale = _wsSocket;
      stale.onclose   = null; // suppress its onclose so it doesn't re-schedule
      stale.onerror   = null;
      stale.onmessage = null;
      try { stale.close(1000, "reconnect"); } catch { /* ignore */ }
      _wsSocket = null;
    }
    clearTimers();
    if (destroyed) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(WS_BASE);
    } catch (e) {
      console.error("[Market WS] ❌ Constructor failed:", e);
      scheduleReconnect();
      return;
    }
    _wsSocket = socket;

    // ── onopen ────────────────────────────────────────────────────────────────
    socket.onopen = () => {
      if (destroyed) { socket.close(1000, "destroyed"); return; }

      _wsConnected = true;
      reconnDelay  = 5_000; // reset backoff on success
      lastMsgTime  = Date.now();
      console.info("[Market WS] ✅ Gate.io connected — subscribing to tickers");

      // Gate.io v4 subscribe
      try {
        socket.send(JSON.stringify({
          time:    Math.floor(Date.now() / 1000),
          channel: "spot.tickers",
          event:   "subscribe",
          payload: pairs,
        }));
      } catch (e) { console.warn("[Market WS] subscribe send failed", e); }

      // Keepalive ping every 20 s
      _wsPingTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.ping" }));
        } catch { /* ignore */ }
      }, 20_000);

      // Watchdog — force reconnect if no data for 40 s
      _wsWatchdog = setInterval(() => {
        if (Date.now() - lastMsgTime > 40_000 && socket.readyState === WebSocket.OPEN) {
          console.warn("[Market WS] ⚠️ No data for 40 s — forcing reconnect");
          try { socket.close(4000, "stale"); } catch { /* ignore */ }
        }
      }, 10_000);
    };

    // ── onmessage ─────────────────────────────────────────────────────────────
    socket.onmessage = (evt) => {
      try {
        const raw = JSON.parse(evt.data as string);

        // Gate.io control frames — pong, subscribe ack
        if (raw?.channel === "spot.pong")    return;
        if (raw?.event   === "subscribe")    return;
        if (raw?.event   === "unsubscribe")  return;
        if (raw?.channel !== "spot.tickers") return;
        if (raw?.event   !== "update")       return;

        const d = raw.result;
        if (!d?.currency_pair) return;

        const symBin    = fromGate(String(d.currency_pair));
        const ourSymbol = Object.entries(SYMBOL_MAP).find(([, v]) => v === symBin)?.[0];
        if (!ourSymbol) return;

        const price     = parseFloat(d.last ?? "0");
        if (!price)     return;

        const pctRaw    = parseFloat(d.change_percentage ?? "0");
        const changePct = isNaN(pctRaw) ? 0 : pctRaw;

        lastMsgTime = Date.now();

        if (_wsCallback) {
          _wsCallback([{
            symbol:           ourSymbol,
            price,
            change24h:        price * changePct / 100,
            changePercent24h: changePct,
            high24h:          parseFloat(d.high_24h ?? "0") || price,
            low24h:           parseFloat(d.low_24h  ?? "0") || price,
            volume24h:        parseFloat(d.quote_volume ?? d.base_volume ?? "0"),
          }]);
        }
      } catch { /* malformed frame — ignore */ }
    };

    // ── onerror ───────────────────────────────────────────────────────────────
    // MUST call socket.close() — this guarantees onclose fires in all browsers.
    socket.onerror = (evt) => {
      console.warn("[Market WS] ⚠️ Error — closing to trigger onclose", evt);
      try { socket.close(4000, "client-error"); } catch { /* ignore */ }
    };

    // ── onclose — reconnect guarantee ─────────────────────────────────────────
    socket.onclose = () => {
      _wsConnected = false;
      clearTimers();
      if (_wsSocket === socket) _wsSocket = null;
      if (!destroyed) scheduleReconnect();
    };
  }

  connect();

  // ─── Unsubscribe / cleanup ──────────────────────────────────────────────────
  return () => {
    destroyed   = true;
    _wsCallback = null;
    clearTimers();
    if (_wsSocket) {
      const s = _wsSocket;
      _wsSocket = null;
      s.onclose   = null;
      s.onerror   = null;
      s.onmessage = null;
      try { s.close(1000, "destroy"); } catch { /* ignore */ }
    }
    _wsConnected = false;
  };
}

// ─── Safe fetch with timeout ─────────────────────────────────────────────────
function fetchWithTimeout(url: string, options: RequestInit = {}, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

// ─── Gate.io REST GET (public, no auth, CORS-open) ───────────────────────────
async function gateGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${REST_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetchWithTimeout(url.toString(), {}, 9000);
  if (!res.ok) throw new Error(`Gate.io ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE TRADING STUBS — require a server proxy (no CORS on private Gate.io API)
// ─────────────────────────────────────────────────────────────────────────────
const NEEDS_SERVER =
  "Live order execution requires the server-side bot (not yet enabled in this " +
  "preview). Until then the bot runs in paper / signal-only mode.";

export async function order(_side: "BUY" | "SELL", _qty: number): Promise<BinanceOrderResult> {
  throw new Error(NEEDS_SERVER);
}
export function size(balance: number, price: number): number {
  return parseFloat(((balance * 0.01) / price).toFixed(6));
}
export async function placeMarketOrder(_symbol: string, _side: "BUY" | "SELL", _quoteOrderQty: number): Promise<BinanceOrderResult> {
  throw new Error(NEEDS_SERVER);
}
export async function cancelOrder(_symbol: string, _orderId: number): Promise<unknown> {
  throw new Error(NEEDS_SERVER);
}
export async function fetchAccountInfo(): Promise<BinanceAccountInfo> {
  throw new Error(NEEDS_SERVER);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC MARKET DATA (Gate.io V4 spot, no auth needed)
// ─────────────────────────────────────────────────────────────────────────────

interface GateTicker {
  currency_pair:     string;
  last:              string;
  change_percentage: string;
  high_24h:          string;
  low_24h:           string;
  base_volume:       string;
  quote_volume:      string;
}

export async function fetchTickers(symbols: string[]): Promise<BinanceLivePriceResult[]> {
  const wantedBin = new Set(symbols.map((s) => SYMBOL_MAP[s]).filter(Boolean));
  let list: GateTicker[];
  try {
    list = await gateGet<GateTicker[]>("/api/v4/spot/tickers");
  } catch {
    return [];
  }

  const results: BinanceLivePriceResult[] = [];
  for (const t of list) {
    const symBin    = fromGate(t.currency_pair);
    if (!wantedBin.has(symBin)) continue;
    const ourSymbol = Object.entries(SYMBOL_MAP).find(([, v]) => v === symBin)?.[0];
    if (!ourSymbol) continue;

    const price  = parseFloat(t.last ?? "0");
    const pct    = parseFloat(t.change_percentage ?? "0");
    const change = isNaN(pct) ? 0 : price * pct / 100;

    let sparkline: number[] = [];
    try {
      // Gate.io candles: [unix_ts_sec, quote_volume, close, high, low, open, ...]
      const candles = await gateGet<string[][]>("/api/v4/spot/candlesticks", {
        currency_pair: t.currency_pair, interval: "1h", limit: "24",
      });
      sparkline = (candles ?? []).map((c) => parseFloat(c[2])); // c[2] = close
    } catch { sparkline = []; }

    results.push({
      symbol:           ourSymbol,
      price,
      change24h:        change,
      changePercent24h: isNaN(pct) ? 0 : pct,
      high24h:          parseFloat(t.high_24h) || price,
      low24h:           parseFloat(t.low_24h)  || price,
      volume24h:        parseFloat(t.quote_volume || t.base_volume) || 0,
      sparkline,
    });
  }
  return results;
}

export async function fetchSinglePrice(symbol: string): Promise<number> {
  const sym = SYMBOL_MAP[symbol];
  if (!sym) throw new Error(`Unknown symbol: ${symbol}`);
  const list = await gateGet<GateTicker[]>("/api/v4/spot/tickers", { currency_pair: toGate(sym) });
  const first = list?.[0];
  if (!first) throw new Error(`No ticker for ${sym}`);
  return parseFloat(first.last);
}

export async function fetchSparkline(
  symbol:   string,
  interval = "15m",
  limit    = 24
): Promise<number[]> {
  const sym = SYMBOL_MAP[symbol];
  if (!sym) return [];
  const intervalMap: Record<string, string> = {
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "4h": "4h", "8h": "8h", "1d": "1d",
  };
  const iv = intervalMap[interval] || "15m";
  try {
    const candles = await gateGet<string[][]>("/api/v4/spot/candlesticks", {
      currency_pair: toGate(sym), interval: iv, limit: String(limit),
    });
    return (candles ?? []).map((c) => parseFloat(c[2])); // c[2] = close
  } catch { return []; }
}

export async function pingBinance(): Promise<PingResult> {
  if (isWsConnected()) {
    return { ok: true, latencyMs: 0, method: "WebSocket (live stream active)" };
  }
  try {
    const t0  = Date.now();
    const res = await fetchWithTimeout(`${REST_BASE}/api/v4/spot/time`, {}, 5000);
    const json = await res.json() as { server_time?: number };
    return {
      ok: true,
      latencyMs: Date.now() - t0,
      method: "Gate.io REST (public)",
      serverTime: json.server_time,
    };
  } catch (e) {
    return { ok: false, method: "Gate.io REST", error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function getBinanceServerTime(): Promise<number> {
  const json = await gateGet<{ server_time?: number }>("/api/v4/spot/time");
  return json.server_time ?? Date.now();
}

// ─── Order Book ───────────────────────────────────────────────────────────────
interface GateOrderBook {
  id?:    number;
  current?: number;
  asks:   [string, string][];
  bids:   [string, string][];
}

export async function fetchOrderBook(
  symbol: string,
  limit:  number = 50
): Promise<BinanceOrderBookRaw> {
  const sym = SYMBOL_MAP[symbol];
  if (!sym) throw new Error(`Unknown symbol: ${symbol}`);
  const sz = Math.min(Math.max(limit, 1), 100);
  const ob = await gateGet<GateOrderBook>("/api/v4/spot/order_book", {
    currency_pair: toGate(sym),
    limit: String(sz),
  });
  return {
    lastUpdateId: ob.id ?? ob.current ?? Date.now(),
    bids: ob.bids ?? [],
    asks: ob.asks ?? [],
  };
}

// ─── Recent Trades ────────────────────────────────────────────────────────────
interface GateTrade {
  id:              string;
  create_time:     string;
  create_time_ms:  string;
  currency_pair:   string;
  side:            "buy" | "sell";
  amount:          string;
  price:           string;
}

export async function fetchRecentTrades(
  symbol: string,
  limit = 60
): Promise<BinanceRecentTrade[]> {
  const sym = SYMBOL_MAP[symbol];
  if (!sym) throw new Error(`Unknown symbol: ${symbol}`);
  const safeLimit = Math.min(Math.max(limit, 1), 1000);
  const data = await gateGet<GateTrade[]>("/api/v4/spot/trades", {
    currency_pair: toGate(sym),
    limit: String(safeLimit),
  });
  return (data ?? []).map((t, i) => {
    const price = parseFloat(t.price);
    const qty   = parseFloat(t.amount);
    return {
      id:           Number(t.id) || Date.now() + i,
      price:        t.price,
      qty:          t.amount,
      quoteQty:     (price * qty).toString(),
      time:         t.create_time_ms ? parseInt(t.create_time_ms, 10) : parseInt(t.create_time, 10) * 1000,
      isBuyerMaker: t.side === "sell",
    };
  });
}
