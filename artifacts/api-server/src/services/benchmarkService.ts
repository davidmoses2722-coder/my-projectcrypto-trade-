/**
 * benchmarkService.ts — Phase 8.5 Growth Optimization Benchmark
 *
 * Runs two production strategies across 5 symbols with 12-month historical data.
 * Uses dynamic risk-based position sizing (1% risk per trade).
 * Aggregates per-symbol results into cross-symbol averages.
 *
 * Strategies (Phase 8.5):
 *   1. ActiveSwingStrategy         — 4h candles,  target 15–25 trades/month
 *   2. ConservativeScalpingStrategy — 15m candles, target 40–50 trades/month
 *
 * Legacy SwingStrategy is DISABLED and excluded from benchmarks.
 *
 * Symbols: BTC_USDT, ETH_USDT, SOL_USDT, BNB_USDT, XRP_USDT
 *
 * Success criteria (Phase 8.5):
 *   ✓ Monthly ROI: 8–15%
 *   ✓ Profit factor ≥ 1.3
 *   ✓ Max drawdown < 10%
 *   ✓ Trades/month: 30–50 (combined across both strategies)
 */

import ccxt from "ccxt";
import { logger } from "../lib/logger";
import { resolveStrategy } from "./strategies/index";
import * as ActiveSwingStrategy  from "./strategies/ActiveSwingStrategy";
import * as ConservativeScalping from "./strategies/ConservativeScalpingStrategy";
import { toDisplaySymbol, toGateApiSymbol, normalizeSymbol } from "../shared/symbolUtils";
import { BENCHMARK_HISTORY_CONFIG, MAX_CANDLE_LIMIT } from "./benchmarkHistoryConfig";

// ─── Constants ────────────────────────────────────────────────────────────────

const STARTING_BALANCE     = 1_000;   // $1,000 account
const RISK_PER_TRADE_PCT   = 0.01;    // 1% risk per trade
const MAX_EXPOSURE_PCT      = 0.30;   // 30% max position size
const MAX_CONCURRENT        = 2;       // max open positions (gates entry)
const TARGET_TRADES         = 30;      // benchmark stop condition per run
const CANDLE_WINDOW         = 250;

const BENCHMARK_SYMBOLS = [
  "BTC_USDT",
  "ETH_USDT",
  "SOL_USDT",
  "BNB_USDT",
  "XRP_USDT",
  "ADA_USDT",
  "AVAX_USDT",
  "DOGE_USDT",
  "LINK_USDT",
  "SUI_USDT",
];

// ─── Strategy config ──────────────────────────────────────────────────────────

interface StrategyConfig {
  id:                string;
  label:             string;
  timeframe:         string;
  candleLimit:       number;
  slPct:             number;
  tpPct:             number;
  dataWindowDays:    number;
  dataWindowLabel:   string;
  dataWindowCandles: number;
}

const STRATEGY_CONFIGS: StrategyConfig[] = [
  {
    id:                "active-swing",
    label:             "ActiveSwingStrategy",
    timeframe:         ActiveSwingStrategy.STRATEGY_METADATA.timeframe,
    candleLimit:       BENCHMARK_HISTORY_CONFIG["active-swing"]!.maxCandles,
    slPct:             0.012,
    tpPct:             0.020,
    dataWindowDays:    BENCHMARK_HISTORY_CONFIG["active-swing"]!.maxDays,
    dataWindowLabel:   BENCHMARK_HISTORY_CONFIG["active-swing"]!.label,
    dataWindowCandles: BENCHMARK_HISTORY_CONFIG["active-swing"]!.maxCandles,
  },
  {
    id:                "conservative-scalping",
    label:             "ConservativeScalpingStrategy v2.1",
    timeframe:         ConservativeScalping.STRATEGY_METADATA.timeframe,
    candleLimit:       BENCHMARK_HISTORY_CONFIG["conservative-scalping"]!.maxCandles,
    slPct:             0.007,
    tpPct:             0.012,
    dataWindowDays:    BENCHMARK_HISTORY_CONFIG["conservative-scalping"]!.maxDays,
    dataWindowLabel:   BENCHMARK_HISTORY_CONFIG["conservative-scalping"]!.label,
    dataWindowCandles: BENCHMARK_HISTORY_CONFIG["conservative-scalping"]!.maxCandles,
  },
];

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BenchmarkTrade {
  tradeNum:     number;
  side:         "long" | "short";   // Phase 8.7 — dual-mode simulation
  entryTime:    string;
  exitTime:     string;
  entryPrice:   number;
  exitPrice:    number;
  outcome:      "WIN" | "LOSS";
  pnlUsdt:      number;
  pnlPct:       number;
  durationMins: number;
  positionSize: number;   // actual USDT deployed (risk-based)
}

