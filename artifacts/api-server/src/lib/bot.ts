import { logger } from "./logger";
import type { OkxCandle } from "./okx";
import * as exchangeService from "../services/exchangeService";
import * as gateio from "../services/gateioExchange";
import * as store from "./store";
import * as trade from "../services/tradeService";
import type { ExchangeCreds } from "../services/tradeService";
import { riskManager } from "./riskManager";
import type { RiskConfig } from "./riskManager";
import { getUserRiskManager } from "./userRiskRegistry";
import { checkDailyLoss, RiskError } from "../services/riskService";
import { positionMonitor } from "./positionMonitor";
import type { CloseReason } from "./positionMonitor";
import { enqueueTradeEntry, enqueueTradeExit } from "../queues/tradeQueue";
import { onEntryFilled, onExitFilled, onPartialExitFilled } from "../workers/tradeWorker";
import type { TradeEntryResult, TradeExitResult } from "../queues/tradeQueue";
import { registerMonitorContext, clearMonitorContext } from "../services/tradeMonitorService";
import type { StrategySignal } from "../services/strategyService";
import { resolveStrategy } from "../services/strategies/index";
import * as marketScannerService from "../services/marketScannerService";
import type { MarketScanResult } from "../services/marketScannerService";
import { normalizeSymbol } from "../shared/symbolUtils";
import { portfolioRegistry } from "./portfolioRegistry";
import { advancedRiskEngine } from "./advancedRiskEngine";
import { positionSizingService } from "./positionSizingService";
import { tradingParamsService }  from "./tradingParamsService";
import * as telegramNotifier from "./telegramNotifier";
import { getDailyPnlChartUrl } from "./chartGenerator";
import * as performanceTracker from "./performanceTracker";
import { tradeJournal } from "./tradeJournal";
import { positionLifecycleManager } from "./positionLifecycleManager";
import { createOrder, updateOrder as updateOrderRecord, cancelOrder as cancelOrderDb } from "../services/ordersService";
import { startLimitOrderMonitor, type LimitFillResult } from "../services/limitOrderMonitor";
import { publishEvent } from "./eventBus";

/**
 * Pro Crypto Bot — server-side trading engine.
 *
 * All trade entries and exits now pass through the RiskManager before
 * any order is placed:
 *   • Position-size limit (% of free balance)
 *   • Max $ risk per trade (SL-based)
 *   • Daily loss protection (hard halt)
 *   • Duplicate-position guard
 *   • Trade cooldown + daily trade cap
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BotConfig {
  symbol: string;
  takeProfit: number;    // 0.01 = 1%
  stopLoss: number;      // 0.009 = 0.9%
  tickMs: number;
  maxDailyLoss: number;  // negative, e.g. -50
  testMode: boolean;
  orderSizeUsdt: number;
  symbolSelectionMode: "manual" | "auto";
  approvedSymbols: string[];
  scanIntervalMinutes: number;
  minimumMarketScore: number;
  // Phase 14 — explicit execution authority controls
  positionSizeMode?: "fixed_usdt" | "pct_portfolio" | "auto_risk";
  fixedSizeUsdt?: number;
  portfolioSizePct?: number;
  riskPerTradePct?: number;
  maxPositionSizePct?: number;
  takeProfitMode?: "strategy" | "fixed_pct" | "atr_multiple" | "risk_reward";
  fixedTpPct?: number;
  tpAtrMultiple?: number;
  tpRiskReward?: number;
  stopLossMode?: "strategy" | "fixed_pct" | "atr";
  fixedSlPct?: number;
  slAtrMultiple?: number;
  maxOpenPositions?: number;
  maxTradesPerDay?: number;
  tradeCooldownMs?: number;
}

export interface Position {
  entry: number;
  qty: number;
  orderId: string | number;
  time: number;
  tp: number;
  sl: number;
  dryRun?: boolean;
  closePending?: boolean;   // true while an exit job is in the queue
}

export interface Signal {
  rsi: number;
  macd: number;
  trend: number;
  aiScore: number;
  atr?: number;
  price?: number;
  // Extended strategy fields
  action?:     "BUY" | "SELL" | "SHORT" | "HOLD";
  confidence?: number;
  ema50?:      number | null;
  ema200?:     number | null;
  currentVol?: number | null;
  avgVol?:     number | null;
  strategyReason?: string;
  // Phase 8.7 — display-only dual-mode fields (no execution change)
  mode?:              "LONG" | "SHORT" | null;
  conditionsMet?:     number | null;
  conditionsTotal?:   number | null;
  missingConditions?: string[] | null;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: string;
  entry: number;
  exit: number;
  qty: number;
  pnlUsd: number;
  pnlPct: number;
  reason: string;
  holdMins: number;
  dryRun: boolean;
  time: string;
}

export interface LogEntry { ts: string; level: string; msg: string; }

// ─── Constants ───────────────────────────────────────────────────────────────

const PAPER_STARTING_BALANCE = 1000; // USDT — virtual balance for paper trading

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BotConfig = {
  symbol: "BTCUSDT",
  takeProfit: 0.010,
  stopLoss: 0.009,
  tickMs: 5_000,
  maxDailyLoss: -50,
  testMode: true,
  orderSizeUsdt: 25,
  symbolSelectionMode: "manual",
  approvedSymbols: ["BTC_USDT", "ETH_USDT", "SOL_USDT", "BNB_USDT"],
  scanIntervalMinutes: 15,
  minimumMarketScore: 67,
};

// ─── SSE log broadcast ───────────────────────────────────────────────────────

type LogSubscriber = (entry: LogEntry) => void;
const logSubscribers = new Set<LogSubscriber>();

export function subscribeToLogs(cb: LogSubscriber): () => void {
  logSubscribers.add(cb);
  return () => { logSubscribers.delete(cb); };
}

// ─── Position event pub/sub (Phase 13 — live sync) ───────────────────────────
type PositionEvent = { type: "open" | "close"; symbol: string };
type PositionSubscriber = (event: PositionEvent) => void;
const positionSubscribers = new Set<PositionSubscriber>();

export function subscribeToPositionEvents(cb: PositionSubscriber): () => void {
  positionSubscribers.add(cb);
  return () => { positionSubscribers.delete(cb); };
}

function emitPositionEvent(event: PositionEvent): void {
  for (const cb of positionSubscribers) { try { cb(event); } catch { /* ignore */ } }
}

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  isRunning: false,
  isKilled: false,
  startedAt: 0,

  config: { ...DEFAULT_CONFIG },

  activeExchange: "gateio" as "binance" | "bybit" | "gateio",
  ownerUserId: null as number | null,

  creds: {
    apiKey:     process.env["GATEIO_API_KEY"]     ?? "",
    apiSecret:  process.env["GATEIO_API_SECRET"]  ?? "",
    passphrase: process.env["GATEIO_PASSPHRASE"]  ?? "",
  },

  telegram: {
    token: process.env["TELEGRAM_BOT_TOKEN"] ?? "",
    chat:  process.env["TELEGRAM_CHAT_ID"]   ?? "",
  },

  lastPrice: 0,
  position: null as Position | null,
  dailyPnL: 0,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  tickCount: 0,
  currentSignal: null as Signal | null,
  lastError: null as string | null,
  balanceUSDT: 0,
  entryPending: false,   // true while a TRADE_ENTRY job is in the queue

  priceHistory: [] as number[],
  candles:      [] as OkxCandle[],          // OHLCV history for strategy indicators
  lastCandleFetch: 0,                        // timestamp of last candle refresh
  candleBar:    "1H" as string,              // candle timeframe for strategy
  lastStrategy: null as StrategySignal | null, // most recent strategy signal
  lastIndicatorUpdate: 0,                       // ms timestamp of last strategy evaluation
  activeStrategy: "active-swing" as string,           // preset ID ("scalping", "dca", …) — Phase 8.5 default; "swing" is disabled (see services/strategies/index.ts)
  activeEngine:   "ActiveSwingStrategy" as string,    // human-readable engine class name
  logs: [] as LogEntry[],
  trades: [] as ClosedTrade[],

  // ── Auto symbol selection scanner state ───────────────────────────────────
  lastScanTime:    0,
  lastScanResults: [] as MarketScanResult[],
  scannerBusy:     false,
  selectedSymbol:   null as string | null,
  scannerState:    "SCANNING" as "SCANNING" | "QUALIFIED" | "WAITING",
  scannerReason:   null as string | null,
  scannerBestScore: 0,

  loopHandle: null as ReturnType<typeof setTimeout> | null,

  // ── Lifecycle tracking ────────────────────────────────────────────────────
  stopReason:      null as string | null,
  sessionStartBalance: 0,    // balance at the moment start() is called
};

// Manual execution is intentionally not represented by the bot singleton state.
// It has its own active-position map, pending entries, and closed-trade history.
const manualState = {
  positions: new Map<string, Position>(),
  entryPending: new Set<string>(),
  trades: [] as ClosedTrade[],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function pushLog(level: string, msg: string) {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg };
  state.logs.unshift(entry);
  if (state.logs.length > 200) state.logs.length = 200;
  if (level === "error") logger.error(msg);
  else if (level === "warn") logger.warn(msg);
  else logger.info(msg);
  for (const cb of logSubscribers) { try { cb(entry); } catch { /* ignore */ } }
}
// Wire SSE log function into the advanced risk engine once at module load
advancedRiskEngine.setLogFn(pushLog);
// Wire SSE log function into the position sizing service
positionSizingService.setLogFn(pushLog);
// Wire SSE log function into the trading params service (Phase 13)
tradingParamsService.setLogFn(pushLog);
// Schedule daily summary telegram notification at UTC midnight
function buildReportData() {
  const snap = performanceTracker.getSnapshot();
  return {
    totalTrades:   state.totalTrades,
    wins:          state.winningTrades,
    losses:        state.losingTrades,
    winRate:       state.totalTrades > 0
      ? ((state.winningTrades / state.totalTrades) * 100).toFixed(1)
      : "0",
    dailyPnl:       state.dailyPnL,
    openPositions:  state.position ? 1 : 0,
    balance:        state.balanceUSDT,
    profitFactor:   snap.profitFactor > 0 ? snap.profitFactor.toFixed(2) : "—",
    maxDrawdownPct: snap.maxDrawdownPct > 0 ? snap.maxDrawdownPct.toFixed(2) : "—",
    weekly7dPnl:    snap.weekly7dPnl,
    monthly30dPnl:  snap.monthly30dPnl,
    totalPnlUsd:    snap.totalPnlUsd,
    sessionRoiPct:  snap.sessionRoiPct > 0 ? snap.sessionRoiPct.toFixed(2) : "—",
    activeStrategy: state.activeStrategy,
    activeEngine:   state.activeEngine,
  };
}

telegramNotifier.scheduleDailySummary(
  () => performanceTracker.getDailySummaryData({
    totalTrades:   state.totalTrades,
    wins:          state.winningTrades,
    losses:        state.losingTrades,
    winRate:       state.totalTrades > 0
      ? ((state.winningTrades / state.totalTrades) * 100).toFixed(1)
      : "0",
    dailyPnl:      state.dailyPnL,
    openPositions: state.position ? 1 : 0,
    balance:       state.balanceUSDT,
  }),
  () => getDailyPnlChartUrl(14),
);

telegramNotifier.scheduleWeeklySummary(buildReportData);
telegramNotifier.scheduleMonthlySummary(buildReportData);

function mask(s: string, keep = 4): string {
  if (!s) return "";
  if (s.length <= keep * 2) return "*".repeat(s.length);
  return s.slice(0, keep) + "***" + s.slice(-keep);
}

/**
 * Returns true when the minimum credentials required to connect to the active
 * exchange are present.
 *
 * Paper mode never requires API keys — returns true unconditionally.
 * Live mode requires apiKey + apiSecret (passphrase is optional for Gate.io).
 */
