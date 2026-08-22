/**
 * ActiveSwingStrategy — Phase 8.7 (Dual-Mode Trade Generation)
 *
 * Multi-timeframe Active Swing system targeting 15–25 trades/month.
 * Optimised for a $1,000 account targeting 8–15% monthly ROI.
 *
 * ── DESIGN ───────────────────────────────────────────────────────────────────
 *
 * Trend filter  (4h candles — EMA50/EMA200) — DUAL MODE (Phase 8.7):
 *   LONG  mode: EMA50 > EMA200   (bull trend)  → evaluates BUY entries
 *   SHORT mode: EMA50 < EMA200   (bear trend)  → evaluates SHORT entries
 *   Flat  (EMA50 == EMA200) is treated as LONG mode (neutral default).
 *
 * LONG entry logic (4h candles, min 3/5 conditions):
 *   1. trend      — EMA20 > EMA50  (short-term momentum aligned)
 *   2. RSI        — RSI 30–70      (widened for more opportunities)
 *   3. volume     — volume ≥ 0.5× 20-period average (was 0.8×)
 *   4. ATR        — ATR 0.15%–2.0% of price (was 0.2%–1.8%)
 *   5. crossover  — price within 1 ATR of EMA20 or EMA50 (pullback)
 *   ▸ Minimum 3 of 5 must be met to generate a BUY signal.
 *
 * SHORT entry logic (4h candles, min 3/5 conditions — mirrored, Phase 8.7):
 *   1. trend      — EMA20 < EMA50  (short-term bearish momentum aligned)
 *   2. RSI        — RSI 30–70      (same band; avoids only-extreme entries)
 *   3. volume     — volume ≥ 0.5× 20-period average
 *   4. ATR        — ATR 0.15%–2.0% of price
 *   5. crossover  — price within 1 ATR of EMA20 or EMA50 (rally into resistance)
 *   ▸ Minimum 3 of 5 must be met to generate a SHORT signal.
 *
 * Risk (same for both directions):
 *   SL: 1.2%  TP: 2.0%  (R:R = 1.67)
 *   Account risk per trade: 1% (via positionSizingService) — UNCHANGED
 *
 * Trade frequency controls (shared across LONG + SHORT):
 *   Daily cap:          2 trades
 *   Monthly cap:        25 trades (target 15–25)
 *   Symbol monthly cap: 8 trades
 *
 * Approved symbols (10):
 *   BTC_USDT, ETH_USDT, SOL_USDT, BNB_USDT, XRP_USDT,
 *   ADA_USDT, AVAX_USDT, DOGE_USDT, LINK_USDT, SUI_USDT
 *
 * NOTE: this module only changes SIGNAL GENERATION. No risk-engine or
 * orchestration (bot.ts execution loop) changes were made in Phase 8.7 —
 * SHORT signals surface via the scanner, benchmark, and diagnostics; live
 * execution wiring for short entries is a separate, later phase.
 */

import {
  computeEMA, computeRSI, computeATR, computeVolumeAvg,
} from "../strategyService";
import type { StrategySignal, GenerateSignalInput } from "../strategyService";

export const ENGINE_NAME = "ActiveSwingStrategy";

export const STRATEGY_METADATA = {
  timeframe:              "4h",
  expectedTradesPerWeek:  5,       // 15–25/month ≈ 4–6/week
  riskLevel:              "medium",
} as const;

// ─── Parameters (Phase 8.5) ───────────────────────────────────────────────────

const EMA_TREND_FAST  = 50;   // 4h trend filter fast EMA
const EMA_TREND_SLOW  = 200;  // 4h trend filter slow EMA
const EMA_ENTRY_FAST  = 20;   // entry EMA (short-term momentum)
const EMA_ENTRY_SLOW  = 50;   // entry EMA (medium-term support)
const MIN_CANDLES     = EMA_TREND_SLOW + 2;

const RSI_BUY_LO   = 30;   // was 35 — widened for more entries
const RSI_BUY_HI   = 70;   // was 65 — widened for more entries

const VOL_MIN_RATIO = 0.5;       // was 0.8 — lower barrier
const ATR_MIN_PCT   = 0.0015;    // 0.15% — was 0.2%
const ATR_MAX_PCT   = 0.020;     // 2.0%  — was 1.8%
const PULLBACK_ATRS = 1.0;       // price within 1 ATR of EMA20 or EMA50

const SL_PCT = 0.012;            // 1.2%
const TP_PCT = 0.020;            // 2.0%  (R:R = 1.67)

const DAILY_CAP          = 2;
const MONTHLY_CAP        = 25;    // was 30; target 15–25
const SYMBOL_MONTHLY_CAP = 8;     // was 10

export const APPROVED_SYMBOLS = [
  "BTC_USDT", "ETH_USDT", "SOL_USDT", "BNB_USDT", "XRP_USDT",
  "ADA_USDT", "AVAX_USDT", "DOGE_USDT", "LINK_USDT", "SUI_USDT",
];