export interface BenchmarkStrategyResult {
  strategyId:         string;
  strategyLabel:      string;
  timeframe:          string;
  tradesCompleted:    number;
  targetTrades:       number;
  targetReached:      boolean;
  confidenceScore:    number;
  totalTrades:        number;
  wins:               number;
  losses:             number;
  winRate:            number;
  netProfit:          number;
  roi:                number;
  profitFactor:       number;
  avgTradeDuration:   number;
  avgProfitPerTrade:  number;
  maxDrawdown:        number;
  largestWin:         number;
  largestLoss:        number;
  startingBalance:    number;
  endingBalance:      number;
  periodStart:        string | null;
  periodEnd:          string | null;
  tradesPerMonth:     number;
  avgTradesPerDay:    number;
  avgHoldingTime:     number;
  monthlyRoi:         number;
  trades:             BenchmarkTrade[];
  // Phase 8.7 — long/short split (dual-mode ActiveSwing simulation)
  longTrades:         number;
  shortTrades:        number;
  longRoi:            number;    // % return attributable to long trades only
  shortRoi:           number;    // % return attributable to short trades only
  combinedRoi:         number;   // same as `roi` — long + short combined
  // History window — respects Gate.io 10,000-candle limit
  dataWindowDays:     number;
  dataWindowLabel:    string;    // e.g. "365 days (4h)"
  dataWindowCandles:  number;
  // Phase 8.5 — criteria check
  criteria: {
    monthlyRoiOk:    boolean;   // 8–15%
    profitFactorOk:  boolean;   // ≥ 1.3
    drawdownOk:      boolean;   // < 10%
    tradesPerMonthOk: boolean;  // 15–50 per strategy
  };
}

export interface BenchmarkAverages {
  // Averaged across all 5 symbols for each strategy
  activeSwing: {
    avgMonthlyRoi:      number;
    avgTradesPerMonth:  number;
    avgProfitFactor:    number;
    avgMaxDrawdown:     number;
    avgWinRate:         number;
  } | null;
  scalping: {
    avgMonthlyRoi:      number;
    avgTradesPerMonth:  number;
    avgProfitFactor:    number;
    avgMaxDrawdown:     number;
    avgWinRate:         number;
  } | null;
  // Combined (both strategies together)
  combined: {
    totalTradesPerMonth: number;
    blendedMonthlyRoi:   number;
    overallProfitFactor: number;
    maxDrawdown:         number;
    // Phase 8.7 — long/short split, averaged across active-swing + scalping
    longRoi:             number;
    shortRoi:            number;
    combinedRoi:         number;   // same as blendedMonthlyRoi's non-annualized counterpart
    // Phase 8.5 success criteria
    criteria: {
      monthlyRoiOk:     boolean;   // 8–15%
      profitFactorOk:   boolean;   // ≥ 1.3
      drawdownOk:       boolean;   // < 10%
      tradesPerMonthOk: boolean;   // 30–50
    };
  } | null;
}

export interface SymbolResult {
  activeSwing: BenchmarkStrategyResult | null;
  scalping:    BenchmarkStrategyResult | null;
}

export type BenchmarkStatus = "idle" | "running" | "complete" | "error";

export interface BenchmarkState {
  status:        BenchmarkStatus;
  symbol:        string;        // compat: first symbol for legacy callers
  symbols:       string[];      // Phase 8.5: all 5 symbols
  startedAt:     string | null;
  completedAt:   string | null;
  error:         string | null;
  swing:         BenchmarkStrategyResult | null;   // always null — disabled Phase 8.5
  activeSwing:   BenchmarkStrategyResult | null;   // averaged result
  scalping:      BenchmarkStrategyResult | null;   // averaged result
  symbolResults: Record<string, SymbolResult>;     // per-symbol breakdown
  averages:      BenchmarkAverages | null;
  progress:      { completed: number; total: number };
}

