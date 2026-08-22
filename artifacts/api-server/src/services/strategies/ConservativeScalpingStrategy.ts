/**
 * ConservativeScalpingStrategy v2.1 — Phase 8.5 (Growth Optimization)
 *
 * Multi-timeframe confirmation: EMA50/200 trend + EMA9/21 entry (both 15m).
 * Optimised for a $1,000 account targeting 8–15% monthly ROI.
 *
 * ── DESIGN RATIONALE ────────────────────────────────────────────────────────
 *
 * v2.0 (Phase 8.4) → v2.1 (Phase 8.5) recalibration:
 *   • RSI widened:   38–68  (was 40–65) — more conditions met mid-trend
 *   • Volume lower:  ≥0.7×  (was 0.8×) — pass light-volume moves
 *   • ATR:           0.2%–1.5% (unchanged)
 *   • Daily cap:     4 trades (was 6) — focus on quality over quantity
 *   • Monthly cap:   50 trades (target 40–50)
 *
 * Target: 40–50 trades/month, PF ≥ 1.3, MaxDD < 8%, WR 45–60%
 *
 * ── PARAMETERS ──────────────────────────────────────────────────────────────
 *
 *   Trend:   EMA50 > EMA200 (15m — proxies 1h trend)
 *   Entry:   EMA9  > EMA21  (15m)
 *   RSI:     38–68  BUY
 *   Volume:  ≥ 0.7× 20-period average
 *   ATR:     0.2%–1.5% of price
 *   Price:   > EMA21
 *   Min cond: 4/6
 *   SL:      0.7%
 *   TP:      1.2%  (R:R ≈ 1.71)
 *   Daily cap:    4 trades
 *   Monthly cap:  50 trades  (target 40–50)
 *   Symbol cap:   12/month
 *
 * ── PURE MODULE ─────────────────────────────────────────────────────────────
 *   No exchange calls.  No database writes.  No side effects.
 */

import type { GenerateSignalInput, StrategySignal } from "../strategyService";
import { computeEMA, computeRSI, computeATR, computeVolumeAvg } from "../strategyService";

// ─── Engine identity ──────────────────────────────────────────────────────────

export const ENGINE_NAME = "ConservativeScalpingStrategy";

export const STRATEGY_METADATA = {
  timeframe:              "15m",
  expectedTradesPerWeek:  11,     // 40–50/month ÷ 4.3 weeks ≈ 9–12/week
  riskLevel:              "low",
} as const;

// ─── Tunable parameters (Phase 8.5) ──────────────────────────────────────────

const EMA_TREND_FAST    = 50;
const EMA_TREND_SLOW    = 200;
const EMA_ENTRY_FAST    = 9;
const EMA_ENTRY_SLOW    = 21;
const RSI_PERIOD        = 14;
const ATR_PERIOD        = 14;
const VOLUME_AVG_PERIOD = 20;

const RSI_BUY_LOW  = 38;   // was 40
const RSI_BUY_HIGH = 68;   // was 65

const VOLUME_BUY_RATIO = 0.7;   // was 0.8

const ATR_MIN_PCT = 0.002;   // 0.2% (unchanged)
const ATR_MAX_PCT = 0.015;   // 1.5% (unchanged)

const SL_PCT = 0.007;   // 0.7%
const TP_PCT = 0.012;   // 1.2% (R:R ≈ 1.71)

const MAX_DAILY_TRADES   = 4;    // was 6
const MONTHLY_CAP        = 50;   // was 60; target 40–50
const SYMBOL_MONTHLY_CAP = 12;   // was 15
const MIN_CANDLES        = 202;  // EMA200 warm-up

// ─── Exported parameter snapshot ──────────────────────────────────────────────

export const STRATEGY_PARAMS = {
  name:             "Conservative Scalping v2.1",
  trendframe:       "15m (EMA50/200)",
  entryframe:       "15m (EMA9/21)",
  emaTrendFast:     EMA_TREND_FAST,
  emaTrendSlow:     EMA_TREND_SLOW,
  emaEntryFast:     EMA_ENTRY_FAST,
  emaEntrySlow:     EMA_ENTRY_SLOW,
  rsiBuyLow:        RSI_BUY_LOW,
  rsiBuyHigh:       RSI_BUY_HIGH,
  volumeRatio:      VOLUME_BUY_RATIO,
  atrMinPct:        ATR_MIN_PCT,
  atrMaxPct:        ATR_MAX_PCT,
  slPct:            SL_PCT,
  tpPct:            TP_PCT,
  dailyCap:         MAX_DAILY_TRADES,
  monthlyCap:       MONTHLY_CAP,
  symbolMonthlyCap: SYMBOL_MONTHLY_CAP,
  minConditions:    4,
  minCandles:       MIN_CANDLES,
  targetMin:        40,
  targetMax:        50,
  phase:            "8.5",
};

