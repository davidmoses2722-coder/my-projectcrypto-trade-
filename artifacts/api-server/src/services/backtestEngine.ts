/**
 * backtestEngine.ts — Historical simulation engine.
 *
 * Runs Gate.io historical candles through the SAME strategy engines used by
 * live trading. No live orders, no BullMQ, no DB writes during the run.
 *
 * ─── Architecture note ─────────────────────────────────────────────────────
 * The backtest loop calls resolveStrategy(id).fn(...) directly — the exact
 * same pure function used by the live bot.  The following live-trading layers
 * are intentionally NOT present in the simulation:
 *
 *   ✗ portfolioRegistry  — manages open positions for the live bot; not used
 *   ✗ advancedRiskEngine — live risk checks (drawdown limits, etc.); not used
 *   ✗ orchestrator       — coordinates live trade lifecycle; not used
 *   ✗ BullMQ workers     — async job queues for live execution; not used
 *
 * The simulation has its own position tracker, SL/TP engine, and balance
 * accounting so results are deterministic and reproducible.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../lib/logger";
import { resolveStrategy, type StrategyId } from "./strategies";
import type { MarketCandle } from "./strategyService";
import { type RiskProfile, RISK_PROFILES } from "../lib/positionSizingService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BacktestParams {
  strategy:       StrategyId;
  symbol:         string;
  timeframe:      string;
  startDate:      string;
  endDate:        string;
  initialBalance: number;
  tradingFeesPct: number;
  slippagePct:    number;
  riskProfile:    RiskProfile;
  positionSizing: boolean;
}

export interface BacktestTrade {
  entryTime:    string;
  exitTime:     string;
  entryPrice:   number;
  exitPrice:    number;
  qty:          number;
  notionalUsdt: number;
  pnlUsd:       number;
  pnlPct:       number;
  holdMins:     number;
  exitReason:   "tp" | "sl" | "signal" | "end";
  fees:         number;
}

export interface BacktestMetrics {
  totalReturnPct: number;
  netProfit:      number;
  winRate:        number;
  profitFactor:   number;
  sharpeRatio:    number;
  sortinoRatio:   number;
  maxDrawdownPct: number;
  avgTrade:       number;
  avgWin:         number;
  avgLoss:        number;
  largestWin:     number;
  largestLoss:    number;
  expectancy:     number;
  riskRewardRatio: number;
  avgHoldMins:    number;
  totalTrades:    number;
  wins:           number;
  losses:         number;
  totalFees:      number;
  finalBalance:   number;
}

/** Detailed per-run signal diagnostics — included in every BacktestResult */
export interface BacktestDiagnostics {
  candlesProcessed:          number;
  warmupCandles:             number;
  signalsEvaluated:          number;  // candles after warmup where signal was called
  buySignals:                number;
  sellSignals:               number;
  holdSignals:               number;
  tradesOpened:              number;
  tradesClosed:              number;
  exitByTp:                  number;
  exitBySl:                  number;
  exitBySignal:              number;
  exitByEnd:                 number;
  blockedByDailyCap:         number;
  blockedByInsufficientBal:  number;
  topHoldReasons:            Array<{ reason: string; count: number }>;
  verification: {
    sameCodeAsLiveTrading:   true;
    portfolioRegistryUsed:   false;
    advancedRiskEngineUsed:  false;
    orchestratorUsed:        false;
  };
}

export interface EquityPoint     { time: string; balance: number; drawdown: number; }
export interface MonthlyReturn   { month: string; returnPct: number; trades: number; }
export interface TradeDistBucket { bucket: string; count: number; }

export interface BacktestCharts {
  equityCurve:       EquityPoint[];
  drawdownCurve:     EquityPoint[];
  monthlyReturns:    MonthlyReturn[];
  tradeDistribution: TradeDistBucket[];
}

export interface BacktestResult {
  params:       BacktestParams;
  metrics:      BacktestMetrics;
  charts:       BacktestCharts;
  trades:       BacktestTrade[];
  diagnostics:  BacktestDiagnostics;
  candlesUsed:  number;
  durationMs:   number;
}