function hasKeys(): boolean {
  if (state.config.testMode) return true; // Paper mode: no keys needed
  return Boolean(state.creds.apiKey && state.creds.apiSecret);
}

function asExchangeCreds(): ExchangeCreds {
  if (state.config.testMode) {
    // Paper mode: never pass real keys — use simulate flag to bypass all exchange calls
    return {
      apiKey:   "PAPER",
      secret:   "PAPER",
      password: undefined,
      exchange: state.activeExchange,
      paper:    true,
      simulate: true,
    };
  }
  return {
    apiKey:   state.creds.apiKey,
    secret:   state.creds.apiSecret,
    password: state.creds.passphrase,
    exchange: state.activeExchange,
    paper:    false,
    simulate: false,
  };
}

export function getActiveExchange(): "binance" | "bybit" | "gateio" {
  return state.activeExchange;
}

export function setOwnerUserId(uid: number | null): void {
  state.ownerUserId = uid && uid > 0 ? uid : null;
}

export function setActiveExchange(
  id: "binance" | "bybit" | "gateio",
  ownerUserId?: number | null,
): void {
  state.activeExchange = id;
  if (typeof ownerUserId === "number" && ownerUserId > 0) {
    state.ownerUserId = ownerUserId;
  }
  pushLog("info", `Active exchange set to ${id.toUpperCase()}`);
  void reloadActiveExchangeKeys();
  persistConfig();
}

export async function reloadActiveExchangeKeys(): Promise<void> {
  const keys = await store.loadActiveApiKey(
    state.activeExchange,
    state.ownerUserId ?? undefined,
  );
  state.creds = {
    apiKey: keys?.apiKey ?? "",
    apiSecret: keys?.apiSecret ?? "",
    passphrase: keys?.passphrase ?? "",
  };
  if (keys) pushLog("info", `${state.activeExchange.toUpperCase()} keys loaded from vault (${keys.apiKeyMask})`);
  else pushLog("warn", `No stored keys for ${state.activeExchange.toUpperCase()}`);
}

// ─── Risk config passthrough ─────────────────────────────────────────────────

export function setRiskConfig(patch: Partial<RiskConfig>): void {
  riskManager.updateConfig(patch);
  pushLog("info", `Risk config updated: ${JSON.stringify(patch)}`);
}

export function getRiskState() {
  return riskManager.getState();
}

export function forceRiskHalt(reason = "manual halt via API"): void {
  riskManager.forceHalt(reason);
  pushLog("warn", `Risk manager force-halted: ${reason}`);
  // Also stop the bot loop
  if (state.isRunning) stop("RISK_HALT");
}

export function clearRiskHalt(): void {
  riskManager.clearHalt();
  pushLog("info", "Risk manager halt cleared — trading can resume");
}

// ─── Candle refresh ───────────────────────────────────────────────────────────

const CANDLE_REFRESH_MS = 60_000; // refresh candles every 60 s
const CANDLE_LIMIT      = 210;    // fetch 210 candles (enough for EMA200+buffer)

async function refreshCandles(): Promise<void> {
  const now = Date.now();
  if (now - state.lastCandleFetch < CANDLE_REFRESH_MS && state.candles.length > 0) return;
  try {
    // Gate.io uses lowercase timeframe strings ("1h", "4h", "1d")
    const bar = state.candleBar.toLowerCase();
    const fresh = await exchangeService.getOHLCV(state.config.symbol, bar, CANDLE_LIMIT);
    if (fresh.length >= 20) {
      state.candles = fresh.map((c) => ({
        time:    c.timestamp,
        open:    c.open,
        high:    c.high,
        low:     c.low,
        close:   c.close,
        volume:  c.volume,
        volUsdt: 0,
      }));
      state.lastCandleFetch = now;
      logger.debug({ count: fresh.length, bar }, "bot: candles refreshed");
    }
  } catch (e) {
    logger.warn({ err: e }, "bot: candle refresh failed — using cached candles");
  }
}