// ─── Approved symbols ─────────────────────────────────────────────────────────

export const APPROVED_SYMBOLS = [
  "BTC_USDT", "ETH_USDT", "SOL_USDT", "BNB_USDT", "XRP_USDT",
  "ADA_USDT", "AVAX_USDT", "DOGE_USDT", "LINK_USDT", "SUI_USDT",
];

// ─── In-memory trade counters ─────────────────────────────────────────────────

interface TradeCounters {
  month:    string;
  total:    number;
  byDay:    Record<string, number>;
  bySymbol: Record<string, number>;
}

function yyyyMM():   string { return new Date().toISOString().slice(0, 7); }
function yyyyMMDD(): string { return new Date().toISOString().slice(0, 10); }

let _counters: TradeCounters = {
  month:    yyyyMM(),
  total:    0,
  byDay:    {},
  bySymbol: {},
};

function ensureMonth(): void {
  const m = yyyyMM();
  if (_counters.month !== m) {
    _counters = { month: m, total: 0, byDay: {}, bySymbol: {} };
  }
}

export function recordTrade(symbol = "UNKNOWN"): void {
  ensureMonth();
  _counters.total++;
  const day = yyyyMMDD();
  _counters.byDay[day]         = (_counters.byDay[day]         ?? 0) + 1;
  _counters.bySymbol[symbol]   = (_counters.bySymbol[symbol]   ?? 0) + 1;
}

export function getTradeCounters(): Readonly<TradeCounters> {
  ensureMonth();
  return { ..._counters, byDay: { ..._counters.byDay }, bySymbol: { ..._counters.bySymbol } };
}

export function getMonthlyProjection(): number {
  ensureMonth();
  const now        = new Date();
  const dayOfMonth = now.getDate();
  if (dayOfMonth === 0) return 0;
  return Math.round((_counters.total / dayOfMonth) * 31);
}

// ─── Buy conditions checklist ─────────────────────────────────────────────────

export interface ConsBuyConditions {
  trendAligned:     boolean;
  entryEmaAligned:  boolean;
  rsiInRange:       boolean;
  volumeAboveRatio: boolean;
  priceAboveEma21:  boolean;
  atrInWindow:      boolean;
}

// ─── Main signal generator ────────────────────────────────────────────────────