export const STRATEGY_PARAMS = {
  rsiBuyMin:        RSI_BUY_LO,
  rsiBuyMax:        RSI_BUY_HI,
  minVolumeRatio:   VOL_MIN_RATIO,
  atrMinPct:        ATR_MIN_PCT,
  atrMaxPct:        ATR_MAX_PCT,
  stopLossPct:      SL_PCT,
  takeProfitPct:    TP_PCT,
  dailyCap:         DAILY_CAP,
  monthlyCap:       MONTHLY_CAP,
  symbolMonthlyCap: SYMBOL_MONTHLY_CAP,
  minConditions:    3,
  approvedSymbols:  APPROVED_SYMBOLS,
  targetMin:        15,
  targetMax:        25,
  phase:            "8.5",
} as const;

// ─── In-memory trade counters ──────────────────────────────────────────────────

function monthKey(): string {
  return new Date().toISOString().slice(0, 7); // "2026-06"
}

interface MonthlyCounters {
  month:    string;
  total:    number;
  byDay:    Record<string, number>;
  bySymbol: Record<string, number>;
}

let counters: MonthlyCounters = { month: monthKey(), total: 0, byDay: {}, bySymbol: {} };

function ensureFreshCounters(): void {
  const current = monthKey();
  if (counters.month !== current) {
    counters = { month: current, total: 0, byDay: {}, bySymbol: {} };
  }
}

export function recordTrade(symbol: string): void {
  ensureFreshCounters();
  const day = new Date().toISOString().slice(0, 10);
  counters.total++;
  counters.byDay[day] = (counters.byDay[day] ?? 0) + 1;
  counters.bySymbol[symbol] = (counters.bySymbol[symbol] ?? 0) + 1;
}

export function getTradeCounters(): Readonly<MonthlyCounters> {
  ensureFreshCounters();
  return { ...counters };
}

export function getMonthlyProjection(): number {
  ensureFreshCounters();
  const now        = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (dayOfMonth === 0) return 0;
  return Math.round((counters.total / dayOfMonth) * daysInMonth);
}

// ─── Condition names (shared LONG/SHORT diagnostics vocabulary) ───────────────
// Requirement: HOLD diagnostics must report these five named gates.
const CONDITION_LABELS = ["trend", "RSI", "volume", "ATR", "crossover"] as const;
type ConditionKey = typeof CONDITION_LABELS[number];

// ─── Signal helpers ────────────────────────────────────────────────────────────

function hold(
  ema50: number | null, ema200: number | null,
  rsi: number | null, atr: number | null,
  currentVol: number | null, avgVol: number | null,
  canTrade: boolean, reason: string,
  mode: "LONG" | "SHORT" | null = null,
  conditionsMet: number | null = null,
  conditionsTotal: number | null = null,
  missingConditions: string[] | null = null,
): StrategySignal {
  return {
    action: "HOLD", confidence: 0,
    ema50, ema200, rsi, atr, currentVol, avgVol,
    suggestedSl: null, suggestedTp: null,
    stopLossPct: null, takeProfitPct: null,
    canTrade, blockReason: canTrade ? null : reason,
    conditions: null, reason,
    mode, conditionsMet, conditionsTotal, missingConditions,
  };
}

/** Evaluate the 5 named gates for a given direction. */
function evaluateConditions(
  direction: "LONG" | "SHORT",
  ema20: number, ema50e: number, rsi: number, atrPct: number,
  currentVol: number | null, avgVol: number | null,
  price: number, atr: number,
): Record<ConditionKey, boolean> {
  const trendOk = direction === "LONG" ? ema20 > ema50e : ema20 < ema50e;
  return {
    trend:     trendOk,
    RSI:       rsi >= RSI_BUY_LO && rsi <= RSI_BUY_HI,
    volume:    currentVol != null && avgVol != null && avgVol > 0
                 && currentVol >= avgVol * VOL_MIN_RATIO,
    ATR:       atrPct >= ATR_MIN_PCT && atrPct <= ATR_MAX_PCT,
    crossover: Math.abs(price - ema20)  <= PULLBACK_ATRS * atr
            || Math.abs(price - ema50e) <= PULLBACK_ATRS * atr,
  };
}

// ─── Main signal generator ────────────────────────────────────────────────────