// ─── Trading loop ────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (!state.isRunning) return;
  state.tickCount++;

  // Keep risk manager's daily PnL in sync
  riskManager.syncDailyPnl(state.dailyPnL);

  // ── Auto symbol selection: periodic market re-scan ────────────────────────
  if (
    state.config.symbolSelectionMode === "auto" &&
    !state.position &&
    !state.scannerBusy &&
    Date.now() - state.lastScanTime >= state.config.scanIntervalMinutes * 60_000
  ) {
    state.scannerBusy = true;
    void (async () => {
      try {
        pushLog("info", `[AutoScan] Scanning ${state.config.approvedSymbols.join(", ")}…`);
        const report = await marketScannerService.scanMarkets(
          state.config.approvedSymbols,
          state.config.minimumMarketScore,
        );
        state.lastScanResults = report.results;
        state.lastScanTime    = Date.now();
        if (report.best) {
          const selected = normalizeSymbol(report.best.symbol);
          state.selectedSymbol   = selected;
          state.scannerState     = "QUALIFIED";
          state.scannerReason    = null;
          state.scannerBestScore = report.best.score;
          if (selected !== state.config.symbol) {
            pushLog("info", `[AutoScan] Symbol: ${state.config.symbol} → ${selected} (score ${report.best.score}/100, regime: ${report.best.regime})`);
            state.config.symbol   = selected;
            state.candles         = [];
            state.lastCandleFetch = 0;
          } else {
            pushLog("info", `[AutoScan] Holding ${selected} (score ${report.best.score}/100, regime: ${report.best.regime})`);
          }
        } else {
          const allScored    = report.results.filter(r => !r.rejected);
          const topScore     = allScored.length > 0 ? Math.max(...allScored.map(r => r.score)) : 0;
          const minScore     = state.config.minimumMarketScore;
          state.selectedSymbol   = null;
          state.scannerState     = "WAITING";
          state.scannerBestScore = topScore;
          state.scannerReason    = `No market qualified. Best score ${topScore}/${minScore}.`;
          pushLog("info", `[AutoScan] No qualified market found — best score: ${topScore}/100, minimum required: ${minScore} — entering WAITING state. Next scan in ${state.config.scanIntervalMinutes} minutes.`);
        }
      } catch (e) {
        pushLog("warn", `[AutoScan] Scan error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        state.scannerBusy = false;
      }
    })();
  }

  // ── WAITING guard: auto mode with no qualified symbol ────────────────────
  if (
    state.config.symbolSelectionMode === "auto" &&
    state.selectedSymbol === null &&
    state.lastScanTime > 0
  ) {
    logger.info("[AutoScan] WAITING — no qualified market, skipping strategy execution");
    if (state.isRunning) {
      state.loopHandle = setTimeout(() => { void tick(); }, state.config.tickMs);
    }
    return;
  }

  try {
    const t = await exchangeService.getTicker(state.config.symbol);
    if (!t) throw new Error(`No price data available for ${state.config.symbol}`);
    state.lastPrice = t.last;
    state.priceHistory.push(t.last);
    if (state.priceHistory.length > 300) state.priceHistory.shift();
    // Live PnL — update every open position for this symbol in the portfolio registry
    portfolioRegistry.updatePrice(state.config.symbol, t.last);

    // ── Refresh OHLCV candles and run active strategy engine ──────────────
    await refreshCandles();

    const riskState2 = riskManager.getState();
    const engine = resolveStrategy(state.activeStrategy);
    const sig: StrategySignal = engine.fn({
      candles:         state.candles,
      currentPrice:    t.last,
      dailyTradeCount: riskState2.dailyTradeCount,
    });
    state.lastStrategy       = sig;
    state.lastIndicatorUpdate = Date.now();

    // Emit [Signal] on every tick so the console stays live
    const _vr = (sig.currentVol != null && sig.avgVol != null && sig.avgVol > 0)
      ? (sig.currentVol / sig.avgVol).toFixed(2) + "x"
      : "—";
    pushLog("info",
      `[Signal] ${state.config.symbol} RSI=${sig.rsi?.toFixed(1) ?? "?"} VOL=${_vr} → ${sig.action}` +
      (sig.confidence > 0 ? ` (${sig.confidence}%)` : "") +
      ` — ${sig.reason}`
    );

    // ── Advanced risk: ATR volatility tracking (every tick) ───────────────
    advancedRiskEngine.trackVolatility(sig.atr ?? 0, t.last);

    // ── Advanced risk: concurrent losing positions check ──────────────────
    const lossPositions = portfolioRegistry.getAll().filter(p => p.unrealizedPnl < 0).length;
    if (lossPositions > 0) advancedRiskEngine.checkConcurrentLosses(lossPositions);

    // Map strategy signal → bot's currentSignal (UI-visible)
    const rsi       = sig.rsi ?? 50;
    const trend     = t.last > (state.priceHistory[0] ?? t.last) ? 1 : -1;
    const aiScore   = sig.action === "BUY" ? 80 + sig.confidence * 0.2
                    : sig.action === "SELL" ? 15
                    : sig.action === "SHORT" ? 15
                    : 50;
    state.currentSignal = {
      rsi,
      macd:   0,
      trend,
      aiScore: Math.round(aiScore),
      atr:    sig.atr ?? undefined,
      price:  t.last,
      action:     sig.action,
      confidence: sig.confidence,
      ema50:      sig.ema50,
      ema200:     sig.ema200,
      currentVol: sig.currentVol,
      avgVol:     sig.avgVol,
      strategyReason: sig.reason,
      // Phase 8.7 — display-only dual-mode indicator (no execution change).
      mode:              sig.mode ?? null,
      conditionsMet:     sig.conditionsMet ?? null,
      conditionsTotal:   sig.conditionsTotal ?? null,
      missingConditions: sig.missingConditions ?? null,
    };

    // ── Check if risk manager has halted trading ─────────────────────────
    const riskState = riskManager.getState();
    if (riskState.isHalted) {
      if (state.position) {
        // Emergency: close open position when halted
        pushLog("warn", `Risk halt active — closing open position. Reason: ${riskState.haltReason}`);
        await closePosition("risk_halt", t.last);
      }
      if (state.isRunning) {
        pushLog("warn", `Bot stopping due to risk halt: ${riskState.haltReason}`);
        state.isRunning = false;
      }
      return;
    }

    // ── Manage open position ─────────────────────────────────────────────
    if (state.position) {
      const p = state.position;
      // Skip SL/TP check if close is already pending (job in queue)
      if (!p.closePending) {
        let reason: string | null = null;
        if (t.last >= p.tp) reason = "take_profit";
        else if (t.last <= p.sl) reason = "stop_loss";
        if (reason) {
          await closePosition(reason, t.last);
        } else if (sig.action === "SELL") {
          // Graceful exit: strategy says conditions reversed (before SL/TP hits)
          pushLog("info", `[Strategy] SELL signal — closing position early. ${sig.reason}`);
          await closePosition("strategy_exit", t.last);
        }
      }
    } else if (!state.entryPending && hasKeys() && sig.action === "BUY" && sig.canTrade) {
      // Portfolio guard — checks exposure, per-symbol, per-strategy, and max positions
      const pg = portfolioRegistry.canOpen(
        state.config.symbol,
        state.activeEngine,
        state.config.orderSizeUsdt,
      );
      if (pg.allowed) {
        // Advanced risk engine gate: halt / cooldown / volatility block
        const ar = advancedRiskEngine.canTrade();
        if (ar.allowed) {
          // All guards passed — execute entry
          pushLog("info", `[Strategy] BUY signal (${sig.confidence}% confidence) — ${sig.reason}`);
          await openPosition(t.last, sig.stopLossPct ?? undefined, sig.takeProfitPct ?? undefined);
        } else if (state.tickCount % 12 === 0) {
          pushLog("warn", `${ar.reason}`);
        }
      } else if (state.tickCount % 12 === 0) {
        // Throttle-log portfolio block to avoid SSE spam (once per ~12 ticks)
        pushLog("info", `[Portfolio] Entry blocked — ${pg.reason}`);
      }
    }

    // ── Daily loss check — hard enforcement via riskService ──────────────
    try {
      checkDailyLoss(state.dailyPnL);
    } catch (e) {
      if (e instanceof RiskError) {
        pushLog("warn", `[Risk] Daily loss halt: ${e.message}`);
        if (state.position) await closePosition("daily_loss_halt", state.lastPrice);
        state.isRunning = false;
        return;
      }
      throw e;
    }
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
    pushLog("error", `tick failed: ${state.lastError}`);
  } finally {
    if (state.isRunning) {
      state.loopHandle = setTimeout(() => { void tick(); }, state.config.tickMs);
    }
  }
}

// ─── Open position — enqueue via BullMQ ──────────────────────────────────────

async function openPosition(
  price: number,
  slPctOverride?: number,   // ATR-based SL fraction — overrides config.stopLoss
  tpPctOverride?: number,   // ATR-based TP fraction — overrides config.takeProfit
): Promise<void> {
  // FAILSAFE: if any error occurs, block the trade
  try {
    if (state.entryPending) {
      pushLog("warn", "[Queue] Entry already pending — skipping duplicate open");
      return;
    }

    const symbol   = state.config.symbol;
    const correlationId = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Phase 13 — Configuration Authority resolves SL/TP/size from active mode config.
    // Defaults (strategy + strategy + auto_risk) preserve existing behaviour exactly.
    const resolved = tradingParamsService.resolve(price, {
      strategySlPct:  slPctOverride,
      strategyTpPct:  tpPctOverride,
      configSlPct:    state.config.stopLoss,
      configTpPct:    state.config.takeProfit,
      configSizeUsdt: state.config.orderSizeUsdt,
      atr:            state.lastStrategy?.atr ?? undefined,
      balance:        state.balanceUSDT,
    });
    const stopLossPct   = resolved.slPct;
    const takeProfitPct = resolved.tpPct;
    const sizeUsdt      = resolved.sizeUsdt;

    // Mark entry as pending to prevent duplicate enqueues
    state.entryPending = true;

    const slLabel = resolved.slSource;
    const tpLabel = resolved.tpSource;

    pushLog("info",
      `[Queue] Enqueueing TRADE_ENTRY: ${symbol} $${sizeUsdt} @ ${price.toFixed(2)} ` +
      `SL=${slLabel} TP=${tpLabel} (${state.config.testMode ? "PAPER" : "LIVE"})`
    );

    await enqueueTradeEntry({
      userId: state.ownerUserId ?? 0,
      source: "BOT",
      symbol,
      sizeUsdt,
      balanceFreeUsdt: state.balanceUSDT,
      currentPrice:  price,
      stopLossPct,
      takeProfitPct,
      isPaper:  state.config.testMode,
      creds:    asExchangeCreds(),
      correlationId,
    });
  } catch (e) {
    state.entryPending = false;
    pushLog("error", `[Queue] Failed to enqueue trade entry: ${e instanceof Error ? e.message : String(e)}`);
    logger.error({ err: e }, "bot: openPosition failed to enqueue job — trade blocked (failsafe)");
  }
}
/**
 * Phase 15 — Manual Trading Center entry.
 * Uses the same BullMQ + worker + risk validation pipeline as automated entries.
 * The current engine is intentionally long-only for live execution: BUY opens a
 * long position. SELL remains the close/exit action until a first-class short
 * position model is implemented.
 */
export async function openManualPosition(input: {
  symbol: string;
  sizeUsdt: number;
  tpPct?: number;
  slPct?: number;
  strategy?: string;
}): Promise<{ ok: boolean; error?: string; correlationId?: string }> {
  const symbol = normalizeSymbol(input.symbol);
  const sizeUsdt = Number(input.sizeUsdt);
  if (!symbol) return { ok: false, error: "Invalid symbol" };
  if (!Number.isFinite(sizeUsdt) || sizeUsdt < 5) return { ok: false, error: "Manual position must be at least $5 USDT" };
  const manualRisk = await getUserRiskManager(state.ownerUserId ?? 0, "MANUAL");
  if (manualState.positions.has(symbol) || manualState.entryPending.has(symbol)) {
    return { ok: false, error: `A manual position is already open or pending for ${symbol}` };
  }
  if (manualRisk.getState().isHalted) {
    return { ok: false, error: `Manual trading halted: ${manualRisk.getState().haltReason ?? "risk limit"}` };
  }

  const ticker = await exchangeService.getTicker(symbol);
  const price = ticker?.last ?? 0;
  if (!price || price <= 0) return { ok: false, error: `No live price available for ${symbol}` };

  const slPct = input.slPct ?? (tradingParamsService.getConfig().fixedSlPct * 100);
  const tpPct = input.tpPct ?? (tradingParamsService.getConfig().fixedTpPct * 100);
  if (slPct <= 0 || tpPct <= 0) return { ok: false, error: "TP and SL must be positive percentages" };

  manualState.entryPending.add(symbol);
  const correlationId = `manual-entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pushLog("info", `[Manual] BUY ${symbol} $${sizeUsdt.toFixed(2)} @ ${price.toFixed(2)} | TP=${tpPct.toFixed(2)}% SL=${slPct.toFixed(2)}%`);

  try {
    await enqueueTradeEntry({
      userId: state.ownerUserId ?? 0,
      source: "MANUAL",
      symbol,
      sizeUsdt,
      balanceFreeUsdt: state.balanceUSDT,
      currentPrice: price,
      stopLossPct: slPct / 100,
      takeProfitPct: tpPct / 100,
      isPaper: state.config.testMode,
      creds: asExchangeCreds(),
      correlationId,
    });
    return { ok: true, correlationId };
  } catch (e) {
    manualState.entryPending.delete(symbol);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Open a BUY Limit Order (async fill via limitOrderMonitor) ───────────────

/**
 * Place a BUY limit order. The order is persisted immediately in the DB.
 * limitOrderMonitor polls for the fill and calls handleLimitFill when filled.
 * No BullMQ job is enqueued here — the lifecycle starts on fill.
 */
export async function openLimitOrder(input: {
  symbol:      string;
  sizeUsdt:    number;
  limitPrice:  number;
  tpPct?:      number;
  slPct?:      number;
  strategy?:   string;
}): Promise<{ ok: boolean; error?: string; orderId?: string }> {
  const symbol     = normalizeSymbol(input.symbol);
  const sizeUsdt   = Number(input.sizeUsdt);
  const limitPrice = Number(input.limitPrice);

  if (!symbol)                                         return { ok: false, error: "Invalid symbol" };
  if (!Number.isFinite(sizeUsdt)  || sizeUsdt   < 5)  return { ok: false, error: "Position must be at least $5 USDT" };
  if (!Number.isFinite(limitPrice)|| limitPrice <= 0)  return { ok: false, error: "A valid limit price is required" };
  if (riskManager.getState().isHalted)                 return { ok: false, error: `Trading halted: ${riskManager.getState().haltReason ?? "risk limit"}` };

  const slPct = input.slPct ?? (tradingParamsService.getConfig().fixedSlPct * 100);
  const tpPct = input.tpPct ?? (tradingParamsService.getConfig().fixedTpPct * 100);
  if (slPct <= 0 || tpPct <= 0) return { ok: false, error: "TP and SL must be positive percentages" };

  const qty = sizeUsdt / limitPrice;

  // Persist order to DB first — gives us an orderId
  const order = await createOrder({
    userId:      state.ownerUserId ?? 0,
    symbol,
    side:        "BUY",
    orderType:   "LIMIT",
    limitPrice,
    quantity:    qty,
    source:      "MANUAL",
    exchange:    "gateio",
    isPaper:     state.config.testMode,
    tpPct,
    slPct,
    strategy:    input.strategy ?? "manual",
    status:      "open",
  });

  if (!order) return { ok: false, error: "Failed to persist limit order to database" };

  // For live trading: place on exchange and store exchangeOrderId
  if (!state.config.testMode) {
    try {
      const creds    = asExchangeCreds();
      const ex       = trade.connect(creds);
      const ccxtSym  = trade.toCcxtSymbol(symbol);
      const exchOrder = await ex.createOrder(ccxtSym, "limit", "buy", qty, limitPrice);
      await updateOrderRecord(order.orderId, { exchangeOrderId: exchOrder.id });
      pushLog("info", `[Limit] LIVE limit order placed on exchange: ${symbol} qty=${qty.toFixed(6)} @ $${limitPrice}`);
    } catch (e) {
      // Roll back DB order if exchange placement fails
      await cancelOrderDb(order.orderId);
      return { ok: false, error: `Exchange order placement failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    pushLog("info", `[Limit] PAPER limit order created: ${symbol} qty=${qty.toFixed(6)} @ $${limitPrice} (fills when market price ≤ $${limitPrice})`);
  }

  publishEvent({
    type:    "order:created",
    payload: { orderId: order.orderId, symbol, side: "BUY", orderType: "LIMIT", limitPrice, qty, isPaper: state.config.testMode },
    ts:      new Date().toISOString(),
  });

  pushLog("info", `[Limit] Order ${order.orderId} open | ${symbol} $${sizeUsdt.toFixed(2)} @ $${limitPrice} | TP=${tpPct.toFixed(2)}% SL=${slPct.toFixed(2)}%`);

  return { ok: true, orderId: order.orderId };
}

// ─── Close position — enqueue via BullMQ ─────────────────────────────────────

async function closePosition(reason: string, exitPrice: number): Promise<void> {
  if (!state.position) return;
  if (state.position.closePending) {
    pushLog("warn", `[Queue] Close already pending for ${state.config.symbol} — skipping duplicate close`);
    return;
  }

  const p = state.position;
  const symbol = state.config.symbol;
  const correlationId = `exit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Mark position as close-pending to prevent duplicate close attempts
  state.position = { ...p, closePending: true };

  pushLog("warn", `[Queue] Enqueueing TRADE_EXIT: ${symbol} qty=${p.qty} @ ${exitPrice.toFixed(2)} reason=${reason} (${state.config.testMode ? "PAPER" : "LIVE"})`);

  try {
    await enqueueTradeExit({
      userId: state.ownerUserId ?? 0,
      source: "BOT",
      symbol,
      qty: p.qty,
      currentPrice: exitPrice,
      reason,
      entryPrice: p.entry,
      entryOrderId: String(p.orderId),
      openedAt: p.time,
      isPaper: state.config.testMode,
      creds: asExchangeCreds(),
      correlationId,
    });
  } catch (e) {
    // If enqueueing fails, clear the pending flag so the next tick can retry
    if (state.position) state.position = { ...state.position, closePending: false };
    pushLog("error", `[Queue] Failed to enqueue trade exit: ${e instanceof Error ? e.message : String(e)}`);
    logger.error({ err: e, symbol, reason }, "bot: closePosition failed to enqueue — will retry next tick");
  }
}

// ─── Trade result callbacks (called by tradeWorker when jobs complete) ────────

/**
 * Called when a TRADE_ENTRY job completes.
 * Updates bot in-memory state (position, counters, logs) and sends Telegram.
 */
function handleManualEntryFilled(result: TradeEntryResult): void {
  manualState.entryPending.delete(result.symbol);
  if (!result.success) {
    logger.warn({ symbol: result.symbol, error: result.error }, "manual entry blocked/failed");
    return;
  }

  manualState.positions.set(result.symbol, {
    entry: result.fillPrice,
    qty: result.fillQty,
    orderId: result.orderId,
    time: result.executedAt,
    tp: result.tpPrice,
    sl: result.slPrice,
    dryRun: result.isPaper,
    closePending: false,
  });
  // Limit fills bypass the BullMQ entry worker, so record their risk state and
  // fill ledger here. Market fills already recorded risk/trades in the worker.
  if (result.correlationId.startsWith("limit-fill-")) {
    void getUserRiskManager(result.userId, "MANUAL").then((rm) => {
      rm.recordEntry(
        result.symbol,
        "buy",
        result.fillPrice,
        result.fillQty,
        result.fillPrice * result.fillQty,
        result.slPrice,
        result.tpPrice,
      );
    });
    void store.persistTrade({
      symbol: result.symbol,
      side: "BUY",
      kind: "ENTRY",
      qty: result.fillQty,
      price: result.fillPrice,
      notionalUsd: result.fillPrice * result.fillQty,
      isPaper: result.isPaper,
      exchangeOrderId: result.orderId,
    });
  }
  void store.upsertPosition({
    positionId: String(result.orderId),
    symbol: result.symbol,
    source: "MANUAL",
    strategy: "manual",
    entryPrice: result.fillPrice,
    currentPrice: result.fillPrice,
    quantity: result.fillQty,
    originalQuantity: result.fillQty,
    sizeUsdt: result.safeAmountUsdt,
    stopLoss: result.slPrice,
    takeProfit: result.tpPrice,
    initialStopLoss: result.slPrice,
    initialTakeProfit: result.tpPrice,
    riskAmountUsd: result.riskAmountUsd,
    isPaper: result.isPaper,
  });
  publishEvent({
    type: "position:update",
    payload: { action: "manual_open", symbol: result.symbol, source: "MANUAL" },
    ts: new Date().toISOString(),
  });
  logger.info(
    { symbol: result.symbol, orderId: result.orderId, fillPrice: result.fillPrice, fillQty: result.fillQty },
    "manual entry filled — kept outside bot state",
  );
}

function handleEntryFilled(result: TradeEntryResult): void {
  if (result.source === "MANUAL") {
    handleManualEntryFilled(result);
    return;
  }
  state.entryPending = false;

  if (!result.success) {
    pushLog("warn", `[Worker] Entry blocked/failed: ${result.error}`);
    return;
  }

  const symbol = result.symbol;
  state.position = {
    entry:   result.fillPrice,
    qty:     result.fillQty,
    orderId: result.orderId,
    time:    result.executedAt,
    tp:      result.tpPrice,
    sl:      result.slPrice,
    dryRun:  result.isPaper,
    closePending: false,
  };
  emitPositionEvent({ type: "open", symbol });

  pushLog(
    "info",
    `[Execution] ENTRY filled ${symbol} orderId=${result.orderId} @ ${result.fillPrice.toFixed(2)} qty=${result.fillQty} (${result.isPaper ? "PAPER" : "LIVE"})`,
  );

  // ── Auto-journal: create entry record from real execution data ────────────
  try {
    tradeJournal.create({
      tradeId:      String(result.orderId),
      symbol,
      strategyId:   state.activeStrategy,
      strategyName: state.activeEngine,
      side:         "buy",
      entryPrice:   result.fillPrice,
      exitPrice:    null,
      pnlUsd:       null,
      pnlPct:       null,
      marketRegime: "unknown",
      reasoning:    (state.lastStrategy as { strategyReason?: string } | null)?.strategyReason
                      ?? (state.lastStrategy as { reason?: string } | null)?.reason
                      ?? "",
      confidence:   Math.round(
                      ((state.lastStrategy as { confidence?: number } | null)?.confidence ?? 70),
                    ),
      tags:         result.isPaper ? ["paper"] : ["live"],
      notes:        "",
      status:       "open",
      entryTime:    new Date(result.executedAt).toISOString(),
      exitTime:     null,
    });
  } catch (journalErr) {
    logger.warn({ err: journalErr }, "bot: failed to create journal entry (non-fatal)");
  }

  // Register position in portfolio registry (multi-position tracking layer)
  portfolioRegistry.register({
    id:         String(result.orderId),
    symbol,
    strategy:   state.activeEngine,
    entryPrice: result.fillPrice,
    qty:        result.fillQty,
    sizeUsdt:   result.safeAmountUsdt,
    slPrice:    result.slPrice,
    tpPrice:    result.tpPrice,
    dryRun:     result.isPaper,
  });
  {
    const snap = portfolioRegistry.getSnapshot();
    pushLog("info", `[Portfolio] ${snap.openCount} open | exposure $${snap.totalExposureUsdt.toFixed(2)} USDT`);
  }
  pushLog(
    "info",
    `[Position] OPENED ${symbol} orderId=${result.orderId} entry=${result.fillPrice.toFixed(2)} qty=${result.fillQty} SL=${result.slPrice.toFixed(2)} TP=${result.tpPrice.toFixed(2)}`,
  );

  // Also record in global riskManager so positionMonitor can track SL/TP
  riskManager.recordEntry(
    symbol, "buy",
    result.fillPrice, result.fillQty,
    result.fillPrice * result.fillQty,
    result.slPrice, result.tpPrice,
  );

  // Register context with tradeMonitorService (final safety layer)
  // Provides creds + userId so the monitor can enqueue exits independently
  registerMonitorContext(symbol, {
    userId:  result.userId,
    creds:   asExchangeCreds(),
    isPaper: result.isPaper,
  });

  // Register with Phase 11 position lifecycle manager
  // correlationId prefix distinguishes manual entries ("manual-entry-...") from
  // automated ones ("entry-...") — see openManualPosition() / openPosition().
  const isManualEntry = result.correlationId.startsWith("manual-entry-");
  positionLifecycleManager.register(
    symbol,
    result.fillPrice,
    result.slPrice,
    result.tpPrice,
    state.activeStrategy,
    (state.lastStrategy as { atr?: number } | null)?.atr ?? undefined,
    undefined,
    {
      positionId: String(result.orderId),
      source:     isManualEntry ? "MANUAL" : "BOT",
      isPaper:    result.isPaper,
      sizeUsdt:   result.safeAmountUsdt,
      qty:        result.fillQty,
    },
  );

  pushLog(
    "info",
    `BUY ${symbol} $${result.safeAmountUsdt.toFixed(2)} @ ${result.fillPrice.toFixed(2)} | TP ${result.tpPrice.toFixed(2)} | SL ${result.slPrice.toFixed(2)}${result.isPaper ? " [PAPER]" : ""}`,
  );
  telegramNotifier.notify("TRADE_OPENED", {
    symbol,
    sizeUsdt:   result.safeAmountUsdt,
    entryPrice: result.fillPrice,
    tpPrice:    result.tpPrice,
    slPrice:    result.slPrice,
    isPaper:    result.isPaper,
  });
}

/**
 * Called when a TRADE_EXIT job completes (success or failure).
 * Always clears the position to prevent zombie positions.
 */
function handleManualExitFilled(result: TradeExitResult): void {
  const p = manualState.positions.get(result.symbol);
  if (!p) return;

  const closedTrade: ClosedTrade = {
    id: String(p.orderId),
    symbol: result.symbol,
    side: "long",
    entry: p.entry,
    exit: result.fillPrice,
    qty: result.fillQty,
    pnlUsd: result.pnlUsd,
    pnlPct: result.pnlPct,
    reason: result.reason,
    holdMins: Math.round((result.executedAt - p.time) / 60_000),
    dryRun: result.isPaper,
    time: new Date(result.executedAt).toISOString(),
  };
  manualState.trades.unshift(closedTrade);
  if (manualState.trades.length > 100) manualState.trades.length = 100;
  manualState.positions.delete(result.symbol);
  publishEvent({
    type: "position:update",
    payload: { action: "manual_close", symbol: result.symbol, source: "MANUAL", pnlUsd: result.pnlUsd },
    ts: new Date().toISOString(),
  });
  void store.closePositionRecord(String(p.orderId), {
    realizedPnlUsd: result.pnlUsd,
    closeReason: result.reason,
    finalPrice: result.fillPrice,
  });
}

function handleExitFilled(result: TradeExitResult): void {
  if (result.source === "MANUAL") {
    handleManualExitFilled(result);
    return;
  }
  if (!state.position) return;

  const p = state.position;
  const symbol = result.symbol;

  const pnlUsd = result.pnlUsd;
  const pnlPct = result.pnlPct;

  state.dailyPnL += pnlUsd;
  state.totalTrades++;
  if (pnlUsd >= 0) state.winningTrades++; else state.losingTrades++;

  // Paper mode: update virtual balance with simulated PnL
  if (state.config.testMode) {
    state.balanceUSDT = Math.max(0, state.balanceUSDT + pnlUsd);
  }

  // Advanced risk: record trade outcome (updates loss streak, PnL buckets, evaluate state)
  advancedRiskEngine.recordTradePnl(pnlUsd);
  // Reflect updated balance in drawdown calculation
  advancedRiskEngine.updateBalance(state.balanceUSDT);
  positionSizingService.updateBalance(state.balanceUSDT);

  const closedTrade: ClosedTrade = {
    id: String(p.orderId),
    symbol,
    side: "long",
    entry: p.entry,
    exit: result.fillPrice,
    qty: result.fillQty,
    pnlUsd,
    pnlPct,
    reason: result.reason,
    holdMins: Math.round((result.executedAt - p.time) / 60_000),
    dryRun: result.isPaper,
    time: new Date(result.executedAt).toISOString(),
  };
  state.trades.unshift(closedTrade);
  if (state.trades.length > 100) state.trades.length = 100;

  // Deregister from portfolio registry (keyed by orderId)
  portfolioRegistry.deregister(String(p.orderId));
  {
    const snap = portfolioRegistry.getSnapshot();
    pushLog(
      "info",
      `[Portfolio] ${snap.openCount} open | unrealized P&L $${snap.totalUnrealizedPnl.toFixed(2)} | realized this trade $${pnlUsd.toFixed(2)}`,
    );
  }

  // ── P&L validation: verify stored PnL matches entry/exit/qty arithmetic ──
  {
    const entryPx   = p.entry;
    const exitPx    = result.fillPrice;
    const fillQty   = result.fillQty;
    const storedPnl = result.pnlUsd;

    // For a long (BUY entry → SELL exit): grossPnL = (exitPrice − entryPrice) × qty
    const calcPnl    = (exitPx - entryPx) * fillQty;
    const absDiff    = Math.abs(calcPnl - storedPnl);
    const pnlBase    = Math.max(Math.abs(calcPnl), 1e-8);   // guard against /0
    const diffPct    = (absDiff / pnlBase) * 100;
    const passed     = diffPct <= 0.01;
    const calcPnlPct = ((exitPx - entryPx) / entryPx) * 100;

    pushLog(
      passed ? "info" : "error",
      `[Trade Validation] Entry: ${entryPx.toFixed(6)} Exit: ${exitPx.toFixed(6)} ` +
      `Qty: ${fillQty.toFixed(8)} Calculated PnL: ${calcPnl.toFixed(6)} ` +
      `Stored PnL: ${storedPnl.toFixed(6)} Status: ${passed ? "PASS" : `FAIL (Δ${diffPct.toFixed(4)}%)`}`,
    );

    if (!passed) {
      logger.error(
        { symbol, entryPx, exitPx, fillQty, storedPnl, calcPnl, diffPct },
        "bot: P&L validation FAILED — stored PnL does not match calculated PnL; " +
        "journal will use recalculated (mathematically correct) value",
      );
    }

    // Always write mathematically consistent values to the journal.
    // If stored PnL passed validation, use it verbatim; otherwise use recalculated.
    const journalPnl    = passed ? storedPnl   : calcPnl;
    const journalPnlPct = passed ? result.pnlPct : calcPnlPct;

    // ── Auto-journal: close the open entry created on handleEntryFilled ──
    try {
      tradeJournal.closeEntry(String(p.orderId), {
        exitPrice: exitPx,
        pnlUsd:    journalPnl,
        pnlPct:    journalPnlPct,
        exitTime:  new Date(result.executedAt).toISOString(),
      });
    } catch (journalErr) {
      logger.warn({ err: journalErr }, "bot: failed to close journal entry (non-fatal)");
    }
  }

  state.position = null;
  emitPositionEvent({ type: "close", symbol });
  state.entryPending = false;

  // Sync exit with global riskManager (positionMonitor uses it)
  riskManager.recordExit(symbol, pnlUsd);
  riskManager.syncDailyPnl(state.dailyPnL);

  // Clear tradeMonitorService context — position is fully closed
  clearMonitorContext(symbol);
  // Deregister from Phase 11 lifecycle manager
  positionLifecycleManager.deregister(symbol);
  // Mark the persisted position row closed (P0 Fix #4/#5 — position persistence)
  void store.closePositionRecord(String(p.orderId), {
    realizedPnlUsd: pnlUsd,
    closeReason: result.reason,
    finalPrice: result.fillPrice,
  });

  pushLog(
    result.success ? "info" : "warn",
    `SELL ${symbol} @ ${result.fillPrice.toFixed(2)} | reason=${result.reason} | P&L $${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%)${result.isPaper ? " [PAPER]" : ""}${!result.success ? " [FAILED — position cleared]" : ""}`,
  );
  pushLog(
    result.success ? "info" : "warn",
    `[Trade Closed] ${symbol} orderId=${p.orderId} exit=${result.fillPrice.toFixed(2)} reason=${result.reason} P&L ${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%)${result.isPaper ? " [PAPER]" : ""}`,
  );
  {
    const r = result.reason.toLowerCase();
    const holdMs = result.executedAt - p.time;
    const eventType: Parameters<typeof telegramNotifier.notify>[0] =
      r === "manual_take_profit"                                        ? "MANUAL_TAKE_PROFIT"  :
      r === "manual_close"                                              ? "MANUAL_CLOSE"        :
      r.includes("tp") || r.includes("take_profit")                     ? "TRADE_CLOSED_TP"     :
      r.includes("sl") || r.includes("stop_loss") || r.includes("stop") ? "TRADE_CLOSED_SL"     :
      r.includes("manual") || r.includes("user")                        ? "TRADE_CLOSED_MANUAL" :
      r.includes("risk") || r.includes("halt") || r.includes("daily")   ? "TRADE_CLOSED_RISK"   :
      "TRADE_CLOSED";
    telegramNotifier.notify(eventType, {
      symbol,
      entryPrice: p.entry,
      exitPrice:  result.fillPrice,
      pnlUsd,
      pnlPct,
      holdMs,
      reason:     result.reason,
      isPaper:    result.isPaper,
    });
  }
}

// Register callbacks immediately so the worker can call back into bot state
/**
 * Called by limitOrderMonitor when a resting limit order fills.
 * Constructs a synthetic TradeEntryResult and routes it through the same
 * handleEntryFilled path as a market order — giving the filled limit order
 * the exact same position lifecycle, risk registration, and SSE events.
 */
function handleLimitFill(result: LimitFillResult): void {
  if (result.source === "BOT" && state.position) {
    pushLog("warn", `[Limit] Fill received for ${result.symbol} but a position is already open — skipping duplicate`);
    return;
  }
  if (result.source === "MANUAL" && manualState.positions.has(result.symbol)) {
    logger.warn({ symbol: result.symbol }, "manual limit fill skipped — manual position already open");
    return;
  }

  const slPct       = result.slPct / 100;
  const tpPct       = result.tpPct / 100;
  const slPrice     = result.fillPrice * (1 - slPct);
  const tpPrice     = result.fillPrice * (1 + tpPct);
  const notionalUsd = result.fillPrice * result.fillQty;

  const syntheticEntry: TradeEntryResult = {
    type:           "ENTRY_RESULT",
    source:         result.source,
    success:        true,
    correlationId:  result.correlationId,
    userId:         result.userId,
    symbol:         result.symbol,
    orderId:        result.exchangeOrderId,
    fillPrice:      result.fillPrice,
    fillQty:        result.fillQty,
    safeAmountUsdt: notionalUsd,
    slPrice,
    tpPrice,
    riskAmountUsd:  notionalUsd * slPct,
    isPaper:        result.isPaper,
    executedAt:     Date.now(),
  };

  pushLog("info", `[Limit] FILLED ${result.symbol} ${result.side} ${result.fillQty.toFixed(6)} @ $${result.fillPrice.toFixed(2)} — routing into position lifecycle`);
  handleEntryFilled(syntheticEntry);
}

/**
 * Called by tradeWorker when a partial close job completes.
 * Reduces state.position.qty and keeps the position open.
 * If remaining qty reaches zero, delegates to handleExitFilled for full cleanup.
 */
function handlePartialExitFilled(result: TradeExitResult): void {
  if (result.source === "MANUAL") {
    const p = manualState.positions.get(result.symbol);
    if (!p) return;
    const remaining = Math.max(0, p.qty - result.fillQty);
    if (remaining < 1e-8) {
      handleManualExitFilled({ ...result, isPartial: false });
      return;
    }
    manualState.positions.set(result.symbol, { ...p, qty: remaining, closePending: false });
    const pnlUsd = (result.fillPrice - p.entry) * result.fillQty;
    const pnlPct = ((result.fillPrice - p.entry) / p.entry) * 100;
    manualState.trades.unshift({
      id: String(p.orderId),
      symbol: result.symbol,
      side: "long",
      entry: p.entry,
      exit: result.fillPrice,
      qty: result.fillQty,
      pnlUsd,
      pnlPct,
      reason: result.reason,
      holdMins: Math.round((result.executedAt - p.time) / 60_000),
      dryRun: result.isPaper,
      time: new Date(result.executedAt).toISOString(),
    });
    if (manualState.trades.length > 100) manualState.trades.length = 100;
    void store.upsertPosition({
      positionId: String(p.orderId),
      symbol: result.symbol,
      source: "MANUAL",
      strategy: "manual",
      entryPrice: p.entry,
      currentPrice: result.fillPrice,
      quantity: remaining,
      originalQuantity: p.qty,
      sizeUsdt: p.entry * remaining,
      stopLoss: p.sl,
      takeProfit: p.tp,
      initialStopLoss: p.sl,
      initialTakeProfit: p.tp,
      realizedPnlUsd: pnlUsd,
      isPaper: result.isPaper,
    });
    publishEvent({
      type: "position:update",
      payload: { action: "manual_partial_close", symbol: result.symbol, remaining, pnlUsd, pnlPct, source: "MANUAL" },
      ts: new Date().toISOString(),
    });
    return;
  }
  if (!state.position) return;

  const p         = state.position;
  const closeQty  = result.fillQty;
  const remaining = Math.max(0, p.qty - closeQty);

  // Edge case: if remaining is effectively zero, treat as full close
  if (remaining < 1e-8) {
    handleExitFilled({ ...result, isPartial: false });
    return;
  }

  const pnlUsd = (result.fillPrice - p.entry) * closeQty;
  const pnlPct = ((result.fillPrice - p.entry) / p.entry) * 100;

  // Update in-memory position quantity
  state.position = { ...p, qty: remaining };

  // Accumulate realized PnL
  state.dailyPnL += pnlUsd;
  if (state.config.testMode) {
    state.balanceUSDT = Math.max(0, state.balanceUSDT + pnlUsd);
    advancedRiskEngine.updateBalance(state.balanceUSDT);
    positionSizingService.updateBalance(state.balanceUSDT);
  }

  // Update position lifecycle manager qty
  positionLifecycleManager.updateQty(result.symbol, remaining);

  // Persist partial exit trade record
  void store.persistTrade({
    symbol:          result.symbol,
    side:            "SELL",
    kind:            "EXIT",
    qty:             closeQty,
    price:           result.fillPrice,
    notionalUsd:     result.fillPrice * closeQty,
    pnlUsd,
    pnlPct,
    reason:          result.reason,
    isPaper:         result.isPaper,
    exchangeOrderId: result.orderId,
  });

  publishEvent({
    type:    "position:update",
    payload: { action: "partial_close", symbol: result.symbol, closeQty, remaining, pnlUsd, pnlPct },
    ts:      new Date().toISOString(),
  });

  pushLog(
    pnlUsd >= 0 ? "info" : "warn",
    `[Partial Close] ${result.symbol} closed ${closeQty.toFixed(6)} qty @ $${result.fillPrice.toFixed(2)} | Remaining: ${remaining.toFixed(6)} | P&L: ${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)}${result.isPaper ? " [PAPER]" : ""}`,
  );
}

onEntryFilled(handleEntryFilled);
onExitFilled(handleExitFilled);
onPartialExitFilled(handlePartialExitFilled);

// ─── Telegram ────────────────────────────────────────────────────────────────

export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  // ─── TRACE ────────────────────────────────────────────────────────────────
  logger.warn(
    { stack: new Error("[TRACE] bot:sendTelegram() called").stack, textPreview: text.slice(0, 120) },
    `[TRACE][${new Date().toISOString()}] bot:sendTelegram() | bot.ts:850`,
  );
  // ─────────────────────────────────────────────────────────────────────────
  return telegramNotifier.send(text);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function buildStatus() {
  const mode: "LIVE" | "PAPER" | "NO_KEYS" =
    !hasKeys() ? "NO_KEYS" : state.config.testMode ? "PAPER" : "LIVE";
  const winRate = state.totalTrades > 0
    ? ((state.winningTrades / state.totalTrades) * 100).toFixed(1)
    : "0";

  const risk = riskManager.getState();

  return {
    isRunning: state.isRunning,
    isKilled: state.isKilled,
    dryRun: state.config.testMode,
    testMode: state.config.testMode,
    symbol: state.config.symbol,
    lastPrice: state.lastPrice,
    position: state.position,
    dailyPnL: state.dailyPnL,
    totalTrades: state.totalTrades,
    winningTrades: state.winningTrades,
    losingTrades: state.losingTrades,
    winRate,
    tickCount: state.tickCount,
    uptime: state.isRunning ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
    currentSignal: state.currentSignal,
    lastError: state.lastError,
    balanceUSDT: state.balanceUSDT,

    entryPending: state.entryPending,
    hasApiKey: !!state.creds.apiKey,
    hasSecret: !!state.creds.apiSecret,
    hasPassphrase: !!state.creds.passphrase,
    hasTelegram: !!(state.telegram.token && state.telegram.chat),
    keysReady: hasKeys(),
    mode,
    apiKeyMask:  mask(state.creds.apiKey),
    secretMask:  mask(state.creds.apiSecret),
    tgTokenMask: mask(state.telegram.token),
    tgChatMask:  mask(state.telegram.chat),
    config: {
      symbol:               state.config.symbol,
      takeProfit:           state.config.takeProfit,
      stopLoss:             state.config.stopLoss,
      tickMs:               state.config.tickMs,
      maxDailyLoss:         state.config.maxDailyLoss,
      testMode:             state.config.testMode,
      orderSizeUsdt:        state.config.orderSizeUsdt,
      symbolSelectionMode:  state.config.symbolSelectionMode,
      approvedSymbols:      state.config.approvedSymbols,
    },
    // Phase 14 — single execution authority exposed to Bot Control UI.
    tradingParams: tradingParamsService.getConfig(),
    // Auto symbol selection scanner
    scanner: {
      mode:                state.config.symbolSelectionMode,
      approvedSymbols:     state.config.approvedSymbols,
      scanIntervalMinutes: state.config.scanIntervalMinutes,
      minimumMarketScore:  state.config.minimumMarketScore,
      lastScanAt:          state.lastScanTime > 0 ? new Date(state.lastScanTime).toISOString() : null,
      scannerBusy:         state.scannerBusy,
      results:             state.lastScanResults,
      bestSymbol:          state.lastScanResults.find(r => r.selected)?.symbol ?? null,
      bestScore:           state.scannerBestScore,
      bestRegime:          state.lastScanResults.find(r => r.selected)?.regime ?? null,
      selectedSymbol:      state.config.symbolSelectionMode === "auto" ? state.selectedSymbol : state.config.symbol,
      state:               (state.config.symbolSelectionMode === "auto" ? state.scannerState : "QUALIFIED") as "SCANNING" | "QUALIFIED" | "WAITING",
      reason:              state.scannerReason,
      minimumScore:        state.config.minimumMarketScore,
      nextScanInMs:        state.lastScanTime > 0
        ? Math.max(0, state.config.scanIntervalMinutes * 60_000 - (Date.now() - state.lastScanTime))
        : 0,
    },
    // Risk management state
    risk: {
      isHalted:         risk.isHalted,
      haltReason:       risk.haltReason,
      dailyPnlUsd:      risk.dailyPnlUsd,
      dailyTradeCount:  risk.dailyTradeCount,
      openPositionCount: risk.openPositionCount,
      openSymbols:      risk.openSymbols,
      msSinceLast:      risk.msSinceLast,
      config:           risk.config,
    },
    // Active strategy engine
    activeStrategy: state.activeStrategy,
    activeEngine:   state.activeEngine,

    // Strategy signal (latest from strategyService)
    strategy: state.lastStrategy ? {
      action:         state.lastStrategy.action,
      confidence:     state.lastStrategy.confidence,
      ema50:          state.lastStrategy.ema50,
      ema200:         state.lastStrategy.ema200,
      rsi:            state.lastStrategy.rsi,
      atr:            state.lastStrategy.atr,
      currentVol:     state.lastStrategy.currentVol,
      avgVol:         state.lastStrategy.avgVol,
      suggestedSl:    state.lastStrategy.suggestedSl,
      suggestedTp:    state.lastStrategy.suggestedTp,
      stopLossPct:    state.lastStrategy.stopLossPct,
      takeProfitPct:  state.lastStrategy.takeProfitPct,
      canTrade:       state.lastStrategy.canTrade,
      blockReason:    state.lastStrategy.blockReason,
      reason:         state.lastStrategy.reason,
      conditions:     state.lastStrategy.conditions,
    } : null,
    // Portfolio — full multi-position snapshot (live PnL, exposure, per-strategy breakdown)
    portfolio: portfolioRegistry.getSnapshot(),
    // Manual execution is deliberately exposed separately from Bot Operations
    // Center state and is never included in the bot portfolio snapshot.
    manual: {
      positions: getManualPositions(),
      trades: getManualTrades(),
      entryPending: Array.from(manualState.entryPending),
    },
    // Advanced risk engine — portfolio-wide halt/cooldown/volatility state
    advancedRisk: advancedRiskEngine.getStatus(),
    candleBar:           state.candleBar,
    candleCount:         state.candles.length,
    lastIndicatorUpdate: state.lastIndicatorUpdate,
    lastCandleTime:      state.lastCandleFetch,
    stopReason:          state.stopReason,
    // ── Long-term performance analytics ──────────────────────────────────
    performance:         performanceTracker.getSnapshot(),
  };
}

export function getLogs(): LogEntry[]      { return state.logs; }
export function getTrades(): ClosedTrade[] { return state.trades; }
export function getManualTrades(): ClosedTrade[] { return manualState.trades; }
export function getManualPositions(): Position[] { return Array.from(manualState.positions.values()); }
export function getLifecyclePositions()    { return positionLifecycleManager.getAll(); }

/**
 * Phase 11.1 — Trigger a manual close from an API request.
 * Reuses the full execution pipeline: BullMQ → tradeWorker → portfolio → journal → analytics → Telegram.
 * @param symbol  Normalised symbol (e.g. "BTCUSDT")
 * @param reason  "manual_take_profit" or "manual_close"
 */
export async function triggerManualClose(
  symbol: string,
  reason: "manual_take_profit" | "manual_close",
): Promise<{ ok: boolean; error?: string; currentPrice?: number }> {
  const normalised = normalizeSymbol(symbol);
  const manualPosition = manualState.positions.get(normalised);
  if (!manualPosition) {
    return { ok: false, error: "No open position" };
  }
  if (manualPosition.closePending) {
    return { ok: false, error: "A close is already pending — please wait" };
  }

  // Get live market price; fall back to last known entry if unavailable
  let price = manualPosition.entry;
  try {
    const ticker = await exchangeService.getTicker(normalised);
    if (ticker?.last && ticker.last > 0) price = ticker.last;
  } catch { /* non-fatal — use entry as fallback */ }

  manualState.positions.set(normalised, { ...manualPosition, closePending: true });
  try {
    await enqueueTradeExit({
      userId: state.ownerUserId ?? 0,
      source: "MANUAL",
      symbol: normalised,
      qty: manualPosition.qty,
      currentPrice: price,
      reason,
      entryPrice: manualPosition.entry,
      entryOrderId: String(manualPosition.orderId),
      openedAt: manualPosition.time,
      isPaper: state.config.testMode,
      creds: asExchangeCreds(),
      correlationId: `manual-exit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  } catch (e) {
    manualState.positions.set(normalised, { ...manualPosition, closePending: false });
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, currentPrice: price };
}

/**
 * Partially close an open position by percentage (25 / 50 / 75).
 * Enqueues a TRADE_EXIT job with closeQty < position qty.
 * tradeWorker uses closeQty for the actual sell amount; handlePartialExitFilled
 * reduces state.position.qty so the position remains open with reduced size.
 */
export async function triggerManualPartialClose(
  symbol: string,
  pct:    number,
): Promise<{ ok: boolean; error?: string; closeQty?: number; remainingQty?: number }> {
  const normalised = normalizeSymbol(symbol);
  const manualPosition = manualState.positions.get(normalised);
  if (!manualPosition) return { ok: false, error: "No open position" };

  if (manualPosition.closePending) {
    return { ok: false, error: "A close is already pending — please wait" };
  }
  if (![25, 50, 75].includes(pct)) {
    return { ok: false, error: "pct must be 25, 50, or 75" };
  }

  const currentQty = manualPosition.qty;
  let closeQty     = Math.round((currentQty * pct / 100) * 1_000_000) / 1_000_000; // 6 dp precision
  if (closeQty <= 0) return { ok: false, error: "Close quantity too small" };

  // If rounding reaches full qty, just do a full close
  if (closeQty >= currentQty) {
    return triggerManualClose(normalised, "manual_close");
  }

  const remainingQty = currentQty - closeQty;

  let price = manualPosition.entry;
  try {
    const ticker = await exchangeService.getTicker(normalised);
    if (ticker?.last && ticker.last > 0) price = ticker.last;
  } catch { /* non-fatal */ }

  const correlationId = `partial-exit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pushLog("warn", `[Manual] PARTIAL CLOSE ${pct}% of ${normalised}: selling ${closeQty.toFixed(6)} of ${currentQty.toFixed(6)} qty @ $${price.toFixed(2)}`);

  try {
    await enqueueTradeExit({
      userId:       state.ownerUserId ?? 0,
      source:       "MANUAL",
      symbol:       normalised,
      qty:          currentQty,
      closeQty,
      currentPrice: price,
      reason:       `manual_partial_close_${pct}pct`,
      entryPrice:   manualPosition.entry,
      entryOrderId: String(manualPosition.orderId),
      openedAt:     manualPosition.time,
      isPaper:      state.config.testMode,
      creds:        asExchangeCreds(),
      correlationId,
    });
    manualState.positions.set(normalised, { ...manualPosition, closePending: true });
    return { ok: true, closeQty, remainingQty };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function hydrateFromDb(): Promise<void> {
  try {
    const cfg = await store.loadActiveConfig();
    if (cfg) {
      state.config = {
        symbol:               cfg.symbol,
        takeProfit:           Number(cfg.takeProfit),
        stopLoss:             Number(cfg.stopLoss),
        tickMs:               cfg.tickMs,
        maxDailyLoss:         Number(cfg.maxDailyLoss),
        orderSizeUsdt:        Number(cfg.orderSizeUsdt),
        testMode:             cfg.testMode,
        symbolSelectionMode:  (cfg.symbolSelectionMode as "manual" | "auto" | null ?? "manual") === "auto" ? "auto" : "manual",
        approvedSymbols:      (() => {
          try { return JSON.parse(cfg.approvedSymbols ?? "[]") as string[]; }
          catch { return DEFAULT_CONFIG.approvedSymbols; }
        })(),
        scanIntervalMinutes:  cfg.scanIntervalMinutes ?? 15,
        minimumMarketScore:   cfg.minimumMarketScore  ?? 67,
      };
      const ex = String(cfg.exchange ?? "gateio").toLowerCase();
      if (ex === "binance" || ex === "bybit" || ex === "gateio") {
        state.activeExchange = ex;
      }
      // Sync risk manager's daily loss limit with bot config
      riskManager.updateConfig({ maxDailyLossUsd: Number(cfg.maxDailyLoss) });
      pushLog("info", `Config loaded from DB (exchange=${state.activeExchange.toUpperCase()}, symbol=${cfg.symbol})`);
    }
    const keys = await store.loadActiveApiKey(state.activeExchange);
    if (keys && !state.creds.apiKey) {
      state.creds = {
        apiKey: keys.apiKey,
        apiSecret: keys.apiSecret,
        passphrase: keys.passphrase,
      };
      pushLog("info", `${state.activeExchange.toUpperCase()} keys loaded from vault (${keys.apiKeyMask})`);
    }

    // ── Restore trading params config from DB (Phase 14 execution authority) ─
    await tradingParamsService.hydrate();
    const tpCfg = tradingParamsService.getConfig();
    riskManager.updateConfig({
      maxOpenPositions: tpCfg.maxOpenPositions,
      maxDailyLossUsd: tpCfg.maxDailyLossUsd,
      maxTradesPerDay: tpCfg.maxTradesPerDay,
      tradeCooldownMs: tpCfg.tradeCooldownMs,
      maxRiskPerTradePct: tpCfg.riskPerTradePct,
      maxPositionSizePct: tpCfg.maxPositionSizePct,
    });
    // ── Restore daily PnL + halt state from DB (survives server restarts) ────
    // MUST run AFTER risk config is updated so the loss limit is correct.
    await riskManager.hydrateFromDb();
    // Mirror the restored daily PnL back into bot state
    const riskState = riskManager.getState();
    state.dailyPnL = riskState.dailyPnlUsd;
    if (riskState.isHalted) {
      pushLog("warn", `⚠️  Risk halt restored from DB: ${riskState.haltReason}`);
    }
  } catch (e) {
    logger.error({ err: e }, "hydrateFromDb failed");
  }
}

// ─── Boot-time open-position restoration (P0 Fix #6) ──────────────────────────

export type ReconciliationStatus = "RECONCILED" | "RECONCILIATION_REQUIRED" | "POSITION_MISMATCH" | "NOT_APPLICABLE";

export interface RestorePositionsResult {
  restoredCount: number;
  restored: Array<{
    positionId: string;
    symbol: string;
    source: "BOT" | "MANUAL";
    isPaper: boolean;
    quantity: number;
    armedAsBotSlot: boolean;   // true if this position was assigned to state.position (see limitation note below)
    reconciliation: ReconciliationStatus;
    reconciliationDetail?: string;
  }>;
  /**
   * KNOWN LIMITATION: bot.ts uses a single `state.position` slot shared by
   * both automated and manual trades (see audit P1 Fix #8). If more than one
   * open position row exists, only the first is assigned to state.position —
   * the others are restored into riskManager/portfolioRegistry/
   * positionLifecycleManager (so P&L, analytics, and manual close/breakeven/
   * trailing/lock-profit actions work correctly) but their SL/TP-hit
   * auto-exit will NOT fire, since that trigger path is gated on
   * state.position. Reconciling this fully requires the multi-position
   * rework flagged in Fix #8, which is out of scope for this phase.
   */
  multiplePositionsWarning: boolean;
}

function guessBaseAsset(symbol: string): string {
  const KNOWN_QUOTES = ["USDT", "USDC", "BUSD", "USD", "EUR"];
  for (const q of KNOWN_QUOTES) {
    if (symbol.endsWith(q) && symbol.length > q.length) return symbol.slice(0, -q.length);
  }
  return symbol;
}

export async function restoreOpenPositionsFromDb(): Promise<RestorePositionsResult> {
  const result: RestorePositionsResult = { restoredCount: 0, restored: [], multiplePositionsWarning: false };
  try {
    const rows = await store.listOpenPositions();
    if (rows.length === 0) {
      logger.info("Startup: no open positions to restore");
      return result;
    }
    if (rows.length > 1) {
      result.multiplePositionsWarning = true;
      logger.warn(
        { count: rows.length },
        "Startup: multiple open position rows found, but bot.ts only supports one active slot (state.position) — " +
        "only the first will have automated SL/TP-hit exit armed. See audit P1 Fix #8.",
      );
    }

    let assignedBotSlot = false;

    for (const row of rows) {
      const qty = Number(row.quantity);
      const entryPrice = Number(row.entryPrice);
      const slPrice = row.stopLoss != null ? Number(row.stopLoss) : null;
      const tpPrice = row.takeProfit != null ? Number(row.takeProfit) : null;
      const openedAtMs = row.createdAt instanceof Date ? row.createdAt.getTime() : Date.now();
      const isBotPosition = row.source !== "MANUAL";
      const positionRisk = await getUserRiskManager(row.userId ?? state.ownerUserId ?? 0, row.source);

      // Restore into the source-specific risk state without side effects.
      positionRisk.restorePosition({
        symbol:      row.symbol,
        side:        "buy",
        entryPrice,
        qty,
        notionalUsd: Number(row.sizeUsdt),
        slPrice:     slPrice,
        tpPrice:     tpPrice,
        openedAt:    openedAtMs,
      });

      // Bot-only registries feed Bot Operations Center. Manual positions stay
      // in manualState and are never armed as bot slots or lifecycle entries.
      let armedAsBotSlot = false;
      if (isBotPosition) {
        portfolioRegistry.register({
          id:         row.positionId,
          symbol:     row.symbol,
          strategy:   row.strategy ?? "unknown",
          entryPrice,
          qty,
          sizeUsdt:   Number(row.sizeUsdt),
          slPrice:    slPrice ?? entryPrice,
          tpPrice:    tpPrice ?? entryPrice,
          dryRun:     row.isPaper,
          openedAt:   openedAtMs,
        });
        positionLifecycleManager.restore({
          positionId:     row.positionId,
          symbol:         row.symbol,
          source:         row.source,
          isPaper:        row.isPaper,
          sizeUsdt:       Number(row.sizeUsdt),
          originalQty:    Number(row.originalQuantity),
          entryPrice,
          currentSlPrice: slPrice,
          currentTpPrice: tpPrice,
          initialSlPrice: row.initialStopLoss != null ? Number(row.initialStopLoss) : slPrice,
          initialTpPrice: row.initialTakeProfit != null ? Number(row.initialTakeProfit) : tpPrice,
          strategyType:   row.strategy ?? "unknown",
          trailingActive: row.trailingActive,
          breakevenActive: row.breakevenActive,
          lockedProfitPct: row.lockedProfitPct,
          openedAt:       openedAtMs,
        });
      } else {
        manualState.positions.set(row.symbol, {
          entry: entryPrice,
          qty,
          orderId: row.positionId,
          time: openedAtMs,
          tp: tpPrice ?? entryPrice,
          sl: slPrice ?? entryPrice,
          dryRun: row.isPaper,
          closePending: false,
        });
      }

      if (isBotPosition && !assignedBotSlot) {
        state.position = {
          entry: entryPrice,
          qty,
          orderId: row.positionId,
          time: openedAtMs,
          tp: tpPrice ?? entryPrice,
          sl: slPrice ?? entryPrice,
          dryRun: row.isPaper,
          closePending: false,
        };
        state.config.symbol = row.symbol;
        assignedBotSlot = true;
        armedAsBotSlot = true;
      }

      // 5. Live-mode reconciliation against actual Gate.io balance.
      //    Gate.io here is spot trading — there's no "open position" object to
      //    query the way futures exchanges have; the closest honest signal is
      //    whether the exchange actually still holds the base-asset quantity
      //    this position claims. NOT_APPLICABLE for paper positions.
      let reconciliation: ReconciliationStatus = "NOT_APPLICABLE";
      let reconciliationDetail: string | undefined;
      if (!row.isPaper) {
        try {
          const bal = await exchangeService.fetchBalance();
          if (!bal.success) {
            reconciliation = "RECONCILIATION_REQUIRED";
            reconciliationDetail = `Could not fetch Gate.io balance: ${bal.error ?? "unknown error"}`;
          } else {
            const asset = guessBaseAsset(row.symbol);
            const actualQty = bal.total[asset] ?? 0;
            const tolerance = Math.max(qty * 0.02, 1e-8); // 2% tolerance for fees/rounding
            if (Math.abs(actualQty - qty) <= tolerance) {
              reconciliation = "RECONCILED";
              reconciliationDetail = `Gate.io ${asset} balance ${actualQty} matches expected ${qty}`;
            } else if (actualQty <= tolerance) {
              reconciliation = "POSITION_MISMATCH";
              reconciliationDetail = `Local DB expects ${qty} ${asset} but Gate.io shows ~0 — position may have been closed manually or on another session`;
            } else {
              reconciliation = "POSITION_MISMATCH";
              reconciliationDetail = `Quantity mismatch — local DB: ${qty} ${asset}, Gate.io balance: ${actualQty} ${asset}`;
            }
          }
        } catch (e) {
          reconciliation = "RECONCILIATION_REQUIRED";
          reconciliationDetail = e instanceof Error ? e.message : String(e);
        }
        if (reconciliation !== "RECONCILED") {
          logger.warn({ symbol: row.symbol, reconciliation, reconciliationDetail }, "Startup: position reconciliation flagged — NOT auto-corrected, review required");
          pushLog("warn", `[Reconciliation] ${row.symbol}: ${reconciliation} — ${reconciliationDetail}`);
        } else {
          pushLog("info", `[Reconciliation] ${row.symbol}: RECONCILED`);
        }
      }

      result.restored.push({
        positionId: row.positionId,
        symbol: row.symbol,
        source: row.source,
        isPaper: row.isPaper,
        quantity: qty,
        armedAsBotSlot,
        reconciliation,
        reconciliationDetail,
      });
      result.restoredCount++;
    }

    // Resume trailing/breakeven/profit-lock monitoring + the SL/TP watchdog
    // even though the user hasn't clicked "Start Bot" yet — a restored open
    // position must not sit unmonitored.
    armPositionMonitors();

    logger.info({ restoredCount: result.restoredCount }, "Startup: position restoration complete");
  } catch (e) {
    logger.error({ err: e }, "restoreOpenPositionsFromDb failed — starting with no restored positions");
  }
  return result;
}

function persistConfig(): void {
  void store.saveConfig({
    exchange:             state.activeExchange,
    symbol:               state.config.symbol,
    takeProfit:           state.config.takeProfit,
    stopLoss:             state.config.stopLoss,
    tickMs:               state.config.tickMs,
    maxDailyLoss:         state.config.maxDailyLoss,
    orderSizeUsdt:        state.config.orderSizeUsdt,
    testMode:             state.config.testMode,
    isActive:             state.isRunning,
    symbolSelectionMode:  state.config.symbolSelectionMode,
    approvedSymbols:      state.config.approvedSymbols,
    scanIntervalMinutes:  state.config.scanIntervalMinutes,
    minimumMarketScore:   state.config.minimumMarketScore,
  });
}

export function setConfig(patch: Partial<BotConfig> & {
  apiKey?: string; secretKey?: string; passphrase?: string;
  tgToken?: string; tgChat?: string;
  riskConfig?: Partial<RiskConfig>;
  strategy?: string;
}): void {
  if (patch.apiKey !== undefined)     state.creds.apiKey = patch.apiKey;
  if (patch.secretKey !== undefined)  state.creds.apiSecret = patch.secretKey;
  if (patch.passphrase !== undefined) state.creds.passphrase = patch.passphrase;
  if (patch.tgToken !== undefined)    state.telegram.token = patch.tgToken;
  if (patch.tgChat !== undefined)     state.telegram.chat = patch.tgChat;
  // Keep telegramNotifier in sync whenever credentials change
  telegramNotifier.updateConfig(state.telegram.token, state.telegram.chat);

  // ── Strategy routing ────────────────────────────────────────────────────
  if (patch.strategy !== undefined) {
    const resolved = resolveStrategy(patch.strategy);
    state.activeStrategy = patch.strategy;
    state.activeEngine   = resolved.engineName;
    pushLog("info", `[Strategy Loaded] engine=${resolved.engineName}`);
  }

  for (const k of [
    "symbol","takeProfit","stopLoss","tickMs","maxDailyLoss","testMode","orderSizeUsdt",
    "symbolSelectionMode","approvedSymbols","scanIntervalMinutes","minimumMarketScore",
  ] as const) {
    const v = (patch as Partial<BotConfig>)[k];
    if (v !== undefined) (state.config as Record<string, unknown>)[k] = v;
  }

  // Keep risk manager's daily loss limit in sync with bot config
  if (patch.maxDailyLoss !== undefined) {
    riskManager.updateConfig({ maxDailyLossUsd: patch.maxDailyLoss });
  }
  // Phase 14 — Trading Params is the execution authority. Apply explicit
  // Bot Control values to the same singleton used by openPosition().
  const tradingParamKeys = [
    "positionSizeMode","fixedSizeUsdt","portfolioSizePct","riskPerTradePct","maxPositionSizePct",
    "takeProfitMode","fixedTpPct","tpAtrMultiple","tpRiskReward",
    "stopLossMode","fixedSlPct","slAtrMultiple",
    "maxOpenPositions","maxTradesPerDay","tradeCooldownMs",
  ] as const;
  const tradingPatch: Record<string, unknown> = {};
  for (const k of tradingParamKeys) {
    if ((patch as Record<string, unknown>)[k] !== undefined) {
      tradingPatch[k] = (patch as Record<string, unknown>)[k];
    }
  }
  if (Object.keys(tradingPatch).length > 0) {
    const updated = tradingParamsService.updateConfig(tradingPatch as Parameters<typeof tradingParamsService.updateConfig>[0]);
    riskManager.updateConfig({
      maxOpenPositions: updated.maxOpenPositions,
      maxDailyLossUsd: updated.maxDailyLossUsd,
      maxTradesPerDay: updated.maxTradesPerDay,
      tradeCooldownMs: updated.tradeCooldownMs,
      maxRiskPerTradePct: updated.riskPerTradePct,
      maxPositionSizePct: updated.maxPositionSizePct,
    });
    pushLog("info", `[Phase14 Authority] size=${updated.positionSizeMode} TP=${updated.takeProfitMode} SL=${updated.stopLossMode} maxPos=${updated.maxOpenPositions}`);
  }

  // Pass through any explicit risk config overrides (legacy/API compatibility).
  if (patch.riskConfig) {
    riskManager.updateConfig(patch.riskConfig);
  }

  pushLog("info", `Config updated (mode=${state.config.testMode ? "PAPER" : "LIVE"}, symbol=${state.config.symbol})`);
  persistConfig();

  if (patch.apiKey || patch.secretKey || patch.passphrase) {
    void store.saveApiKey({
      exchange: state.activeExchange,
      apiKey: state.creds.apiKey,
      apiSecret: state.creds.apiSecret,
      passphrase: state.creds.passphrase,
      isPaper: state.config.testMode,
    });
  }
}

/**
 * Arms the independent SL/TP watchdog (positionMonitor) and the Phase 11
 * lifecycle manager (trailing/breakeven/profit-lock/time/momentum exits).
 * Both underlying .start() calls are idempotent (no-op if already running),
 * so this is safe to call multiple times — from the normal bot start path
 * AND from boot-time position restoration, so a restored open position has
 * real monitoring running even before the user next clicks "Start Bot".
 */
function armPositionMonitors(): void {
  positionMonitor.start(
    // Price getter — uses Gate.io ticker (same source as the main loop)
    async (sym: string) => {
      try {
        const t = await exchangeService.getTicker(sym);
        return t?.last ?? null;
      } catch {
        return null;
      }
    },
    // Close callback — triggered when SL or TP is hit
    async (sym: string, reason: CloseReason, price: number) => {
      if (!state.position || state.position.entry === 0) return;
      pushLog("warn", `[PositionMonitor] ${reason.toUpperCase()} triggered for ${sym} @ ${price}`);
      await closePosition(reason, price);
    },
  );

  positionLifecycleManager.start(async (_sym: string, reason: string, price: number) => {
    if (!state.position) return;
    pushLog("warn", `[Lifecycle] ${reason.toUpperCase()} exit triggered @ ${price}`);
    await closePosition(reason, price);
  });

  // Start the async limit-order fill detector.
  // Paper orders: fill when market price crosses limit price (polled every 10 s).
  // Live orders:  poll exchange via ccxt fetchOrder.
  startLimitOrderMonitor(
    handleLimitFill,
    () => asExchangeCreds(),
    (sym: string) => {
      // Return the last known price for the symbol.
      // For the bot's configured symbol this is always up-to-date from each tick.
      // For other symbols the value may lag by up to 10 s — acceptable for limit detection.
      if (normalizeSymbol(sym) === normalizeSymbol(state.config.symbol)) {
        return state.lastPrice;
      }
      return 0; // monitor will fall back to exchange fetch for unknown symbols
    },
  );
}

export async function start(
  patch?: Parameters<typeof setConfig>[0],
): Promise<{ ok: boolean; error?: string }> {
  if (patch) setConfig(patch);
  if (!hasKeys()) {
    return { ok: false, error: "Missing exchange credentials — apiKey and secretKey are required (passphrase optional for Gate.io)" };
  }

  // Block live trading if the startup guard detected missing prerequisites.
  // The guard communicates via process.env to avoid a circular module dependency.
  if (!state.config.testMode && process.env["LIVE_TRADING_BLOCKED"] === "1") {
    const reasons = process.env["LIVE_TRADING_BLOCKED_REASONS"] ?? "startup safety check failed";
    return { ok: false, error: `⚠ Live trading blocked: ${reasons}. Switch to paper mode or resolve the issue and restart.` };
  }

  // Check if risk manager is halted before starting
  const riskState = riskManager.getState();
  if (riskState.isHalted) {
    return { ok: false, error: `Cannot start: risk manager is halted — ${riskState.haltReason}. Clear the halt first.` };
  }

  if (state.config.testMode) {
    // ── Paper mode: skip ALL authenticated exchange operations ──────────────
    pushLog("info", "[PAPER] Running in simulation mode");
    pushLog("info", "[PAPER] Exchange authentication skipped");
    // Initialise virtual balance (preserve across restarts within the same session)
    if (state.balanceUSDT <= 0) {
      state.balanceUSDT = PAPER_STARTING_BALANCE;
    }
    pushLog("info", `[PAPER] Using virtual balance: $${state.balanceUSDT.toFixed(2)} USDT`);
    advancedRiskEngine.updateBalance(state.balanceUSDT);
    positionSizingService.updateBalance(state.balanceUSDT);
  } else {
    // ── Live mode: validate credentials and pull real balance ───────────────
    const auth = await trade.testAuth(asExchangeCreds());
    if (!auth.success) return { ok: false, error: `Auth failed: ${auth.error}` };

    const bal = await trade.fetchBalance(asExchangeCreds());
    if (bal.success) {
      state.balanceUSDT = bal.totalUsd;
      pushLog("info", `Balance: $${bal.totalUsd.toFixed(2)} USDT`);
      advancedRiskEngine.updateBalance(bal.totalUsd);
      positionSizingService.updateBalance(bal.totalUsd);
    } else {
      pushLog("warn", `fetchBalance failed: ${bal.error}`);
    }
  }

  // ── Startup config verification log ─────────────────────────────────────────
  {
    const mode = state.config.symbolSelectionMode === "auto" ? "AUTO" : "MANUAL";
    pushLog("info", `[Config] ${mode} mode`);
    if (state.config.symbolSelectionMode === "auto") {
      pushLog("info", `[Config] minimumScore=${state.config.minimumMarketScore}`);
      pushLog("info", `[Config] approvedSymbols=${state.config.approvedSymbols.join(",")}`);
      pushLog("info", `[Config] scanIntervalMinutes=${state.config.scanIntervalMinutes}`);
    } else {
      pushLog("info", `[Config] symbol=${state.config.symbol}`);
    }
    pushLog("info", `[Config] strategy=${state.activeStrategy} engine=${state.activeEngine}`);
    pushLog("info", `[Config] takeProfit=${(state.config.takeProfit * 100).toFixed(2)}% stopLoss=${(state.config.stopLoss * 100).toFixed(2)}%`);
  }

  // ── Session start balance — used for ROI tracking ─────────────────────────
  state.sessionStartBalance = state.balanceUSDT;

  // ── Wire performance tracker (safe to call multiple times) ────────────────
  performanceTracker.startTracker(() => ({
    memTrades:       state.trades,
    startingBalance: state.sessionStartBalance,
    currentBalance:  state.balanceUSDT,
  }));

  // ── Auto mode: initial market scan before starting tick loop ────────────────
  if (state.config.symbolSelectionMode === "auto" && state.config.approvedSymbols.length > 0) {
    pushLog("info", `[AutoScan] Auto mode — scanning ${state.config.approvedSymbols.join(", ")}…`);
    try {
      const report = await marketScannerService.scanMarkets(
        state.config.approvedSymbols,
        state.config.minimumMarketScore,
      );
      state.lastScanResults = report.results;
      state.lastScanTime    = Date.now();
      if (report.best) {
        state.config.symbol = report.best.symbol.replace("_", "");
        pushLog("info", `[AutoScan] Selected: ${state.config.symbol} (score ${report.best.score}/100, regime: ${report.best.regime})`);
      } else {
        const allScored = report.results.filter(r => !r.rejected);
        const topScore  = allScored.length > 0 ? Math.max(...allScored.map(r => r.score)) : 0;
        state.selectedSymbol   = null;
        state.scannerState     = "WAITING";
        state.scannerBestScore = topScore;
        state.scannerReason    = `No market meets the minimum score threshold`;
        pushLog("warn", `[AutoScan] No qualified market found — best score: ${topScore}/100, minimum required: ${state.config.minimumMarketScore} — entering WAITING state.`);
      }
    } catch (e) {
      pushLog("warn", `[AutoScan] Initial scan error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  state.isRunning = true;
  state.startedAt = Date.now();
  state.priceHistory.length = 0;

  // Confirm active engine in logs (always visible on start)
  pushLog("info", `[Strategy Loaded] engine=${state.activeEngine}`);
  pushLog("info", `Bot started (${state.config.testMode ? "PAPER" : "LIVE"}) on ${state.config.symbol} | Balance $${state.balanceUSDT.toFixed(2)}`);

  // ── Start independent SL/TP monitor + Phase 11 lifecycle manager ──────────
  armPositionMonitors();

  void tick();
  return { ok: true };
}

export type StopReason =
  | "USER_STOP"
  | "CONFIG_CHANGE"
  | "STRATEGY_CHANGE"
  | "MODE_CHANGE"
  | "EXCHANGE_CHANGE"
  | "RISK_HALT"
  | "SERVER_RESTART"
  | "ERROR";

export function stop(reason: StopReason = "USER_STOP"): { ok: boolean } {
  state.isRunning   = false;
  state.stopReason  = reason;
  if (state.loopHandle) { clearTimeout(state.loopHandle); state.loopHandle = null; }
  positionMonitor.stop();
  positionLifecycleManager.stop();
  pushLog("info", `[Bot Stop] reason=${reason}`);
  return { ok: true };
}

export function resetPaperBalance(): { ok: boolean; error?: string } {
  if (!state.config.testMode) {
    return { ok: false, error: "Reset is only available in paper trading mode." };
  }
  if (state.position) {
    return { ok: false, error: "Cannot reset while a position is open. Close the position first." };
  }
  state.balanceUSDT  = PAPER_STARTING_BALANCE;
  state.dailyPnL     = 0;
  state.totalTrades  = 0;
  state.winningTrades = 0;
  state.losingTrades  = 0;
  state.trades.length = 0;
  pushLog("info", `[PAPER] Balance reset to $${PAPER_STARTING_BALANCE.toFixed(2)} USDT — fresh paper session started`);
  return { ok: true };
}

// ─── Manual market scan (for Telegram /scan command) ─────────────────────────

export async function triggerScan(): Promise<import("../services/marketScannerService").MarketScanResult[]> {
  try {
    const report = await marketScannerService.scanMarkets(
      state.config.approvedSymbols,
      state.config.minimumMarketScore,
    );
    state.lastScanResults = report.results;
    state.lastScanTime    = Date.now();
    // Update scanner state with fresh results
    if (report.best) {
      state.selectedSymbol   = report.best.symbol.replace("_", "");
      state.scannerState     = "QUALIFIED";
      state.scannerReason    = null;
      state.scannerBestScore = report.best.score;
    } else {
      state.scannerState     = "WAITING";
      state.scannerBestScore = report.results.reduce((mx, r) => Math.max(mx, r.score), 0);
    }
    return report.results;
  } catch (e) {
    pushLog("warn", `[ManualScan] scan failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

// ─── Gate.io wrappers used by routes ─────────────────────────────────────────

export async function pingExchange() {
  const r = await exchangeService.ping();
  return { ok: r.success, latencyMs: r.latencyMs ?? 0, serverTime: undefined as number | undefined };
}

export async function testKeys(override?: {
  apiKey?: string; secretKey?: string; passphrase?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey     = override?.apiKey     ?? state.creds.apiKey;
  const apiSecret  = override?.secretKey  ?? state.creds.apiSecret;
  const passphrase = override?.passphrase ?? state.creds.passphrase;
  if (!apiKey || !apiSecret) {
    return { ok: false, error: "API Key and Secret Key are required (passphrase is optional for Gate.io)" };
  }
  const r = await gateio.validateCredentials({ apiKey, secret: apiSecret, password: passphrase });
  return { ok: r.success, error: r.error };
}

export async function validateAndSave(cfg: {
  apiKey?: string; secretKey?: string; passphrase?: string;
  tgToken?: string; tgChat?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const r = await testKeys(cfg);
  if (!r.ok) return r;
  setConfig(cfg);
  return { ok: true };
}

export async function fetchBalanceWith(_override?: {
  apiKey?: string; secretKey?: string; passphrase?: string;
}): Promise<{ totalEqUsd: number }> {
  const result = await exchangeService.fetchBalance();
  if (!result.success) throw new Error(result.error ?? "Balance fetch failed");
  return { totalEqUsd: result.totalUsd ?? 0 };
}

// ─── Scanner accessors (used by multiSymbolScanner) ──────────────────────────

export function getBotActiveStrategy(): string { return state.activeStrategy; }
export function getBotActiveEngine():   string { return state.activeEngine; }
export function getBotOrderSizeUsdt():  number { return state.config.orderSizeUsdt; }
export function getBotBalanceUsdt(): number { return state.balanceUSDT; }
export function getBotStopLossPct():    number { return state.config.stopLoss; }
export function getBotTakeProfitPct():  number { return state.config.takeProfit; }
export function getBotIsRunning():      boolean { return state.isRunning; }
export function getBotHasKeys():        boolean { return hasKeys(); }
export function getBotOwnerUserId():    number | null { return state.ownerUserId; }
export function getBotCandleBar():      string { return state.candleBar; }
export function getBotExchangeCreds(): ExchangeCreds {
  return {
    apiKey:   state.creds.apiKey,
    secret:   state.creds.apiSecret,
    password: state.creds.passphrase,
    exchange: state.activeExchange,
    paper:    state.config.testMode,
  };
}