export function generateSignal(input: GenerateSignalInput): StrategySignal {
  const { candles, currentPrice, dailyTradeCount } = input;

  if (dailyTradeCount >= MAX_DAILY_TRADES) {
    return makeHold(null, null, null, null, null, null,
      false, `Daily trade limit reached (${dailyTradeCount}/${MAX_DAILY_TRADES})`);
  }

  ensureMonth();
  if (_counters.total >= MONTHLY_CAP) {
    return makeHold(null, null, null, null, null, null,
      false, `Monthly trade limit reached (${_counters.total}/${MONTHLY_CAP})`);
  }

  if (candles.length < MIN_CANDLES) {
    return makeHold(null, null, null, null, null, null,
      true, `Not enough candles (have ${candles.length}, need ${MIN_CANDLES})`);
  }

  const closes  = candles.map((c) => c.close);
  const highs   = candles.map((c) => c.high);
  const lows    = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const ema50Arr  = computeEMA(closes, EMA_TREND_FAST);
  const ema200Arr = computeEMA(closes, EMA_TREND_SLOW);
  const ema9Arr   = computeEMA(closes, EMA_ENTRY_FAST);
  const ema21Arr  = computeEMA(closes, EMA_ENTRY_SLOW);

  const lastIdx = closes.length - 1;

  const ema50  = ema50Arr[lastIdx]  ?? null;
  const ema200 = ema200Arr[lastIdx] ?? null;
  const ema9   = ema9Arr[lastIdx]   ?? null;
  const ema21  = ema21Arr[lastIdx]  ?? null;

  const rsi        = computeRSI(closes, RSI_PERIOD);
  const atr        = computeATR(highs, lows, closes, ATR_PERIOD);
  const currentVol = volumes[lastIdx] ?? null;
  const avgVol     = computeVolumeAvg(volumes.slice(0, -1), VOLUME_AVG_PERIOD);

  const price = currentPrice > 0 ? currentPrice : (closes[lastIdx] ?? 0);

  const suggestedSl   = price * (1 - SL_PCT);
  const suggestedTp   = price * (1 + TP_PCT);
  const stopLossPct   = SL_PCT;
  const takeProfitPct = TP_PCT;

  if (ema50 == null || ema200 == null || ema9 == null || ema21 == null || rsi == null || atr == null) {
    return makeHold(ema50, ema200, rsi, atr, currentVol, avgVol,
      true, "HOLD: waiting for indicators to warm up");
  }

  const atrPct   = atr / price;
  const volRatio = currentVol != null && avgVol != null && avgVol > 0
    ? currentVol / avgVol : 0;

  const buy: ConsBuyConditions = {
    trendAligned:     ema50 > ema200,
    entryEmaAligned:  ema9  > ema21,
    rsiInRange:       rsi >= RSI_BUY_LOW && rsi <= RSI_BUY_HIGH,
    volumeAboveRatio: volRatio >= VOLUME_BUY_RATIO,
    priceAboveEma21:  price > ema21,
    atrInWindow:      atrPct >= ATR_MIN_PCT && atrPct <= ATR_MAX_PCT,
  };

  const allChecks = Object.values(buy);
  const metCount  = allChecks.filter(Boolean).length;
  const totalCond = allChecks.length;
  const conf      = Math.round((metCount / totalCond) * 100);

  const atrBlocked  = atrPct > ATR_MAX_PCT;
  const trendBroken = !buy.trendAligned;
  const MIN_MET     = 4;

  if (!atrBlocked && !trendBroken && metCount >= MIN_MET) {
    return {
      action:        "BUY",
      confidence:    conf,
      ema50, ema200, rsi, atr, currentVol, avgVol,
      suggestedSl, suggestedTp, stopLossPct, takeProfitPct,
      canTrade: true, blockReason: null, conditions: null,
      reason:
        `BUY: ${metCount}/${totalCond} cond — ` +
        `EMA9(${ema9.toFixed(2)})>EMA21(${ema21.toFixed(2)}), ` +
        `trend ${ema50 > ema200 ? "✓" : "✗"}, ` +
        `RSI=${rsi.toFixed(1)}, vol=${volRatio.toFixed(2)}×, ` +
        `ATR=${(atrPct * 100).toFixed(3)}%`,
    };
  }

  const sellConditions = {
    ema9BelowEma21:  ema9 < ema21,
    rsiOverbought:   rsi > RSI_BUY_HIGH,
    volumeConfirmed: volRatio >= VOLUME_BUY_RATIO,
  };
  const sellMet = Object.values(sellConditions).filter(Boolean).length;

  if (sellMet >= 2) {
    return {
      action:        "SELL",
      confidence:    Math.round((sellMet / 3) * 100),
      ema50, ema200, rsi, atr, currentVol, avgVol,
      suggestedSl:   null, suggestedTp:   null,
      stopLossPct:   null, takeProfitPct: null,
      canTrade: true, blockReason: null, conditions: null,
      reason: `SELL: EMA9(${ema9.toFixed(2)})<EMA21(${ema21.toFixed(2)}), RSI=${rsi.toFixed(1)}, vol=${volRatio.toFixed(2)}×`,
    };
  }

  if (atrBlocked) {
    return makeHold(ema50, ema200, rsi, atr, currentVol, avgVol,
      false, `HOLD: ATR spike blocked — ${(atrPct * 100).toFixed(3)}% > ${(ATR_MAX_PCT * 100).toFixed(1)}%`);
  }

  return makeHold(ema50, ema200, rsi, atr, currentVol, avgVol,
    true,
    `HOLD: ${metCount}/${totalCond} cond — ` +
    `trend=${buy.trendAligned}, ema9>21=${buy.entryEmaAligned}, ` +
    `RSI=${rsi.toFixed(1)}, vol=${volRatio.toFixed(2)}×, ATR=${(atrPct * 100).toFixed(3)}%`);
}

// ─── HOLD factory ─────────────────────────────────────────────────────────────

function makeHold(
  ema50:      number | null,
  ema200:     number | null,
  rsi:        number | null,
  atr:        number | null,
  currentVol: number | null,
  avgVol:     number | null,
  canTrade:   boolean,
  reason:     string,
): StrategySignal {
  return {
    action:        "HOLD",
    confidence:    0,
    ema50, ema200, rsi, atr, currentVol, avgVol,
    suggestedSl:   null, suggestedTp:   null,
    stopLossPct:   null, takeProfitPct: null,
    canTrade,
    blockReason: canTrade ? null : reason,
    conditions:  null,
    reason,
  };
}
