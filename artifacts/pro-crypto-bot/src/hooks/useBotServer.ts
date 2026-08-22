/**
 * useBotServer — connects frontend to the Node.js server
 *
 * WHY THIS HOOK EXISTS:
 * ─────────────────────────────────────────────────────────────────────────────
 * The browser CANNOT call api.binance.com (CORS blocked — forever).
 * server/bot.js runs in Node.js where CORS doesn't exist → calls Binance fine.
 * This hook connects to server/bot.js via:
 *   • REST API  → start/stop, config, status polling (every 3s)
 *   • WebSocket → real-time log stream, price updates, trade alerts
 *
 * URL config:
 *   Set VITE_SERVER_URL in .env to override the default localhost:3001
 *   e.g. VITE_SERVER_URL=https://your-vps.example.com:3001
 *
 * Usage:
 *   const server = useBotServer();           // uses VITE_SERVER_URL or localhost:3001
 *   const server = useBotServer(customUrl);  // explicit override
 *   server.start({ symbol: "BTCUSDT", dryRun: false });
 *   server.stop();
 *   server.status.isRunning  // true/false
 *   server.logs              // string[]
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { SERVER_URL } from "../config/urls";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface RiskConfig {
  maxPositionSizePct: number;
  maxRiskPerTradePct: number;
  maxDailyLossUsd:    number;
  maxOpenPositions:   number;
  minBalanceUsd:      number;
  tradeCooldownMs:    number;
  maxTradesPerDay:    number;
}

export interface RiskState {
  isHalted:          boolean;
  haltReason:        string | null;
  dailyPnlUsd:       number;
  dailyTradeCount:   number;
  openPositionCount: number;
  openSymbols:       string[];
  lastTradeAt:       number;
  msSinceLast:       number;
  config:            RiskConfig;
}

export interface ServerStatus {
  isRunning:     boolean;
  isKilled:      boolean;
  dryRun:        boolean;
  testMode:      boolean;
  symbol:        string;
  activeStrategy?: string;
  activeEngine?:   string;
  strategy?:       StrategySignalData | null;
  lastPrice:     number;
  position:      ServerPosition | null;
  dailyPnL:      number;
  totalTrades:   number;
  winningTrades: number;
  losingTrades:  number;
  winRate:       string;
  tickCount:     number;
  uptime:        number;
  currentSignal: ServerSignal | null;
  lastError:     string | null;
  balanceUSDT:   number;
  hasApiKey:     boolean;
  hasSecret:     boolean;
  hasTelegram:   boolean;
  keysReady:     boolean;
  mode:          "LIVE" | "PAPER" | "NO_KEYS" | "UNKNOWN";
  apiKeyMask:    string;
  secretMask:    string;
  tgTokenMask:   string;
  tgChatMask:    string;
  config: {
    symbol:               string;
    takeProfit:           number;
    stopLoss:             number;
    tickMs:               number;
    maxDailyLoss:         number;
    testMode:             boolean;
    strategy?:            string;
    symbolSelectionMode?: "manual" | "auto";
    approvedSymbols?:     string[];
    orderSizeUsdt?:        number;
  };
  tradingParams?: {
    positionSizeMode: "fixed_usdt" | "pct_portfolio" | "auto_risk";
    fixedSizeUsdt: number;
    portfolioSizePct: number;
    riskPerTradePct: number;
    maxPositionSizePct: number;
    takeProfitMode: "strategy" | "fixed_pct" | "atr_multiple" | "risk_reward";
    fixedTpPct: number;
    tpAtrMultiple: number;
    tpRiskReward: number;
    stopLossMode: "strategy" | "fixed_pct" | "atr";
    fixedSlPct: number;
    slAtrMultiple: number;
    maxOpenPositions: number;
    maxDailyLossUsd: number;
    maxTradesPerDay: number;
    tradeCooldownMs: number;
  };
  risk?:         RiskState;
  portfolio?:    PortfolioSnapshot;
  advancedRisk?: AdvancedRiskStatus;
  scanner?:      ScannerStatus;
  strategyParameters?: {
    rsiBuyMin:      number;
    rsiBuyMax:      number;
    minVolumeRatio: number;
  };
  lastIndicatorUpdate?: number;
  lastCandleTime?:      number;
  candleBar?:           string;
  candleCount?:         number;
  stopReason?:          string | null;
  performance?: {
    totalTrades:     number;
    winRate:         number;
    profitFactor:    number;
    avgTradeReturn:  number;
    avgHoldMins:     number;
    maxDrawdownPct:  number;
    totalPnlUsd:     number;
    weekly7dPnl:     number;
    monthly30dPnl:   number;
    sessionRoiPct:   number;
    computedAt:      string;
  };
}

export interface ServerPosition {
  entry:    number;
  qty:      number;
  orderId:  string | number;
  time:     number;
  tp:       number;
  sl:       number;
  dryRun?:  boolean;
}

export interface ServerSignal {
  rsi:     string | number;
  macd:    string | number;
  trend:   number;
  aiScore: number;
  atr?:    number;
  price?:  number;
}

export type PortfolioState = "ACTIVE" | "WARNING" | "COOLDOWN" | "HALTED";

export interface AdvancedRiskConfig {
  maxDrawdownPct:        number;
  dailyLossLimitUsd:     number;
  weeklyLossLimitUsd:    number;
  monthlyLossLimitUsd:   number;
  consecutiveLossLimit:  number;
  cooldownAfterLossMs:   number;
  volatilityKillSwitch:  boolean;
  maxConcurrentLosses:   number;
  volatilityAtrMultiple: number;
}

export interface AdvancedRiskStatus {
  state:               PortfolioState;
  drawdownPct:         number;
  peakBalance:         number;
  currentBalance:      number;
  dailyPnlUsd:         number;
  weeklyPnlUsd:        number;
  monthlyPnlUsd:       number;
  consecutiveLosses:   number;
  cooldownUntil:       number | null;
  cooldownRemainingMs: number;
  volatilityBlocked:   boolean;
  volatilityReason:    string | null;
  haltReason:          string | null;
  warnings:            string[];
  config:              AdvancedRiskConfig;
}

export interface PortfolioPosition {
  id:               string;
  symbol:           string;
  strategy:         string;
  side:             "long";
  entryPrice:       number;
  qty:              number;
  sizeUsdt:         number;
  slPrice:          number;
  tpPrice:          number;
  openedAt:         number;
  lastPrice:        number;
  unrealizedPnl:    number;
  unrealizedPnlPct: number;
  dryRun:           boolean;
}

export interface PortfolioConfig {
  maxTotalExposureUsdt: number;
  maxOpenPositions:     number;
  maxPerSymbol:         number;
  maxPerStrategy:       number;
}

export interface PortfolioSnapshot {
  positions:           PortfolioPosition[];
  openCount:           number;
  totalExposureUsdt:   number;
  totalUnrealizedPnl:  number;
  bySymbol:            Record<string, { count: number; exposureUsdt: number; unrealizedPnl: number }>;
  byStrategy:          Record<string, { count: number; exposureUsdt: number }>;
  config:              PortfolioConfig;
}

export interface StrategySignalData {
  action:        "BUY" | "SELL" | "SHORT" | "HOLD";
  confidence:    number;
  ema50:         number | null;
  ema200:        number | null;
  rsi:           number | null;
  atr:           number | null;
  currentVol:    number | null;
  avgVol:        number | null;
  suggestedSl:   number | null;
  suggestedTp:   number | null;
  stopLossPct:   number | null;
  takeProfitPct: number | null;
  canTrade:      boolean;
  blockReason:   string | null;
  reason:        string;
  // Phase 8.7 — dual-mode display fields
  mode?:              "LONG" | "SHORT" | null;
  conditionsMet?:     number | null;
  conditionsTotal?:   number | null;
  missingConditions?: string[] | null;
}

export interface ServerLogEntry {
  ts:    string;
  level: string;
  msg:   string;
}

export interface ServerTrade {
  id:       string;
  symbol:   string;
  side:     string;
  entry:    number;
  exit:     number;
  qty:      number;
  pnlUsd:   number;
  pnlPct:   number;
  reason:   string;
  holdMins: number;
  dryRun:   boolean;
  time:     string;
}

export interface MarketScanResult {
  symbol:       string;
  score:        number;
  regime:       string;
  ema50:        number | null;
  ema200:       number | null;
  rsi:          number | null;
  adx:          number | null;
  atr:          number | null;
  atrPct:       number | null;
  volumeRatio:  number | null;
  spreadPct:    number | null;
  bbWidth:      number | null;
  selected:     boolean;
  rejected:     boolean;
  rejectReason: string | null;
  scannedAt:    string;
  error:        string | null;
}

export interface ScannerStatus {
  mode:                "manual" | "auto";
  approvedSymbols:     string[];
  scanIntervalMinutes: number;
  minimumMarketScore:  number;
  lastScanAt:          string | null;
  scannerBusy:         boolean;
  results:             MarketScanResult[];
  bestSymbol:          string | null;
  bestScore:           number;
  bestRegime:          string | null;
  selectedSymbol:      string | null;
  state:               "SCANNING" | "QUALIFIED" | "WAITING";
  reason:              string | null;
  minimumScore:        number;
  nextScanInMs:        number;
}

export interface ServerConfig {
  apiKey?:              string;
  secretKey?:           string;
  tgToken?:             string;
  tgChat?:              string;
  symbol?:              string;
  takeProfit?:          number;
  stopLoss?:            number;
  maxDailyLoss?:        number;
  dryRun?:              boolean;
  testMode?:            boolean;
  tickMs?:              number;
  orderSizeUsdt?:       number;
  strategy?:            string;
  symbolSelectionMode?: "manual" | "auto";
  approvedSymbols?:     string[];
  scanIntervalMinutes?: number;
  minimumMarketScore?:  number;
  // Phase 14 execution authority
  positionSizeMode?: "fixed_usdt" | "pct_portfolio" | "auto_risk";
  fixedSizeUsdt?: number;
  portfolioSizePct?: number;
  riskPerTradePct?: number;
  takeProfitMode?: "strategy" | "fixed_pct" | "atr_multiple" | "risk_reward";
  fixedTpPct?: number;
  tpAtrMultiple?: number;
  tpRiskReward?: number;
  stopLossMode?: "strategy" | "fixed_pct" | "atr";
  fixedSlPct?: number;
  slAtrMultiple?: number;
  maxOpenPositions?: number;
  maxPositionSizePct?: number;
  maxTradesPerDay?: number;
  tradeCooldownMs?: number;
  riskConfig?: Partial<RiskConfig>;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

// ─── Hook ─────────────────────────────────────────────────────────────────────
const DEFAULT_STATUS: ServerStatus = {
  isRunning:     false,
  isKilled:      false,
  dryRun:        true,
  testMode:      true,
  symbol:        "BTCUSDT",
  lastPrice:     0,
  position:      null,
  dailyPnL:      0,
  totalTrades:   0,
  winningTrades: 0,
  losingTrades:  0,
  winRate:       "0",
  tickCount:     0,
  uptime:        0,
  currentSignal: null,
  lastError:     null,
  balanceUSDT:   0,
  hasApiKey:     false,
  hasSecret:     false,
  hasTelegram:   false,
  keysReady:     false,
  mode:          "NO_KEYS",
  apiKeyMask:    "",
  secretMask:    "",
  tgTokenMask:   "",
  tgChatMask:    "",
  config: {
    symbol:       "BTCUSDT",
    takeProfit:   0.010,
    stopLoss:     0.009,
    tickMs:       5000,
    maxDailyLoss: -50,
    testMode:     true,
  },
};

export function useBotServer(baseUrl: string = SERVER_URL) {
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [status,     setStatus]     = useState<ServerStatus>(DEFAULT_STATUS);
  const [logs,       setLogs]       = useState<ServerLogEntry[]>([]);
  const [trades,     setTrades]     = useState<ServerTrade[]>([]);
  const [error,      setError]      = useState<string | null>(null);
  const [lastPong,   setLastPong]   = useState<number | null>(null);

  const sseRef         = useRef<EventSource | null>(null);
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef     = useRef(true);

  // ── REST helper ─────────────────────────────────────────────────────────
  const api = useCallback(async (
    method: "GET" | "POST",
    path:   string,
    body?:  object
  ): Promise<{ ok: boolean; [key: string]: unknown }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(localStorage.getItem("pcb_jwt") ? { "Authorization": `Bearer ${localStorage.getItem("pcb_jwt")}` } : {}),
      },
        body:    body ? JSON.stringify(body) : undefined,
        signal:  controller.signal,
      });
      clearTimeout(timer);
      return res.json();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }, [baseUrl]);

  // ── Fetch status via REST ─────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const data = await api("GET", "/api/status") as unknown as ServerStatus & { ok: boolean };
      if (!mountedRef.current) return;
      if (data.ok) {
        setStatus(data);
        setError(null);
        if (connection !== "connected") setConnection("connected");
      }
    } catch {
      if (!mountedRef.current) return;
      setConnection("error");
      setError("Server not reachable — is server/bot.js running?");
    }
  }, [api, connection]);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await api("GET", "/api/logs") as { ok: boolean; logs: ServerLogEntry[] };
      if (mountedRef.current && data.ok) setLogs(data.logs);
    } catch { /* ignore */ }
  }, [api]);

  const fetchTrades = useCallback(async () => {
    try {
      const data = await api("GET", "/api/trades") as { ok: boolean; trades: ServerTrade[] };
      if (mountedRef.current && data.ok) setTrades(data.trades);
    } catch { /* ignore */ }
  }, [api]);

  // ── Ping server ──────────────────────────────────────────────────────
  const ping = useCallback(async (): Promise<boolean> => {
    try {
      const data = await api("GET", "/api/ping");
      if (data.ok) { setLastPong(Date.now()); return true; }
      return false;
    } catch {
      return false;
    }
  }, [api]);

  // ── SSE stream for real-time log updates ─────────────────────────────
  const connectSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    try {
      const url = `${baseUrl}/api/bot/logs/stream`;
      const es = new EventSource(url);
      sseRef.current = es;

      es.onmessage = (evt) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(evt.data as string) as
            | { type: "init";  logs: ServerLogEntry[] }
            | { type: "log";   entry: ServerLogEntry }
           | {
               type:
                 | "position:open"
                 | "position:close"
                 | "position:update"
                 | "order:created"
                 | "order:update";
               symbol?: string;
             };

          // Position change — immediately sync state without waiting for next 3 s poll.
          // This is what makes the TP/Close buttons appear instantly when a trade opens.
           if (
             msg.type === "position:open" ||
             msg.type === "position:close" ||
             msg.type === "position:update" ||
             msg.type === "order:created" ||
             msg.type === "order:update"
           ) {
            fetchStatus();
            fetchTrades();
            return;
          }

          if (msg.type === "init") {
            // Seed the log panel from the SSE backlog
            if (msg.logs.length > 0) setLogs(msg.logs.slice(0, 200));
            return;
          }

          if (msg.type === "log") {
            const entry = msg.entry;
            setLogs((prev) => {
              if (prev[0]?.ts === entry.ts && prev[0]?.msg === entry.msg) return prev;
              return [entry, ...prev.slice(0, 199)];
            });
            // Also trigger immediate refetch on trade lifecycle log patterns
            // so Dashboard / Portfolio / Trades update without waiting for the next 3 s poll.
            if (entry.msg && /\[Trade Closed\]|\[Execution\]|take_profit|stop_loss|strategy_exit/.test(entry.msg)) {
              fetchStatus();
              fetchTrades();
            }
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        if (!mountedRef.current) return;
        if (sseRef.current) {
          sseRef.current.close();
          sseRef.current = null;
        }
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connectSse, 4000);
      };
    } catch {
      // SSE not available — logs via REST poll only
    }
  }, [baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bot control ──────────────────────────────────────────────────────
  const start = useCallback(async (cfg?: ServerConfig) => {
    try {
      const res = await api("POST", "/api/start", cfg || {});
      if (res.ok) await fetchStatus();
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Server not running";
      setError(msg);
      return { ok: false, error: msg };
    }
  }, [api, fetchStatus]);

  const stop = useCallback(async () => {
    try {
      const res = await api("POST", "/api/stop");
      if (res.ok) await fetchStatus();
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Server not running";
      setError(msg);
      return { ok: false, error: msg };
    }
  }, [api, fetchStatus]);

  const updateConfig = useCallback(async (cfg: ServerConfig) => {
    try {
      const res = await api("POST", "/api/config", cfg);
      if (res.ok) await fetchStatus();
      return res;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, [api, fetchStatus]);

  const testBinancePing = useCallback(async () => {
    try {
      return await api("POST", "/api/binance/ping");
    } catch {
      return { ok: false, error: "Server not reachable" };
    }
  }, [api]);

  const testBinanceAuth = useCallback(async (keys?: { apiKey?: string; secretKey?: string }) => {
    try {
      return await api("POST", "/api/binance/test-auth", keys || {});
    } catch {
      return { ok: false, error: "Server not reachable" };
    }
  }, [api]);

  const testTelegram = useCallback(async (cfg?: { token?: string; chatId?: string }) => {
    try {
      return await api("POST", "/api/test/telegram", cfg || {});
    } catch {
      return { ok: false, error: "Server not reachable" };
    }
  }, [api]);

  // ── Polling setup (REST fallback + WS) ───────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    setConnection("connecting");

    // Try to connect — ping is now public (no auth required)
    ping().then((ok) => {
      if (!mountedRef.current) return;
      if (ok) {
        setConnection("connected");
        fetchStatus();
        fetchLogs();
        fetchTrades();
        connectSse();
      } else {
        setConnection("error");
        setError("Server not reachable — is the API server running?");
      }
    });

    // Poll every 3s for status + trades updates
    pollRef.current = setInterval(() => {
      fetchStatus();
      fetchTrades();
    }, 3000);

    return () => {
      mountedRef.current = false;
      if (pollRef.current)      clearInterval(pollRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, [baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const isServerRunning = connection === "connected";

  const validateAndSaveKeys = useCallback(async (cfg: ServerConfig) => {
    try {
      return await api("POST", "/api/binance/validate", cfg);
    } catch {
      return { ok: false, error: "Server not reachable" };
    }
  }, [api]);

  // ── Risk management actions ──────────────────────────────────────────
  const fetchRisk = useCallback(async () => {
    try {
      return await api("GET", "/api/risk");
    } catch {
      return { ok: false, error: "Server not reachable" };
    }
  }, [api]);

  const updateRiskConfig = useCallback(async (patch: Partial<RiskConfig>) => {
    try {
      const res = await api("POST", "/api/risk/config", patch);
      if (res.ok) await fetchStatus();
      return res;
    } catch {
      return { ok: false, error: "Server not reachable" };
    }
  }, [api, fetchStatus]);

  const haltTrading = useCallback(async (reason?: string) => {
    try {
      const res = await api("POST", "/api/risk/halt", { reason: reason ?? "manual halt via UI" });
      if (res.ok) await fetchStatus();
      return res;
    } catch {
      return { ok: false, error: "Server not reachable" };
    }
  }, [api, fetchStatus]);

  const resumeTrading = useCallback(async () => {
    try {
      const res = await api("POST", "/api/risk/resume");
      if (res.ok) await fetchStatus();
      return res;
    } catch {
      return { ok: false, error: "Server not reachable" };
    }
  }, [api, fetchStatus]);

  const fetchKillSwitch = useCallback(async () => {
    try {
      return await api("GET", "/api/kill-switch");
    } catch {
      return { ok: false, tradingEnabled: true };
    }
  }, [api]);

  const setKillSwitch = useCallback(async (enabled: boolean) => {
    try {
      const res = await api("POST", "/api/kill-switch", { enabled });
      if (res.ok) await fetchStatus();
      return res;
    } catch {
      return { ok: false, error: "Server not reachable" };
    }
  }, [api, fetchStatus]);

  const fetchRiskEvents = useCallback(async (limit = 50) => {
    try {
      return await api("GET", `/api/risk/events?limit=${limit}`);
    } catch {
      return { ok: false, events: [] };
    }
  }, [api]);

  // ── Advanced risk engine controls ────────────────────────────────────────
  const fetchAdvancedRiskStatus = useCallback(async () => {
    try { return await api("GET", "/api/risk/status"); }
    catch { return { ok: false, error: "Server not reachable" }; }
  }, [api]);

  const updateAdvancedRiskConfig = useCallback(async (patch: Partial<AdvancedRiskConfig>) => {
    try {
      const res = await api("POST", "/api/risk/advanced/config", patch);
      if (res.ok) await fetchStatus();
      return res;
    } catch { return { ok: false, error: "Server not reachable" }; }
  }, [api, fetchStatus]);

  const clearAdvancedHalt = useCallback(async () => {
    try {
      const res = await api("POST", "/api/risk/advanced/clear-halt");
      if (res.ok) await fetchStatus();
      return res;
    } catch { return { ok: false, error: "Server not reachable" }; }
  }, [api, fetchStatus]);

  const clearAdvancedCooldown = useCallback(async () => {
    try {
      const res = await api("POST", "/api/risk/advanced/clear-cooldown");
      if (res.ok) await fetchStatus();
      return res;
    } catch { return { ok: false, error: "Server not reachable" }; }
  }, [api, fetchStatus]);

  const resetAdvancedDailyPnl = useCallback(async () => {
    try {
      const res = await api("POST", "/api/risk/advanced/reset-daily-pnl");
      if (res.ok) await fetchStatus();
      return res;
    } catch { return { ok: false, error: "Server not reachable" }; }
  }, [api, fetchStatus]);

  const resetAdvancedLossStreak = useCallback(async () => {
    try {
      const res = await api("POST", "/api/risk/advanced/reset-loss-streak");
      if (res.ok) await fetchStatus();
      return res;
    } catch { return { ok: false, error: "Server not reachable" }; }
  }, [api, fetchStatus]);

  const resetPaperBalance = useCallback(async () => {
    try {
      const res = await api("POST", "/api/reset-paper-balance");
      if (res.ok) await fetchStatus();
      return res;
    } catch { return { ok: false, error: "Server not reachable" }; }
  }, [api, fetchStatus]);

  return {
    // Connection
    connection,
    isServerRunning,
    lastPong,
    error,

    // State
    status,
    logs,
    trades,

    // Actions
    start,
    stop,
    updateConfig,
    validateAndSaveKeys,
    testBinancePing,
    testBinanceAuth,
    testTelegram,
    fetchStatus,
    fetchLogs,
    ping,
    api,
    // Risk management
    fetchRisk,
    updateRiskConfig,
    haltTrading,
    resumeTrading,
    fetchKillSwitch,
    setKillSwitch,
    fetchRiskEvents,
    // Advanced risk engine controls
    fetchAdvancedRiskStatus,
    updateAdvancedRiskConfig,
    clearAdvancedHalt,
    clearAdvancedCooldown,
    resetAdvancedDailyPnl,
    resetAdvancedLossStreak,
    resetPaperBalance,

    // Computed
    winRate: status.totalTrades > 0
      ? (status.winningTrades / status.totalTrades * 100).toFixed(1)
      : "0",
    uptimeStr: (() => {
      const s = status.uptime;
      if (s < 60) return `${s}s`;
      if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
      return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    })(),
  };
}