// ─── In-memory state ──────────────────────────────────────────────────────────

const state: BenchmarkState = {
  status:        "idle",
  symbol:        "BTC/USDT",
  symbols:       BENCHMARK_SYMBOLS,
  startedAt:     null,
  completedAt:   null,
  error:         null,
  swing:         null,
  activeSwing:   null,
  scalping:      null,
  symbolResults: {},
  averages:      null,
  progress:      { completed: 0, total: 0 },
};

export function getBenchmarkState(): Readonly<BenchmarkState> {
  return { ...state };
}

// ─── Internal candle type ─────────────────────────────────────────────────────

interface RawCandle {
  timestamp: number;
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
}

// ─── Timeframe → milliseconds ─────────────────────────────────────────────────

function tfToMs(tf: string): number {
  const MAP: Record<string, number> = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
    "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
    "4h": 14_400_000, "6h": 21_600_000, "1d": 86_400_000,
  };
  return MAP[tf] ?? 3_600_000;
}

// ─── Paginated candle fetcher ─────────────────────────────────────────────────

async function fetchCandlesPaginated(
  symbol:    string,
  timeframe: string,
  limit:     number,
): Promise<RawCandle[]> {
  const ex      = new ccxt.gate({ enableRateLimit: true });
  const gateApi = toGateApiSymbol(symbol);   // ensures BTC_USDT format before normalizing
  const ccxtSym = toDisplaySymbol(symbol);   // BTC/USDT — correct CCXT format
  const internal = normalizeSymbol(symbol);  // BTCUSDT
  logger.info(`[Symbol] Input=${symbol} → API=${gateApi} → Internal=${internal}`);
  const tfMs    = tfToMs(timeframe);

  // ── Safeguard: Gate.io rejects candles beyond 10,000 points ago ──────────
  let effectiveLimit = limit;
  if (limit > MAX_CANDLE_LIMIT) {
    const reducedDays = Math.floor((MAX_CANDLE_LIMIT * tfMs) / 86_400_000);
    logger.warn(
      `[Benchmark] Requested ${limit} candles exceeds Gate.io max of ${MAX_CANDLE_LIMIT}. ` +
      `Auto-reducing to ${MAX_CANDLE_LIMIT} (~${reducedDays} days).`,
    );
    effectiveLimit = MAX_CANDLE_LIMIT;
  }

  const perPage = 1_000;
  const all: RawCandle[] = [];

  let since = Date.now() - effectiveLimit * tfMs;

  logger.info(`[Benchmark] Fetching ${effectiveLimit} × ${timeframe} candles for ${symbol}`);

  while (all.length < effectiveLimit) {
    const need  = effectiveLimit - all.length;
    const batch = await ex.fetchOHLCV(ccxtSym, timeframe, since, Math.min(perPage, need));
    if (!batch || batch.length === 0) break;

    for (const c of batch) {
      all.push({ timestamp: c[0]!, open: c[1]!, high: c[2]!, low: c[3]!, close: c[4]!, volume: c[5]! });
    }

    since = batch[batch.length - 1]![0]! + tfMs;
    if (batch.length < Math.min(perPage, need)) break;

    if (all.length < effectiveLimit) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  logger.info(`[Benchmark] Loaded ${all.length} × ${timeframe} candles for ${symbol}`);
  return all;
}

// ─── Dynamic risk-based position sizing ──────────────────────────────────────

function computePositionSize(balance: number, slPct: number): number {
  // Formula: riskAmount = balance × 1%; positionSize = riskAmount / slPct
  const riskAmount   = balance * RISK_PER_TRADE_PCT;
  const rawSize      = slPct > 0 ? riskAmount / slPct : riskAmount * 10;
  const maxByExposure = balance * MAX_EXPOSURE_PCT;
  return Math.max(5, Math.min(rawSize, maxByExposure));
}

// ─── Walk-forward simulation core ─────────────────────────────────────────────

function simulateStrategy(
  cfg:     StrategyConfig,
  candles: RawCandle[],
  symbol:  string,
): BenchmarkStrategyResult {
  const { id: strategyId, label, timeframe, slPct, tpPct, dataWindowDays, dataWindowLabel, dataWindowCandles } = cfg;
  const strategy = resolveStrategy(strategyId);

  logger.info(`[Benchmark] ${label} on ${symbol} — tf=${timeframe}`);

  const trades: BenchmarkTrade[] = [];
  let balance      = STARTING_BALANCE;
  let peak         = STARTING_BALANCE;
  let maxDrawdown  = 0;
  let openSlots    = MAX_CONCURRENT;

  let openPos: {
    side:       "long" | "short";
    entryPrice: number;
    sl:         number;
    tp:         number;
    entryTime:  string;
    tradeNum:   number;
    sizeUsdt:   number;
  } | null = null;

  const dailyTrades: Record<string, number> = {};
  const getDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

  const periodStart = candles[CANDLE_WINDOW]
    ? new Date(candles[CANDLE_WINDOW]!.timestamp).toISOString()
    : null;

  // Track the last candle we actually processed so periodEnd reflects
  // real trading activity, not the full dataset tail (fixes tradesPerMonth
  // being artificially low when TARGET_TRADES is reached early).
  let lastProcessedTs: number = candles[CANDLE_WINDOW]?.timestamp ?? Date.now();

  for (let i = CANDLE_WINDOW; i < candles.length; i++) {
    const candle = candles[i]!;
    lastProcessedTs = candle.timestamp;

    if (openPos !== null) {
      const { side, entryPrice, sl, tp, entryTime, tradeNum, sizeUsdt } = openPos;
      let exitPrice: number | null = null;
      let outcome:   "WIN" | "LOSS" = "WIN";

      if (side === "long") {
        if (candle.high >= tp)      { exitPrice = tp; outcome = "WIN"; }
        else if (candle.low <= sl)  { exitPrice = sl; outcome = "LOSS"; }
      } else {
        // SHORT: TP is below entry, SL is above entry (mirrored).
        if (candle.low <= tp)       { exitPrice = tp; outcome = "WIN"; }
        else if (candle.high >= sl) { exitPrice = sl; outcome = "LOSS"; }
      }

      if (exitPrice !== null) {
        const sizeCoins    = sizeUsdt / entryPrice;
        const pnlUsdt      = side === "long"
          ? (exitPrice - entryPrice) * sizeCoins
          : (entryPrice - exitPrice) * sizeCoins;
        const pnlPct       = side === "long"
          ? ((exitPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - exitPrice) / entryPrice) * 100;
        const exitTime     = new Date(candle.timestamp).toISOString();
        const durationMins = (candle.timestamp - new Date(entryTime).getTime()) / 60_000;

        balance += pnlUsdt;
        if (balance > peak) peak = balance;
        const dd = ((peak - balance) / peak) * 100;
        if (dd > maxDrawdown) maxDrawdown = dd;

        trades.push({ tradeNum, side, entryTime, exitTime, entryPrice, exitPrice, outcome, pnlUsdt, pnlPct, durationMins, positionSize: sizeUsdt });

        openPos = null;
        openSlots = MAX_CONCURRENT;
        if (trades.length >= TARGET_TRADES) break;
      }
      continue;
    }

    if (openSlots <= 0) continue;

    const window   = candles.slice(i - CANDLE_WINDOW, i);
    const day      = getDay(candle.timestamp);
    const dayCount = dailyTrades[day] ?? 0;

    const sig = strategy.fn({
      candles: window.map(c => ({
        time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      })),
      currentPrice:    candle.close,
      dailyTradeCount: dayCount,
    });

    // Phase 8.7 — simulate both LONG (BUY) and SHORT entries; same risk
    // engine / position sizing formula (computePositionSize) for both.
    if ((sig.action === "BUY" || sig.action === "SHORT") && sig.canTrade) {
      const side     = sig.action === "BUY" ? "long" : "short";
      const ep       = candle.close;
      const sl       = sig.suggestedSl !== null ? sig.suggestedSl
        : side === "long" ? ep * (1 - slPct) : ep * (1 + slPct);
      const tp       = sig.suggestedTp !== null ? sig.suggestedTp
        : side === "long" ? ep * (1 + tpPct) : ep * (1 - tpPct);
      const sizeUsdt = computePositionSize(balance, slPct);

      openPos = { side, entryPrice: ep, sl, tp, entryTime: new Date(candle.timestamp).toISOString(), tradeNum: trades.length + 1, sizeUsdt };
      dailyTrades[day] = dayCount + 1;
      openSlots--;
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  const wins       = trades.filter(t => t.outcome === "WIN").length;
  const losses     = trades.filter(t => t.outcome === "LOSS").length;
  const grossWins  = trades.filter(t => t.pnlUsdt > 0).reduce((s, t) => s + t.pnlUsdt, 0);
  const grossLoss  = Math.abs(trades.filter(t => t.pnlUsdt < 0).reduce((s, t) => s + t.pnlUsdt, 0));
  const netProfit  = balance - STARTING_BALANCE;

  const winRate           = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const roi               = (netProfit / STARTING_BALANCE) * 100;
  const profitFactor      = grossLoss > 0 ? grossWins / grossLoss : grossWins > 0 ? 999 : 0;
  const avgTradeDuration  = trades.length > 0 ? trades.reduce((s, t) => s + t.durationMins, 0) / trades.length : 0;
  const avgProfitPerTrade = trades.length > 0 ? netProfit / trades.length : 0;
  const largestWin        = trades.length > 0 ? Math.max(...trades.map(t => t.pnlUsdt)) : 0;
  const largestLoss       = trades.length > 0 ? Math.min(...trades.map(t => t.pnlUsdt)) : 0;
  const tradesCompleted   = trades.length;
  const targetReached     = tradesCompleted >= TARGET_TRADES;
  const confidenceScore   = Math.round(Math.min(tradesCompleted / TARGET_TRADES, 1.0) * 100);

  // Use the last actually-processed candle (not the end of dataset) so that
  // tradesPerMonth is accurate when TARGET_TRADES is hit before all candles
  // are consumed.
  const periodEnd = lastProcessedTs > 0
    ? new Date(lastProcessedTs).toISOString()
    : null;

  const periodDays     = periodStart && periodEnd
    ? (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86_400_000
    : 0;

  const tradesPerMonth  = periodDays > 0 ? (tradesCompleted / periodDays) * 30 : 0;
  const avgTradesPerDay = periodDays > 0 ? tradesCompleted / periodDays : 0;
  const monthlyRoi      = periodDays > 0 ? (roi / periodDays) * 30 : 0;

  // Phase 8.7 — long/short split. Each side's ROI is computed against the
  // same starting balance so the two figures are directly comparable and
  // sum (approximately) to the combined ROI.
  const longTradesArr  = trades.filter(t => t.side === "long");
  const shortTradesArr = trades.filter(t => t.side === "short");
  const longNet         = longTradesArr.reduce((s, t) => s + t.pnlUsdt, 0);
  const shortNet        = shortTradesArr.reduce((s, t) => s + t.pnlUsdt, 0);
  const longRoi          = (longNet / STARTING_BALANCE) * 100;
  const shortRoi         = (shortNet / STARTING_BALANCE) * 100;

  logger.info(
    `[Benchmark] ${label}/${symbol} done: ${tradesCompleted}/${TARGET_TRADES} trades ` +
    `(${longTradesArr.length}L/${shortTradesArr.length}S) — ` +
    `Combined ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(1)}% (Long ${longRoi >= 0 ? "+" : ""}${longRoi.toFixed(1)}% / Short ${shortRoi >= 0 ? "+" : ""}${shortRoi.toFixed(1)}%), ` +
    `~${tradesPerMonth.toFixed(1)}/mo, PF ${profitFactor >= 999 ? "∞" : profitFactor.toFixed(2)}`,
  );

  return {
    strategyId,
    strategyLabel:     label,
    timeframe,
    tradesCompleted,
    targetTrades:      TARGET_TRADES,
    targetReached,
    confidenceScore,
    totalTrades:       tradesCompleted,
    wins,
    losses,
    winRate,
    netProfit,
    roi,
    profitFactor,
    avgTradeDuration,
    avgProfitPerTrade,
    maxDrawdown,
    largestWin,
    largestLoss,
    startingBalance: STARTING_BALANCE,
    endingBalance:   balance,
    periodStart,
    periodEnd,
    tradesPerMonth:  Math.round(tradesPerMonth * 10) / 10,
    avgTradesPerDay: Math.round(avgTradesPerDay * 100) / 100,
    avgHoldingTime:  avgTradeDuration,
    monthlyRoi:      Math.round(monthlyRoi * 10) / 10,
    trades,
    longTrades:      longTradesArr.length,
    shortTrades:     shortTradesArr.length,
    longRoi:         Math.round(longRoi * 10) / 10,
    shortRoi:        Math.round(shortRoi * 10) / 10,
    combinedRoi:     Math.round(roi * 10) / 10,
    dataWindowDays,
    dataWindowLabel,
    dataWindowCandles,
    criteria: {
      monthlyRoiOk:     monthlyRoi >= 8 && monthlyRoi <= 15,
      profitFactorOk:   profitFactor >= 1.3,
      drawdownOk:       maxDrawdown < 10,
      tradesPerMonthOk: tradesPerMonth >= 15 && tradesPerMonth <= 50,
    },
  };
}

// ─── Aggregate results across symbols ────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function aggregateResults(
  results: BenchmarkStrategyResult[],
  strategyId: string,
  label: string,
): BenchmarkStrategyResult {
  const r0 = results[0]!;

  // Sum trade counts; blend financials as averages
  const totalTrades      = Math.round(avg(results.map(r => r.totalTrades)));
  const wins             = Math.round(avg(results.map(r => r.wins)));
  const losses           = Math.round(avg(results.map(r => r.losses)));
  const winRate          = avg(results.map(r => r.winRate));
  const roi              = avg(results.map(r => r.roi));
  const monthlyRoi       = avg(results.map(r => r.monthlyRoi));
  const profitFactor     = avg(results.map(r => r.profitFactor >= 999 ? 999 : r.profitFactor));
  const maxDrawdown      = Math.max(...results.map(r => r.maxDrawdown));   // worst case
  const tradesPerMonth   = avg(results.map(r => r.tradesPerMonth));
  const avgTradesPerDay  = avg(results.map(r => r.avgTradesPerDay));
  const avgTradeDuration = avg(results.map(r => r.avgTradeDuration));
  const netProfit        = avg(results.map(r => r.netProfit));
  const largestWin       = avg(results.map(r => r.largestWin));
  const largestLoss      = avg(results.map(r => r.largestLoss));
  const avgProfitPerTrade = avg(results.map(r => r.avgProfitPerTrade));
  const confidenceScore  = Math.round(avg(results.map(r => r.confidenceScore)));
  const tradesCompleted  = Math.round(avg(results.map(r => r.tradesCompleted)));
  const targetReached    = results.filter(r => r.targetReached).length >= Math.ceil(results.length / 2);
  const endingBalance    = STARTING_BALANCE + netProfit;

  // Phase 8.7 — averaged long/short split across symbols
  const longTrades  = Math.round(avg(results.map(r => r.longTrades)));
  const shortTrades = Math.round(avg(results.map(r => r.shortTrades)));
  const longRoi      = avg(results.map(r => r.longRoi));
  const shortRoi      = avg(results.map(r => r.shortRoi));

  return {
    strategyId,
    strategyLabel:     `${label} (5-symbol avg)`,
    timeframe:         r0.timeframe,
    tradesCompleted,
    targetTrades:      TARGET_TRADES,
    targetReached,
    confidenceScore,
    totalTrades,
    wins,
    losses,
    winRate:           Math.round(winRate * 10) / 10,
    netProfit:         Math.round(netProfit * 100) / 100,
    roi:               Math.round(roi * 10) / 10,
    profitFactor:      Math.round(profitFactor * 100) / 100,
    avgTradeDuration,
    avgProfitPerTrade: Math.round(avgProfitPerTrade * 100) / 100,
    maxDrawdown:       Math.round(maxDrawdown * 10) / 10,
    largestWin:        Math.round(largestWin * 100) / 100,
    largestLoss:       Math.round(largestLoss * 100) / 100,
    startingBalance:   STARTING_BALANCE,
    endingBalance:     Math.round(endingBalance * 100) / 100,
    periodStart:       r0.periodStart,
    periodEnd:         r0.periodEnd,
    tradesPerMonth:    Math.round(tradesPerMonth * 10) / 10,
    avgTradesPerDay:   Math.round(avgTradesPerDay * 100) / 100,
    avgHoldingTime:    avgTradeDuration,
    monthlyRoi:        Math.round(monthlyRoi * 10) / 10,
    trades:            r0.trades,   // representative sample from first symbol
    longTrades,
    shortTrades,
    longRoi:           Math.round(longRoi * 10) / 10,
    shortRoi:          Math.round(shortRoi * 10) / 10,
    combinedRoi:       Math.round(roi * 10) / 10,
    dataWindowDays:    r0.dataWindowDays,
    dataWindowLabel:   r0.dataWindowLabel,
    dataWindowCandles: r0.dataWindowCandles,
    criteria: {
      monthlyRoiOk:     monthlyRoi >= 8 && monthlyRoi <= 15,
      profitFactorOk:   profitFactor >= 1.3,
      drawdownOk:       maxDrawdown < 10,
      tradesPerMonthOk: tradesPerMonth >= 15 && tradesPerMonth <= 50,
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startBenchmark(
  opts: { symbol?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (state.status === "running") {
    return { ok: false, error: "A benchmark is already running" };
  }

  const totalJobs = STRATEGY_CONFIGS.length * BENCHMARK_SYMBOLS.length;

  state.status        = "running";
  state.symbol        = opts.symbol ?? BENCHMARK_SYMBOLS[0]!;
  state.symbols       = BENCHMARK_SYMBOLS;
  state.startedAt     = new Date().toISOString();
  state.completedAt   = null;
  state.error         = null;
  state.swing         = null;
  state.activeSwing   = null;
  state.scalping      = null;
  state.symbolResults = {};
  state.averages      = null;
  state.progress      = { completed: 0, total: totalJobs };

  for (const sym of BENCHMARK_SYMBOLS) {
    state.symbolResults[sym] = { activeSwing: null, scalping: null };
  }

  void (async () => {
    try {
      // Cache fetched candles per symbol+timeframe to avoid re-fetching
      const candleCache = new Map<string, RawCandle[]>();

      for (const sym of BENCHMARK_SYMBOLS) {
        for (const cfg of STRATEGY_CONFIGS) {
          if (state.status !== "running") return;

          const key = `${sym}::${cfg.timeframe}`;
          let candles = candleCache.get(key);

          if (!candles) {
            logger.info(
              `[Benchmark] ${cfg.label} → ${cfg.timeframe} → ${cfg.dataWindowDays} days → ${cfg.dataWindowCandles} candles`,
            );
            candles = await fetchCandlesPaginated(sym, cfg.timeframe, cfg.candleLimit);
            candleCache.set(key, candles);
          }

          if (candles.length < CANDLE_WINDOW + 50) {
            logger.warn(`[Benchmark] ${cfg.label}/${sym}: only ${candles.length} candles — skipping`);
            state.progress.completed++;
            continue;
          }

          const result = simulateStrategy(cfg, candles, sym);

          const sr = state.symbolResults[sym];
          if (sr) {
            if (cfg.id === "active-swing")           sr.activeSwing = result;
            if (cfg.id === "conservative-scalping") sr.scalping    = result;
          }

          state.progress.completed++;
        }
      }

      // ── Aggregate across symbols ──────────────────────────────────────────

      const asResults  = BENCHMARK_SYMBOLS
        .map(s => state.symbolResults[s]?.activeSwing)
        .filter((r): r is BenchmarkStrategyResult => r != null);

      const scResults  = BENCHMARK_SYMBOLS
        .map(s => state.symbolResults[s]?.scalping)
        .filter((r): r is BenchmarkStrategyResult => r != null);

      const asAgg = asResults.length > 0
        ? aggregateResults(asResults, "active-swing", "ActiveSwingStrategy")
        : null;

      const scAgg = scResults.length > 0
        ? aggregateResults(scResults, "conservative-scalping", "ConservativeScalpingStrategy v2.1")
        : null;

      state.activeSwing = asAgg;
      state.scalping    = scAgg;

      // ── Cross-strategy averages ───────────────────────────────────────────

      const combinedTradesPerMonth = (asAgg?.tradesPerMonth ?? 0) + (scAgg?.tradesPerMonth ?? 0);
      const blendedMonthlyRoi      = avg([asAgg?.monthlyRoi ?? 0, scAgg?.monthlyRoi ?? 0]);
      const overallPF              = avg([
        Math.min(asAgg?.profitFactor ?? 0, 999),
        Math.min(scAgg?.profitFactor ?? 0, 999),
      ]);
      const maxDD                  = Math.max(asAgg?.maxDrawdown ?? 0, scAgg?.maxDrawdown ?? 0);
      const combinedLongRoi        = avg([asAgg?.longRoi ?? 0, scAgg?.longRoi ?? 0]);
      const combinedShortRoi       = avg([asAgg?.shortRoi ?? 0, scAgg?.shortRoi ?? 0]);
      const combinedRoi            = avg([asAgg?.combinedRoi ?? 0, scAgg?.combinedRoi ?? 0]);

      state.averages = {
        activeSwing: asAgg ? {
          avgMonthlyRoi:     asAgg.monthlyRoi,
          avgTradesPerMonth: asAgg.tradesPerMonth,
          avgProfitFactor:   asAgg.profitFactor,
          avgMaxDrawdown:    asAgg.maxDrawdown,
          avgWinRate:        asAgg.winRate,
        } : null,
        scalping: scAgg ? {
          avgMonthlyRoi:     scAgg.monthlyRoi,
          avgTradesPerMonth: scAgg.tradesPerMonth,
          avgProfitFactor:   scAgg.profitFactor,
          avgMaxDrawdown:    scAgg.maxDrawdown,
          avgWinRate:        scAgg.winRate,
        } : null,
        combined: {
          totalTradesPerMonth: Math.round(combinedTradesPerMonth * 10) / 10,
          blendedMonthlyRoi:   Math.round(blendedMonthlyRoi * 10) / 10,
          overallProfitFactor: Math.round(overallPF * 100) / 100,
          maxDrawdown:         Math.round(maxDD * 10) / 10,
          longRoi:             Math.round(combinedLongRoi * 10) / 10,
          shortRoi:            Math.round(combinedShortRoi * 10) / 10,
          combinedRoi:         Math.round(combinedRoi * 10) / 10,
          criteria: {
            monthlyRoiOk:     blendedMonthlyRoi >= 8 && blendedMonthlyRoi <= 15,
            profitFactorOk:   overallPF >= 1.3,
            drawdownOk:       maxDD < 10,
            tradesPerMonthOk: combinedTradesPerMonth >= 30 && combinedTradesPerMonth <= 50,
          },
        },
      };

      state.status      = "complete";
      state.completedAt = new Date().toISOString();

      const avg_ = state.averages;
      logger.info(
        `[Benchmark] Phase 8.5 complete — ` +
        `ActiveSwing: ${asAgg?.tradesPerMonth ?? 0}/mo, ROI ${asAgg?.monthlyRoi ?? 0}%, PF ${asAgg?.profitFactor ?? 0} | ` +
        `Scalping: ${scAgg?.tradesPerMonth ?? 0}/mo, ROI ${scAgg?.monthlyRoi ?? 0}%, PF ${scAgg?.profitFactor ?? 0} | ` +
        `Combined: ${avg_?.combined?.totalTradesPerMonth ?? 0}/mo, ROI ${avg_?.combined?.blendedMonthlyRoi ?? 0}%`,
      );

      const crit = avg_?.combined?.criteria;
      if (crit) {
        const passed = [crit.monthlyRoiOk, crit.profitFactorOk, crit.drawdownOk, crit.tradesPerMonthOk].filter(Boolean).length;
        logger.info(`[Benchmark] Success criteria: ${passed}/4 passed — ROI ${crit.monthlyRoiOk ? "✓" : "✗"}, PF ${crit.profitFactorOk ? "✓" : "✗"}, DD ${crit.drawdownOk ? "✓" : "✗"}, Trades/mo ${crit.tradesPerMonthOk ? "✓" : "✗"}`);
      }
    } catch (err) {
      state.status = "error";
      state.error  = String(err);
      logger.error({ err }, "[Benchmark] Simulation failed");
    }
  })();

  return { ok: true };
}