export function generateSignal(input: GenerateSignalInput): StrategySignal {
  const { candles, currentPrice, dailyTradeCount } = input;

  ensureFreshCounters();

  // ── Frequency gates ──────────────────────────────────────────────────────
  if (dailyTradeCount >= DAILY_CAP)
    return hold(null, null, null, null, null, null, false,
      `ActiveSwing daily cap (${dailyTradeCount}/${DAILY_CAP})`);

  if (counters.total >= MONTHLY_CAP)
    return hold(null, null, null, null, null, null, false,
      `ActiveSwing monthly cap reached (${counters.total}/${MONTHLY_CAP})`);

  if (candles.length < MIN_CANDLES)
    return hold(null, null, null, null, null, null, true,
      `ActiveSwing: need ${MIN_CANDLES} candles (have ${candles.length})`);

  // ── Indicators ───────────────────────────────────────────────────────────
  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const last    = closes.length - 1;

  const ema50Arr  = computeEMA(closes, EMA_TREND_FAST);
  const ema200Arr = computeEMA(closes, EMA_TREND_SLOW);
  const ema20Arr  = computeEMA(closes, EMA_ENTRY_FAST);
  const ema50eArr = computeEMA(closes, EMA_ENTRY_SLOW);

  const ema50  = ema50Arr[last]  ?? null;
  const ema200 = ema200Arr[last] ?? null;
  const ema20  = ema20Arr[last]  ?? null;
  const ema50e = ema50eArr[last] ?? null;

  const rsi        = computeRSI(closes);
  const atr        = computeATR(highs, lows, closes);
  const currentVol = volumes[last] ?? null;
  const avgVol     = computeVolumeAvg(volumes.slice(-21, -1));

  const price = currentPrice > 0 ? currentPrice : (closes[last] ?? 0);

  if (ema50 == null || ema200 == null || ema20 == null || ema50e == null || rsi == null || atr == null) {
    return hold(ema50, ema200, rsi, atr, currentVol, avgVol, true,
      "ActiveSwing: insufficient indicator data");
  }

  // ── 4h Trend filter — DUAL MODE (Phase 8.7) ──────────────────────────────
  // EMA50 > EMA200 → LONG mode (evaluate BUY entries)
  // EMA50 < EMA200 → SHORT mode (evaluate SHORT entries)
  // EMA50 == EMA200 (rare/flat) → default to LONG mode, will simply HOLD.
  const mode: "LONG" | "SHORT" = ema50 < ema200 ? "SHORT" : "LONG";

  // ── Entry conditions (min 3/5, mirrored for LONG/SHORT) ──────────────────
  const atrPct = atr / price;
  const c = evaluateConditions(mode, ema20, ema50e, rsi, atrPct, currentVol, avgVol, price, atr);

  const metCount    = Object.values(c).filter(Boolean).length;
  const minRequired = 3;   // Phase 8.5: relaxed from 4 (applies to both directions)
  const missing     = CONDITION_LABELS.filter(k => !c[k]);

  const volLabel = currentVol != null && avgVol != null && avgVol > 0
    ? `${(currentVol / avgVol).toFixed(2)}×` : "?";

  if (metCount >= minRequired) {
    const confidence = Math.round((metCount / 5) * 100);
    const metList     = CONDITION_LABELS.filter(k => c[k]).join(", ");

    if (mode === "LONG") {
      const suggestedSl = price * (1 - SL_PCT);
      const suggestedTp = price * (1 + TP_PCT);
      return {
        action: "BUY", confidence,
        ema50, ema200, rsi, atr, currentVol, avgVol,
        suggestedSl, suggestedTp,
        stopLossPct:   SL_PCT,
        takeProfitPct: TP_PCT,
        canTrade: true, blockReason: null, conditions: null,
        reason: `ACTIVE-SWING BUY: ${metCount}/5 [${metList}] — 4h BULL EMA50>${ema200.toFixed(0)}, RSI=${rsi.toFixed(1)}, vol=${volLabel}`,
        mode, conditionsMet: metCount, conditionsTotal: 5, missingConditions: missing.length ? missing : null,
      };
    }

    // SHORT entry — same confidence system, same risk engine, same position
    // sizing (bot.ts computes size from stopLossPct regardless of direction).
    // TP is below entry, SL is above entry (mirror of the LONG case).
    const suggestedSl = price * (1 + SL_PCT);
    const suggestedTp = price * (1 - TP_PCT);
    return {
      action: "SHORT", confidence,
      ema50, ema200, rsi, atr, currentVol, avgVol,
      suggestedSl, suggestedTp,
      stopLossPct:   SL_PCT,
      takeProfitPct: TP_PCT,
      canTrade: true, blockReason: null, conditions: null,
      reason: `ACTIVE-SWING SHORT: ${metCount}/5 [${metList}] — 4h BEAR EMA50<${ema200.toFixed(0)}, RSI=${rsi.toFixed(1)}, vol=${volLabel}`,
      mode, conditionsMet: metCount, conditionsTotal: 5, missingConditions: missing.length ? missing : null,
    };
  }

  const dirLabel = mode === "LONG" ? "BULL" : "BEAR";
  return hold(ema50, ema200, rsi, atr, currentVol, avgVol, true,
    `ACTIVE-SWING HOLD [${mode} mode, ${dirLabel} trend]: ${metCount}/5 (need ${minRequired}) — ` +
    `Conditions Met: ${metCount}/5 — Missing: ${missing.length ? missing.join(", ") : "none"} — ` +
    `EMA20${c.trend ? (mode === "LONG" ? ">" : "<") : (mode === "LONG" ? "<" : ">")}EMA50, RSI=${rsi.toFixed(1)} [${RSI_BUY_LO}–${RSI_BUY_HI}], ` +
    `vol=${volLabel}(≥${VOL_MIN_RATIO}×), ` +
    `ATR=${(atrPct * 100).toFixed(2)}% [${(ATR_MIN_PCT * 100).toFixed(2)}–${(ATR_MAX_PCT * 100).toFixed(1)}%], ` +
    `crossover=${c.crossover ? "✓" : "✗"}`,
    mode, metCount, 5, missing);
}