// ─── Gate.io candle fetch ─────────────────────────────────────────────────────
//
// ROOT CAUSE FIX (2026-06-02):
//   Gate.io rejects requests where `from` + `to` + `limit=1000` spans more than
//   1000 data points.  `to = cursor + ivSec * 1000` creates a window of 1001
//   inclusive data points — one over the limit.
//   Fix: use `from` + `limit` ONLY (drop the `to` parameter when paginating).
//   Filter any candles beyond `end` client-side after each batch.
//
// Reference error: {"label":"INVALID_PARAM_VALUE",
//   "message":"Candlestick range too broad. Maximum 1000 data points are allowed per request"}

const GATE_BASE = "https://api.gateio.ws/api/v4";
const BATCH     = 1000;

/** Convert BTCUSDT → BTC_USDT for Gate.io REST currency_pair param */
function toRestSymbol(raw: string): string {
  if (raw.includes("_")) return raw;
  if (raw.includes("/")) return raw.replace("/", "_");
  const quotes = ["USDT", "USDC", "USD", "BTC", "ETH", "BUSD", "EUR"];
  for (const q of quotes) {
    if (raw.endsWith(q)) {
      const base = raw.slice(0, -q.length);
      if (base) return `${base}_${q}`;
    }
  }
  return raw;
}

const IV_SECONDS: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "4h": 14400, "1d": 86400,
};

