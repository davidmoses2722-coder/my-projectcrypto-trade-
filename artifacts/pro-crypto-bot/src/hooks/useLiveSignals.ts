/**
 * useLiveSignals — Gate.io V4 WebSocket
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CONNECTION GUARANTEE
 *   onerror  → socket.close()  → onclose ALWAYS fires
 *   onclose  → scheduleReconnect (exponential back-off)
 *   Backoff  → 5s → 10s → 20s → 30s max — resets on successful connect
 *
 * WATCHDOG
 *   If no Gate.io message arrives for 40 s, the socket is force-closed
 *   and the reconnect sequence begins cleanly.
 *
 * FALLBACK CHAIN
 *   1. Gate.io WSS  → wss://api.gateio.ws/ws/v4/  (real-time)
 *   2. Gate.io REST → https://api.gateio.ws/api/v4/spot/tickers (every 3 s)
 *   3. Mock sim     → always visible, never blank (while connecting)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ema, rsi, macd } from "../utils/indicators";
import { aiScore } from "../utils/indicators";

// ─── Types ────────────────────────────────────────────────────────────────────
export type SignalType   = "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
export type StreamStatus = "connecting" | "live" | "polling" | "reconnecting" | "offline";
export type DataSource   = "gateio-ws" | "gateio-rest" | "mock";

export interface LiveTicker {
  symbol:    string;
  price:     number;
  prevPrice: number;
  change24h: number;
  changePct: number;
  high24h:   number;
  low24h:    number;
  volume24h: number;
  rsi:       number;
  macd:      number;
  ema20:     number;
  ema50:     number;
  trend:     number;
  aiScore:   number;
  signal:    SignalType;
  strength:  number;
  tickCount: number;
  ts:        number;
}

export interface LiveSignal {
  symbol:    string;
  price:     number;
  changePct: number;
  signal:    SignalType;
  aiScore:   number;
  rsi:       number;
  macd:      number;
  trend:     number;
  ema20:     number;
  ema50:     number;
  strength:  number;
  ts:        number;
}

export interface WsStats {
  connectCount:    number;
  disconnectCount: number;
  reconnectCount:  number;
  lastConnectedAt: number;
  lastDisconnAt:   number;
  nextReconnectIn: number;
  currentDelay:    number;
  uptime:          number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SYMBOLS = [
  "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT",
  "XRPUSDT","ADAUSDT","AVAXUSDT","DOGEUSDT",
];

// Gate.io public WebSocket + REST (CORS-open, no auth)
const GATE_WS_URL       = "wss://api.gateio.ws/ws/v4/";
// Route through backend proxy to avoid CORS restriction from localhost/http origin.
// In production (HTTPS domain) the direct Gate.io REST URL also works.
const GATE_REST_TICKERS = "/api/market/tickers";

// "BTCUSDT" → "BTC_USDT"  |  "BTC_USDT" → "BTCUSDT"
const toGateInst   = (s: string) => s.endsWith("USDT") ? s.slice(0, -4) + "_USDT" : s;
const fromGateInst = (s: string) => s.replace("_", "");
const GATE_PAIRS   = SYMBOLS.map(toGateInst);

// ── Reconnection delays (ms) ──────────────────────────────────────────────────
const RECONNECT_INITIAL = 5_000;   // first retry — 5 s
const RECONNECT_MAX     = 30_000;  // cap at 30 s
const RECONNECT_FACTOR  = 2;       // 5 s → 10 s → 20 s → 30 s
const HEARTBEAT_MS      = 20_000;  // watchdog check interval
const STALE_THRESHOLD   = 40_000;  // force reconnect if no data for 40 s

// ─── Price history per symbol (needed for indicators) ────────────────────────
const PRICE_HISTORY: Record<string, number[]> = {};
SYMBOLS.forEach(s => { PRICE_HISTORY[s] = []; });

// ─── Seed mock prices ─────────────────────────────────────────────────────────
const MOCK_BASE: Record<string, number> = {
  BTCUSDT: 67500, ETHUSDT: 3520,  SOLUSDT: 178,  BNBUSDT: 608,
  XRPUSDT: 0.628, ADAUSDT: 0.489, AVAXUSDT: 39.2, DOGEUSDT: 0.162,
};

// ─── Compute signal from indicators ──────────────────────────────────────────
function computeSignal(
  prices: number[],
  price:  number,
  changePct: number,
): Pick<LiveTicker, "rsi"|"macd"|"ema20"|"ema50"|"trend"|"aiScore"|"signal"|"strength"> {
  if (prices.length < 27) {
    const score = changePct > 2 ? 5 : changePct > 0.5 ? 2 :
                  changePct < -2 ? -5 : changePct < -0.5 ? -2 : 0;
    const signal: SignalType =
      score >= 5 ? "STRONG_BUY" : score >= 2 ? "BUY" :
      score <= -5 ? "STRONG_SELL" : score <= -2 ? "SELL" : "HOLD";
    return {
      rsi: 50, macd: 0, ema20: price, ema50: price,
      trend: 0, aiScore: score, signal,
      strength: Math.abs(score) / 7 * 100,
    };
  }

  const rsiVal   = rsi(prices) ?? 50;
  const macdVal  = macd(prices);
  const ema20Arr = ema(prices, 20);
  const ema50Arr = ema(prices, 50);
  const ema20Val = ema20Arr[ema20Arr.length - 1];
  const ema50Val = ema50Arr[ema50Arr.length - 1];

  const trend = ema20Val > ema50Val * 1.001 ?  1 :
                ema20Val < ema50Val * 0.999 ? -1 : 0;

  const ai = aiScore(rsiVal, macdVal, trend);

  let techScore = 0;
  if (rsiVal  < 35)  techScore += 2;
  if (rsiVal  > 65)  techScore -= 2;
  if (macdVal > 0)   techScore += 1; else techScore -= 1;
  if (trend  ===  1) techScore += 2; else if (trend === -1) techScore -= 2;
  if (price  > ema20Val) techScore += 1; else techScore -= 1;

  const blended = techScore * 0.6 + ai * 0.4;

  const signal: SignalType =
    blended >= 4   ? "STRONG_BUY"  :
    blended >= 1.5 ? "BUY"         :
    blended <= -4  ? "STRONG_SELL" :
    blended <= -1.5? "SELL"        : "HOLD";

  return {
    rsi: rsiVal, macd: macdVal, ema20: ema20Val, ema50: ema50Val,
    trend, aiScore: ai, signal,
    strength: Math.min(Math.abs(blended) / 5 * 100, 100),
  };
}

// ─── Build LiveTicker ─────────────────────────────────────────────────────────
function buildTicker(
  symbol: string, price: number, prevPrice: number,
  change24h: number, changePct: number,
  high24h: number, low24h: number, volume24h: number,
  tickCount: number,
): LiveTicker {
  const hist = PRICE_HISTORY[symbol] ?? [];
  const ind  = computeSignal(hist, price, changePct);
  return {
    symbol, price, prevPrice,
    change24h, changePct,
    high24h, low24h, volume24h,
    tickCount, ts: Date.now(),
    ...ind,
  };
}

// ─── Seed price history ───────────────────────────────────────────────────────
function seedHistory(symbol: string, price: number) {
  if (PRICE_HISTORY[symbol].length >= 60) return;
  const hist: number[] = [];
  let p = price * (1 + (Math.random() - 0.5) * 0.05);
  for (let i = 0; i < 60; i++) {
    p = p * (1 + (Math.random() - 0.5) * 0.008);
    hist.push(p);
  }
  hist.push(price);
  PRICE_HISTORY[symbol] = hist;
}

// ─── Mock ticker simulation ───────────────────────────────────────────────────
function makeMock(symbol: string, prev?: LiveTicker): LiveTicker {
  const base      = prev?.price ?? MOCK_BASE[symbol] ?? 100;
  const drift     = (Math.random() - 0.48) * 0.003;
  const price     = base * (1 + drift);
  const changePct = prev
    ? ((price - (MOCK_BASE[symbol] ?? base)) / (MOCK_BASE[symbol] ?? base)) * 100
    : (Math.random() - 0.5) * 4;

  seedHistory(symbol, price);
  PRICE_HISTORY[symbol].push(price);
  if (PRICE_HISTORY[symbol].length > 100) PRICE_HISTORY[symbol].shift();

  return buildTicker(
    symbol, price, base,
    price - (MOCK_BASE[symbol] ?? base), changePct,
    price * 1.025, price * 0.975,
    1_000_000 + Math.random() * 9_000_000,
    (prev?.tickCount ?? 0) + 1,
  );
}

// ─── Build signal list ────────────────────────────────────────────────────────
function buildSignals(map: Map<string, LiveTicker>): LiveSignal[] {
  return SYMBOLS
    .map(s => map.get(s))
    .filter(Boolean)
    .map(t => ({
      symbol: t!.symbol, price: t!.price, changePct: t!.changePct,
      signal: t!.signal, aiScore: t!.aiScore, rsi: t!.rsi, macd: t!.macd,
      trend: t!.trend, ema20: t!.ema20, ema50: t!.ema50,
      strength: t!.strength, ts: t!.ts,
    }))
    .sort((a, b) => Math.abs(b.aiScore) - Math.abs(a.aiScore)) as LiveSignal[];
}

// ─── Direct fetch with timeout ───────────────────────────────────────────────
async function fetchDirect(url: string, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useLiveSignals() {
  const [tickers,      setTickers]      = useState<LiveTicker[]>(() => SYMBOLS.map(s => makeMock(s)));
  const [signals,      setSignals]      = useState<LiveSignal[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [lastUpdate,   setLastUpdate]   = useState<number>(Date.now());
  const [wsConnected,  setWsConnected]  = useState(false);
  const [tickTotal,    setTickTotal]    = useState(0);
  const [source,       setSource]       = useState<DataSource>("mock");
  const [wsStats,      setWsStats]      = useState<WsStats>({
    connectCount: 0, disconnectCount: 0, reconnectCount: 0,
    lastConnectedAt: 0, lastDisconnAt: 0,
    nextReconnectIn: 0, currentDelay: RECONNECT_INITIAL,
    uptime: 0,
  });

  // ── Refs ──────────────────────────────────────────────────────────────────
  const mapRef          = useRef<Map<string, LiveTicker>>(new Map());
  const wsRef           = useRef<WebSocket | null>(null);
  const pollRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const mockRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnTimerRef  = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const heartbeatRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef      = useRef(true);
  const hasRealData     = useRef(false);
  const lastMsgTime     = useRef(Date.now());

  // Reconnection state (refs so closures always read fresh values)
  const reconnDelay     = useRef(RECONNECT_INITIAL);
  const connectCount    = useRef(0);
  const disconnectCount = useRef(0);
  const reconnectCount  = useRef(0);
  const lastConnAt      = useRef(0);
  const lastDisconnAt   = useRef(0);
  const reconnAt        = useRef(0);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const pushState = useCallback(() => {
    if (!mountedRef.current) return;
    const list = SYMBOLS.map(s => mapRef.current.get(s)).filter(Boolean) as LiveTicker[];
    setTickers(list);
    setSignals(buildSignals(mapRef.current));
    setLastUpdate(Date.now());
  }, []);

  const applyTick = useCallback((t: LiveTicker) => {
    if (!mountedRef.current) return;
    mapRef.current.set(t.symbol, t);
    pushState();
    setTickTotal(n => n + 1);
    lastMsgTime.current = Date.now();
  }, [pushState]);

  const updateStats = useCallback(() => {
    setWsStats({
      connectCount:    connectCount.current,
      disconnectCount: disconnectCount.current,
      reconnectCount:  reconnectCount.current,
      lastConnectedAt: lastConnAt.current,
      lastDisconnAt:   lastDisconnAt.current,
      nextReconnectIn: Math.max(0, reconnAt.current - Date.now()),
      currentDelay:    reconnDelay.current,
      uptime:          lastConnAt.current ? Date.now() - lastConnAt.current : 0,
    });
  }, []);

  // ── Stop all reconnect timers cleanly ────────────────────────────────────
  const clearReconnTimer = useCallback(() => {
    if (reconnTimerRef.current) {
      clearTimeout(reconnTimerRef.current);
      reconnTimerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    reconnAt.current = 0;
  }, []);

  // ── Schedule reconnect with exponential back-off ──────────────────────────
  const scheduleReconnect = useCallback((delay?: number) => {
    if (!mountedRef.current) return;
    clearReconnTimer();

    const ms  = delay ?? reconnDelay.current;
    reconnAt.current = Date.now() + ms;
    console.log(`[LiveSignals] ⏳ Reconnecting in ${ms / 1000}s (attempt #${reconnectCount.current + 1})`);

    setStreamStatus("reconnecting");
    updateStats();

    // Live countdown tick every second
    countdownRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      updateStats();
    }, 1000);

    reconnTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      clearReconnTimer();
      reconnectCount.current += 1;
      // Exponential backoff ladder: 5s → 10s → 20s → 30s (max)
      reconnDelay.current = Math.min(reconnDelay.current * RECONNECT_FACTOR, RECONNECT_MAX);
      connectGateWs(); // eslint-disable-line @typescript-eslint/no-use-before-define
    }, ms);
  }, [clearReconnTimer, updateStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mock simulation ───────────────────────────────────────────────────────
  const stopMock = useCallback(() => {
    if (mockRef.current) { clearInterval(mockRef.current); mockRef.current = null; }
  }, []);

  const startMockSim = useCallback(() => {
    if (mockRef.current) return;
    if (hasRealData.current) return;
    setSource("mock");
    mockRef.current = setInterval(() => {
      if (!mountedRef.current) { stopMock(); return; }
      if (hasRealData.current)  { stopMock(); return; }
      SYMBOLS.forEach(sym => {
        const prev   = mapRef.current.get(sym);
        const ticker = makeMock(sym, prev);
        mapRef.current.set(sym, ticker);
      });
      pushState();
      setTickTotal(n => n + SYMBOLS.length);
    }, 1500);
  }, [pushState, stopMock]);

  // ── Heartbeat / watchdog ─────────────────────────────────────────────────
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      const age = Date.now() - lastMsgTime.current;
      if (age > STALE_THRESHOLD && wsRef.current?.readyState === WebSocket.OPEN) {
        console.warn(`[LiveSignals] ⚠️ No data for ${Math.round(age / 1000)}s — forcing reconnect`);
        try { wsRef.current?.close(4000, "stale"); } catch { /* ignore */ }
      }
      updateStats();
    }, HEARTBEAT_MS);
  }, [updateStats]);

  // ── REST fallback — Gate.io public tickers ────────────────────────────────
  const pollRest = useCallback(async () => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    try {
      const res = await fetchDirect(GATE_REST_TICKERS, 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as Array<{
        currency_pair: string; last: string; change_percentage: string;
        high_24h: string; low_24h: string; base_volume: string; quote_volume: string;
      }>;
      if (!mountedRef.current) return;
      let updated = 0;
      for (const item of (json ?? [])) {
        const symbol = fromGateInst(item.currency_pair).toUpperCase();
        if (!SYMBOLS.includes(symbol)) continue;

        const price     = parseFloat(item.last ?? "0");
        const pctRaw    = parseFloat(item.change_percentage ?? "0");
        const changePct = isNaN(pctRaw) ? 0 : pctRaw;
        const change24h = price * changePct / 100;
        const high24h   = parseFloat(item.high_24h)    || price;
        const low24h    = parseFloat(item.low_24h)     || price;
        const volume24h = parseFloat(item.quote_volume || item.base_volume) || 0;
        const prev      = mapRef.current.get(symbol);

        if (!PRICE_HISTORY[symbol]) PRICE_HISTORY[symbol] = [];
        if (PRICE_HISTORY[symbol].length === 0) seedHistory(symbol, price);
        PRICE_HISTORY[symbol].push(price);
        if (PRICE_HISTORY[symbol].length > 120) PRICE_HISTORY[symbol].shift();

        const ticker = buildTicker(
          symbol, price, prev?.price ?? price,
          change24h, changePct, high24h, low24h, volume24h,
          (prev?.tickCount ?? 0) + 1,
        );
        mapRef.current.set(symbol, ticker);
        hasRealData.current = true;
        updated++;
      }
      if (updated > 0) {
        pushState();
        setTickTotal(n => n + updated);
        setSource("gateio-rest");
        setStreamStatus("polling");
        stopMock();
        lastMsgTime.current = Date.now();
      }
    } catch {
      if (!hasRealData.current) {
        setStreamStatus(wsRef.current ? "reconnecting" : "offline");
      }
    }
  }, [pushState, stopMock]);

  // ── Main WebSocket connect function (Gate.io V4) ──────────────────────────
  const connectGateWs = useCallback(() => {
    if (!mountedRef.current) return;

    // Guard: don't stack connections
    const existing = wsRef.current;
    if (existing && (
      existing.readyState === WebSocket.CONNECTING ||
      existing.readyState === WebSocket.OPEN
    )) return;

    // ── Explicitly close any stale socket before creating a new one ──────────
    if (existing) {
      existing.onclose   = null;
      existing.onerror   = null;
      existing.onmessage = null;
      try { existing.close(1000, "reconnect"); } catch { /* ignore */ }
      wsRef.current = null;
    }

    console.log("[LiveSignals] 🔌 Opening Gate.io WebSocket…");
    setStreamStatus("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(GATE_WS_URL);
    } catch (e) {
      console.error("[LiveSignals] ❌ WebSocket constructor failed:", e);
      scheduleReconnect();
      return;
    }
    wsRef.current = socket;

    let pingInterval: ReturnType<typeof setInterval> | null = null;

    // ── onopen ───────────────────────────────────────────────────────────────
    socket.onopen = () => {
      if (!mountedRef.current) { socket.close(1000, "unmount"); return; }

      console.log("[LiveSignals] ✅ Gate.io WebSocket CONNECTED");

      // Gate.io V4 subscribe: channel "spot.tickers", payload = array of pairs
      try {
        socket.send(JSON.stringify({
          time:    Math.floor(Date.now() / 1000),
          channel: "spot.tickers",
          event:   "subscribe",
          payload: GATE_PAIRS,
        }));
      } catch (e) { console.warn("[LiveSignals] subscribe failed", e); }

      // Gate.io keepalive: ping every 20 s
      pingInterval = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(JSON.stringify({
            time:    Math.floor(Date.now() / 1000),
            channel: "spot.ping",
          }));
        } catch { /* ignore */ }
      }, 20_000);

      // Reset back-off on successful connect
      reconnDelay.current  = RECONNECT_INITIAL;
      connectCount.current += 1;
      lastConnAt.current    = Date.now();

      setWsConnected(true);
      setStreamStatus("live");
      setSource("gateio-ws");
      clearReconnTimer();
      stopMock();
      startHeartbeat();
      updateStats();
    };

    // ── onmessage ────────────────────────────────────────────────────────────
    socket.onmessage = (evt) => {
      if (!mountedRef.current) return;
      try {
        const raw = JSON.parse(evt.data as string);

        // Gate.io control frames — skip
        if (raw?.channel === "spot.pong")    return;
        if (raw?.event   === "subscribe")    return;
        if (raw?.event   === "unsubscribe")  return;
        if (raw?.channel !== "spot.tickers") return;
        if (raw?.event   !== "update")       return;

        const d = raw.result;
        if (!d?.currency_pair) return;

        const symbol = fromGateInst(String(d.currency_pair)).toUpperCase();
        if (!SYMBOLS.includes(symbol)) return;

        const price     = parseFloat(d.last ?? "0");
        const pctRaw    = parseFloat(d.change_percentage ?? "0");
        const changePct = isNaN(pctRaw) ? 0 : pctRaw;
        const change24h = price * changePct / 100;
        const high24h   = parseFloat(d.high_24h  ?? "0") || price;
        const low24h    = parseFloat(d.low_24h   ?? "0") || price;
        const volume24h = parseFloat(d.quote_volume ?? d.base_volume ?? "0");

        if (!price) return;
        const prev = mapRef.current.get(symbol);

        if (!PRICE_HISTORY[symbol]) PRICE_HISTORY[symbol] = [];
        if (PRICE_HISTORY[symbol].length === 0) seedHistory(symbol, price);
        PRICE_HISTORY[symbol].push(price);
        if (PRICE_HISTORY[symbol].length > 120) PRICE_HISTORY[symbol].shift();

        const ticker = buildTicker(
          symbol, price, prev?.price ?? price,
          change24h, changePct,
          high24h, low24h, volume24h,
          (prev?.tickCount ?? 0) + 1,
        );

        hasRealData.current = true;
        applyTick(ticker);
      } catch { /* malformed frame — ignore */ }
    };

    // ── onerror ──────────────────────────────────────────────────────────────
    // CRITICAL: onerror MUST call socket.close()
    // This guarantees onclose ALWAYS fires, which schedules the reconnect.
    socket.onerror = (evt) => {
      console.warn("[LiveSignals] ⚠️ WebSocket error — closing to trigger onclose", evt);
      try { socket.close(4000, "client-error"); } catch { /* ignore */ }
    };

    // ── onclose — THE RECONNECT GUARANTEE ────────────────────────────────────
    // Fires after ANY disconnect: normal, server, network drop, onerror, stale.
    socket.onclose = (evt) => {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      if (wsRef.current === socket) wsRef.current = null;
      setWsConnected(false);

      // Component unmounted → do NOT reconnect
      if (!mountedRef.current) {
        console.log("[LiveSignals] 🔕 WS closed after unmount — not reconnecting");
        return;
      }

      disconnectCount.current += 1;
      lastDisconnAt.current    = Date.now();

      console.log(
        `[LiveSignals] 🔴 Gate.io CLOSED` +
        ` | code=${evt.code} | clean=${evt.wasClean} | reason="${evt.reason || "unknown"}"` +
        ` | next retry in ${reconnDelay.current / 1000}s`
      );

      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }

      // Keep UI alive with mock or polling status
      if (!hasRealData.current) {
        startMockSim();
      } else {
        setStreamStatus("reconnecting");
      }

      // Always schedule reconnect
      scheduleReconnect();
    };

  }, [applyTick, clearReconnTimer, scheduleReconnect, startHeartbeat, startMockSim, stopMock, updateStats]);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current  = true;
    hasRealData.current = false;
    lastMsgTime.current = Date.now();

    // Seed map so UI is never blank
    SYMBOLS.forEach(sym => {
      if (!mapRef.current.has(sym)) {
        mapRef.current.set(sym, makeMock(sym));
      }
    });
    pushState();

    // 1. Start mock simulation immediately (replaced by real data on connect)
    startMockSim();

    // 2. Connect to Gate.io WebSocket
    connectGateWs();

    // 3. REST poll every 3 s as fallback when WS is unavailable
    pollRef.current = setInterval(pollRest, 3000);
    pollRest();

    return () => {
      console.log("[LiveSignals] 🧹 Cleanup — unmounting");
      mountedRef.current = false;

      if (pollRef.current)      clearInterval(pollRef.current);
      if (mockRef.current)      clearInterval(mockRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);

      // Close WebSocket WITHOUT triggering reconnect
      if (wsRef.current) {
        const s = wsRef.current;
        wsRef.current = null;
        s.onclose   = null;
        s.onerror   = null;
        s.onmessage = null;
        try { s.close(1000, "unmount"); } catch { /* ignore */ }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────
  const topBuys  = signals.filter(s => s.signal === "STRONG_BUY"  || s.signal === "BUY");
  const topSells = signals.filter(s => s.signal === "STRONG_SELL" || s.signal === "SELL");
  const marketMood = signals.length > 0
    ? signals.reduce((sum, s) => sum + s.aiScore, 0) / signals.length
    : 0;

  return {
    tickers,
    signals,
    topBuys,
    topSells,
    streamStatus,
    wsConnected,
    lastUpdate,
    marketMood,
    tickTotal,
    source,
    wsStats,
    isLive: source === "gateio-ws",
  };
}