async function fetchCandles(
  symbol: string, tf: string, fromMs: number, toMs: number,
): Promise<MarketCandle[]> {
  const interval = tf in IV_SECONDS ? tf : "1h";
  const ivSec    = IV_SECONDS[interval]!;
  const all: MarketCandle[] = [];

  let cursor = Math.floor(fromMs / 1000);
  const end  = Math.floor(toMs   / 1000);

  logger.info({ symbol, interval, from: cursor, to: end,
    fromIso: new Date(cursor * 1000).toISOString(),
    toIso:   new Date(end    * 1000).toISOString() },
    "backtest:fetchCandles start");

  let batchNum = 0;
  while (cursor < end) {
    // ── FIXED: use from+limit WITHOUT &to to avoid Gate.io "range too broad" 400 ──
    const url = `${GATE_BASE}/spot/candlesticks?currency_pair=${toRestSymbol(symbol)}&interval=${interval}&from=${cursor}&limit=${BATCH}`;
    batchNum++;
    logger.debug({ batchNum, cursor, url }, "backtest:fetchCandles batch");

    let res: Response;
    let bodyText: string;
    try {
      res      = await fetch(url);
      bodyText = await res.text();
    } catch (e) {
      throw new Error(`Gate.io network error: ${String(e)}`);
    }

    if (!res.ok) {
      logger.error({ batchNum, status: res.status, url, body: bodyText },
        "backtest:fetchCandles Gate.io error");
      throw new Error(`Gate.io ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    let raw: string[][];
    try {
      raw = JSON.parse(bodyText) as string[][];
    } catch {
      throw new Error(`Gate.io response parse error: ${bodyText.slice(0, 200)}`);
    }

    if (!raw.length) break;

    let added = 0;
    for (const r of raw) {
      const ts = Number(r[0]);
      if (ts > end) continue;
      all.push({
        time:   ts * 1000,
        open:   Number(r[5]),
        high:   Number(r[3]),
        low:    Number(r[4]),
        close:  Number(r[2]),
        volume: Number(r[6]),
      });
      added++;
    }

    logger.debug({ batchNum, rawRows: raw.length, added, totalSoFar: all.length },
      "backtest:fetchCandles batch done");

    const lastRaw = raw[raw.length - 1]!;
    const lastTs  = Number(lastRaw[0]);
    cursor = lastTs + ivSec;

    if (raw.length < BATCH) break;
    if (lastTs >= end)       break;
  }

  logger.info({ symbol, interval, totalCandles: all.length, batches: batchNum },
    "backtest:fetchCandles complete");

  all.sort((a, b) => a.time - b.time);
  const seen = new Set<number>();
  return all.filter((c) => { if (seen.has(c.time)) return false; seen.add(c.time); return true; });
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function mean(a: number[])   { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stdDev(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
function downDev(a: number[]) {
  const neg = a.filter((v) => v < 0);
  return neg.length ? stdDev(neg) : 0;
}

// ─── Inline position sizing (mirrors PositionSizingService.calculate) ─────────

const MIN_POS  = 5;
const MAX_PCT  = 0.20;
const MAX_HARD = 500;

function calcPositionSize(
  balance:     number,
  riskProfile: RiskProfile,
  entryPrice:  number,
  slPct:       number,
  atr:         number | null,
): number {
  const riskPct    = RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES] ?? 0.010;
  const riskAmount = balance * riskPct;
  const slDistPct  = entryPrice * slPct;
  const slDist     = (atr && atr > slDistPct) ? atr : slDistPct;
  if (slDist <= 0) return MIN_POS;

  let size = riskAmount / slDist;
  if (size < MIN_POS) size = MIN_POS;
  const cap = Math.min(MAX_HARD, balance * MAX_PCT);
  if (size > cap) size = cap;
  return size;
}

// ─── Core simulation ──────────────────────────────────────────────────────────

export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  const t0 = Date.now();
  logger.info({ strategy: params.strategy, symbol: params.symbol }, "backtest: starting");

  const fromMs = new Date(params.startDate).getTime();
  const toMs   = new Date(params.endDate).getTime() + 86_400_000;

  const candles = await fetchCandles(params.symbol, params.timeframe, fromMs, toMs);
  if (candles.length < 30) throw new Error(`Too few candles: ${candles.length} (need ≥ 30)`);

  logger.info({ candles: candles.length }, "backtest: candles loaded");

  // ── Diagnostic counters ─────────────────────────────────────────────────────
  let diagBuySignals        = 0;
  let diagSellSignals       = 0;
  let diagHoldSignals       = 0;
  let diagWarmupSkipped     = 0;
  let diagSignalsEvaluated  = 0;
  let diagBlockedDailyCap   = 0;
  let diagBlockedLowBal     = 0;
  let diagTradesOpened      = 0;
  let diagTradesClosed      = 0;
  let diagExitTp            = 0;
  let diagExitSl            = 0;
  let diagExitSignal        = 0;
  let diagExitEnd           = 0;
  const holdReasonMap       = new Map<string, number>();

  // ── Simulation state ────────────────────────────────────────────────────────
  let balance = params.initialBalance;
  let peak    = balance;
  const done: BacktestTrade[]  = [];
  const eq:   EquityPoint[]    = [];

  interface Pos {
    entryTime:  string;
    entryPrice: number;
    qty:        number;
    notional:   number;
    sl:         number | null;
    tp:         number | null;
  }
  let pos:       Pos | null = null;
  let dailyCount = 0;
  let lastDay    = "";

  // ── Strategy engine — same function used by the live bot ───────────────────
  //    Verification:
  //      ✓ resolveStrategy(id).fn === the identical pure function called by
  //        the live tradeService / strategyService pipeline
  //      ✗ portfolioRegistry  — NOT present here
  //      ✗ advancedRiskEngine — NOT present here
  //      ✗ orchestrator       — NOT present here
  const engine = resolveStrategy(params.strategy);
  logger.info({ engine: engine.engineName, strategy: params.strategy },
    "backtest: engine resolved (same code as live trading)");

  // ── Main simulation loop ─────────────────────────────────────────────────
  for (let i = 0; i < candles.length; i++) {
    const c   = candles[i]!;
    const day = new Date(c.time).toISOString().slice(0, 10);
    if (day !== lastDay) { dailyCount = 0; lastDay = day; }

    // ── SL / TP / end check ──────────────────────────────────────────────────
    if (pos) {
      let closeAt: number | null = null;
      let reason: BacktestTrade["exitReason"] = "signal";

      if      (pos.sl !== null && c.low  <= pos.sl) { closeAt = pos.sl;    reason = "sl";  }
      else if (pos.tp !== null && c.high >= pos.tp) { closeAt = pos.tp;    reason = "tp";  }
      else if (i === candles.length - 1)            { closeAt = c.close;   reason = "end"; }

      if (closeAt !== null) {
        const exitPrice = closeAt * (1 - params.slippagePct / 100);
        const exitFee   = pos.qty * exitPrice * (params.tradingFeesPct / 100);
        const entryFee  = pos.notional    * (params.tradingFeesPct / 100);
        const gross     = (exitPrice - pos.entryPrice) * pos.qty;
        const net       = gross - entryFee - exitFee;
        const pnlPct    = net / (pos.notional + entryFee);

        balance += pos.notional + entryFee + net;
        if (balance > peak) peak = balance;
        dailyCount++;

        diagTradesClosed++;
        if (reason === "tp")     diagExitTp++;
        else if (reason === "sl")    diagExitSl++;
        else if (reason === "signal") diagExitSignal++;
        else if (reason === "end")    diagExitEnd++;

        const trade: BacktestTrade = {
          entryTime:    pos.entryTime,
          exitTime:     new Date(c.time).toISOString(),
          entryPrice:   +pos.entryPrice.toFixed(6),
          exitPrice:    +exitPrice.toFixed(6),
          qty:          +pos.qty.toFixed(8),
          notionalUsdt: +(pos.notional + entryFee).toFixed(4),
          pnlUsd:       +net.toFixed(4),
          pnlPct:       +pnlPct.toFixed(6),
          holdMins:     Math.round((c.time - new Date(pos.entryTime).getTime()) / 60_000),
          exitReason:   reason,
          fees:         +(entryFee + exitFee).toFixed(4),
        };
        done.push(trade);

        logger.debug({
          trade: diagTradesClosed,
          exitReason: reason,
          pnlUsd: trade.pnlUsd,
          pnlPct: (trade.pnlPct * 100).toFixed(2) + "%",
          holdMins: trade.holdMins,
          balance: +balance.toFixed(2),
        }, "backtest: trade closed");

        pos = null;
        const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
        eq.push({ time: new Date(c.time).toISOString(), balance: +balance.toFixed(4), drawdown: +dd.toFixed(4) });
        continue;
      }
      continue; // still in trade — skip signal evaluation
    }

    // ── Balance guard ────────────────────────────────────────────────────────
    if (balance < 10) { diagBlockedLowBal++; continue; }

    // ── Signal generation — identical to live bot call ───────────────────────
    diagSignalsEvaluated++;
    const sig = engine.fn({ candles: candles.slice(0, i + 1), currentPrice: c.close, dailyTradeCount: dailyCount });

    // ── Count signal types ───────────────────────────────────────────────────
    if (sig.action === "BUY") {
      diagBuySignals++;
      logger.debug({
        candle: i, time: new Date(c.time).toISOString().slice(0, 16),
        price: c.close, rsi: sig.rsi?.toFixed(1), ema50: sig.ema50?.toFixed(2),
        ema200: sig.ema200?.toFixed(2), confidence: sig.confidence,
        reason: sig.reason,
      }, "backtest: BUY signal");
    } else if (sig.action === "SELL") {
      diagSellSignals++;
      logger.debug({
        candle: i, time: new Date(c.time).toISOString().slice(0, 16),
        reason: sig.reason,
      }, "backtest: SELL signal (no open position — skipped)");
    } else {
      // Distinguish warmup HOLDs (strategy needs more candles) from real HOLDs
      const isWarmup = sig.canTrade === true && typeof sig.reason === "string" &&
        sig.reason.startsWith("Need ") && sig.reason.includes(" candles");
      const isDailyCap = sig.canTrade === false;

      if (isWarmup) {
        diagWarmupSkipped++;
        // Don't add to holdSignals — warmup is a distinct category
      } else {
        diagHoldSignals++;
        if (isDailyCap) {
          diagBlockedDailyCap++;
          const key = sig.blockReason ?? sig.reason ?? "blocked_unknown";
          holdReasonMap.set(key, (holdReasonMap.get(key) ?? 0) + 1);
        } else {
          // Extract condensed reason for heat-map (strip per-value noise)
          const raw = sig.reason ?? "hold_no_reason";
          const condensed = raw
            .replace(/=[\d.]+/g, "")
            .replace(/\([^)]*\)/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80);
          holdReasonMap.set(condensed, (holdReasonMap.get(condensed) ?? 0) + 1);
        }
      }
    }

    if (sig.action !== "BUY") continue;

    // ── Position sizing ──────────────────────────────────────────────────────
    let notionalUsdt: number;
    if (params.positionSizing && sig.stopLossPct != null && sig.stopLossPct > 0) {
      notionalUsdt = calcPositionSize(balance, params.riskProfile, c.close, sig.stopLossPct, sig.atr);
    } else {
      notionalUsdt = Math.min(balance * 0.10, 500);
    }
    notionalUsdt = Math.max(5, Math.min(notionalUsdt, balance));
    if (notionalUsdt > balance) { diagBlockedLowBal++; continue; }

    const entryFee   = notionalUsdt * (params.tradingFeesPct / 100);
    const entryPrice = c.close * (1 + params.slippagePct / 100);
    const net        = notionalUsdt - entryFee;
    balance -= notionalUsdt;

    diagTradesOpened++;
    pos = {
      entryTime:  new Date(c.time).toISOString(),
      entryPrice, qty: net / entryPrice, notional: net,
      sl: sig.suggestedSl, tp: sig.suggestedTp,
    };

    logger.debug({
      trade: diagTradesOpened,
      time: new Date(c.time).toISOString().slice(0, 16),
      entryPrice: entryPrice.toFixed(2),
      notionalUsdt: notionalUsdt.toFixed(2),
      sl: pos.sl?.toFixed(2) ?? "none",
      tp: pos.tp?.toFixed(2) ?? "none",
      balance: +balance.toFixed(2),
      reason: sig.reason,
    }, "backtest: trade opened");

    const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    eq.push({ time: new Date(c.time).toISOString(), balance: +balance.toFixed(4), drawdown: +dd.toFixed(4) });
  }

  // ── Build top hold reasons (sorted, top 10) ───────────────────────────────
  const topHoldReasons = Array.from(holdReasonMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  // ── Diagnostics object ────────────────────────────────────────────────────
  const diagnostics: BacktestDiagnostics = {
    candlesProcessed:         candles.length,
    warmupCandles:            diagWarmupSkipped,
    signalsEvaluated:         diagSignalsEvaluated,
    buySignals:               diagBuySignals,
    sellSignals:              diagSellSignals,
    holdSignals:              diagHoldSignals,
    tradesOpened:             diagTradesOpened,
    tradesClosed:             diagTradesClosed,
    exitByTp:                 diagExitTp,
    exitBySl:                 diagExitSl,
    exitBySignal:             diagExitSignal,
    exitByEnd:                diagExitEnd,
    blockedByDailyCap:        diagBlockedDailyCap,
    blockedByInsufficientBal: diagBlockedLowBal,
    topHoldReasons,
    verification: {
      sameCodeAsLiveTrading:  true,
      portfolioRegistryUsed:  false,
      advancedRiskEngineUsed: false,
      orchestratorUsed:       false,
    },
  };

  // ── Metrics ────────────────────────────────────────────────────────────────
  const wins   = done.filter((t) => t.pnlUsd > 0);
  const losses = done.filter((t) => t.pnlUsd <= 0);

  const grossWin  = wins.reduce((s, t)   => s + t.pnlUsd,         0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(t.pnlUsd), 0);
  const netProfit = done.reduce((s, t)   => s + t.pnlUsd,          0);
  const finalBal  = params.initialBalance + netProfit;

  const retPct    = done.map((t) => t.pnlPct);
  const retMean   = mean(retPct);
  const retStd    = stdDev(retPct);
  const retDnStd  = downDev(retPct);
  const annFactor = Math.sqrt(252);
  const sharpe    = retStd   > 0 ? (retMean / retStd)   * annFactor : 0;
  const sortino   = retDnStd > 0 ? (retMean / retDnStd) * annFactor : 0;

  const maxDd      = eq.reduce((m, p) => Math.max(m, p.drawdown), 0);
  const totalFees  = done.reduce((s, t) => s + t.fees, 0);
  const winRate    = done.length ? (wins.length / done.length) * 100 : 0;
  const pFactor    = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const avgWin     = wins.length   ? grossWin   / wins.length   : 0;
  const avgLoss    = losses.length ? grossLoss  / losses.length : 0;
  const rrRatio    = avgLoss > 0   ? avgWin / avgLoss : 0;
  const expectancy = done.length   ? ((wins.length * avgWin) - (losses.length * avgLoss)) / done.length : 0;

  const metrics: BacktestMetrics = {
    totalReturnPct:  +((netProfit / params.initialBalance) * 100).toFixed(2),
    netProfit:       +netProfit.toFixed(4),
    winRate:         +winRate.toFixed(2),
    profitFactor:    +Math.min(pFactor, 999).toFixed(3),
    sharpeRatio:     +sharpe.toFixed(3),
    sortinoRatio:    +sortino.toFixed(3),
    maxDrawdownPct:  +maxDd.toFixed(2),
    avgTrade:        done.length ? +(netProfit / done.length).toFixed(4) : 0,
    avgWin:          +avgWin.toFixed(4),
    avgLoss:         +avgLoss.toFixed(4),
    largestWin:      wins.length   ? +Math.max(...wins.map((t)   => t.pnlUsd)).toFixed(4) : 0,
    largestLoss:     losses.length ? +Math.min(...losses.map((t) => t.pnlUsd)).toFixed(4) : 0,
    expectancy:      +expectancy.toFixed(4),
    riskRewardRatio: +rrRatio.toFixed(3),
    avgHoldMins:     done.length ? +mean(done.map((t) => t.holdMins)).toFixed(1) : 0,
    totalTrades:     done.length,
    wins:            wins.length,
    losses:          losses.length,
    totalFees:       +totalFees.toFixed(4),
    finalBalance:    +finalBal.toFixed(4),
  };

  // ── Charts ─────────────────────────────────────────────────────────────────
  const MAX_EQ  = 500;
  const step    = Math.max(1, Math.floor(eq.length / MAX_EQ));
  const eqCurve = eq.filter((_, i) => i % step === 0);

  const mBuckets = new Map<string, { pnl: number; trades: number }>();
  for (const t of done) {
    const m = t.exitTime.slice(0, 7);
    const b = mBuckets.get(m) ?? { pnl: 0, trades: 0 };
    b.pnl += t.pnlUsd; b.trades++;
    mBuckets.set(m, b);
  }
  const monthlyReturns: MonthlyReturn[] = Array.from(mBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { pnl, trades }]) => ({
      month, trades, returnPct: +((pnl / params.initialBalance) * 100).toFixed(2),
    }));

  const BUCKET = 5;
  const dMap   = new Map<number, number>();
  for (const t of done) {
    const key = Math.floor(t.pnlUsd / BUCKET) * BUCKET;
    dMap.set(key, (dMap.get(key) ?? 0) + 1);
  }
  const tradeDistribution: TradeDistBucket[] = Array.from(dMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([key, count]) => ({ bucket: key >= 0 ? `+$${key}` : `-$${Math.abs(key)}`, count }));

  const durationMs = Date.now() - t0;

  // ── BACKTEST SUMMARY ────────────────────────────────────────────────────────
  const days = Math.round((toMs - fromMs) / 86_400_000);
  logger.info({
    "═══ BACKTEST SUMMARY": "═══",
    strategy:              params.strategy,
    symbol:                params.symbol,
    timeframe:             params.timeframe,
    window:                `${days}d (${params.startDate} → ${params.endDate})`,
    "": "",
    candlesProcessed:      diagnostics.candlesProcessed,
    warmupCandles:         diagnostics.warmupCandles,
    signalsEvaluated:      diagnostics.signalsEvaluated,
    buySignals:            diagnostics.buySignals,
    sellSignals:           diagnostics.sellSignals,
    holdSignals:           diagnostics.holdSignals,
    " ": "",
    tradesOpened:          diagnostics.tradesOpened,
    tradesClosed:          diagnostics.tradesClosed,
    exitByTp:              diagnostics.exitByTp,
    exitBySl:              diagnostics.exitBySl,
    exitByEnd:             diagnostics.exitByEnd,
    "  ": "",
    blockedByDailyCap:     diagnostics.blockedByDailyCap,
    blockedByLowBalance:   diagnostics.blockedByInsufficientBal,
    "   ": "",
    topHoldReason1:        diagnostics.topHoldReasons[0] ?? null,
    topHoldReason2:        diagnostics.topHoldReasons[1] ?? null,
    topHoldReason3:        diagnostics.topHoldReasons[2] ?? null,
    "    ": "",
    "✓ sameCodeAsLive":    true,
    "✗ portfolioRegistry": false,
    "✗ riskEngine":        false,
    "✗ orchestrator":      false,
    "     ": "",
    netProfit:             metrics.netProfit,
    winRate:               metrics.winRate + "%",
    totalTrades:           metrics.totalTrades,
    finalBalance:          metrics.finalBalance,
    durationMs,
  }, "backtest: done");

  return {
    params, metrics,
    charts: { equityCurve: eqCurve, drawdownCurve: eqCurve, monthlyReturns, tradeDistribution },
    trades: done, diagnostics, candlesUsed: candles.length, durationMs,
  };
}
