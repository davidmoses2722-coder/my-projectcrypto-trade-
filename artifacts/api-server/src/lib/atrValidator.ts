/**
 * atrValidator.ts — Phase 12.1 ATR Validation & Volatility Safety
 *
 * Validates ATR calculations to prevent impossible values (e.g. ATR 393%).
 * Maintains a capped log ring buffer for [ATR], [ATR ERROR], [ATR RECOVERY]
 * entries that the /api/atr/health endpoint exposes to the dashboard.
 *
 * STRICT RULE: this file must NOT import from bot.ts, orchestrator, risk
 * engine, analytics engine, execution engine, or SSE infrastructure.
 */

import { logger } from "./logger";

// ─── Types ─────────────────────────────────────────────────────────────────

export type AtrHealth = "valid" | "warning" | "invalid";

export interface CandleOHLC {
  high:  number;
  low:   number;
  close: number;
  open?: number;
}

export interface AtrValidationResult {
  valid:   boolean;
  health:  AtrHealth;
  atr:     number;
  /** Decimal fraction — e.g. 0.03 = 3% */
  atrPct:  number;
  reason:  string | null;
}

export interface AtrLogEntry {
  ts:        string;
  tag:       "[ATR]" | "[ATR ERROR]" | "[ATR RECOVERY]";
  symbol:    string;
  timeframe: string;
  message:   string;
  price:     number;
  atr:       number;
  /** Percentage — e.g. 3.0 = 3% */
  atrPct:    number;
}

// ─── Log ring buffer ────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 200;
const _log: AtrLogEntry[] = [];

export function getAtrLogs(): AtrLogEntry[] {
  return _log.slice();
}

function push(entry: AtrLogEntry): void {
  _log.push(entry);
  if (_log.length > MAX_LOG_ENTRIES) _log.shift();
}

// ─── Current health snapshot (latest ATR per symbol) ───────────────────────

interface HealthSnapshot {
  health:    AtrHealth;
  atr:       number;
  atrPct:    number;
  price:     number;
  timeframe: string;
  ts:        string;
}
const _snapshots = new Map<string, HealthSnapshot>();

export function getAtrSnapshots(): Record<string, HealthSnapshot> {
  return Object.fromEntries(_snapshots.entries());
}

export function getOverallHealth(): AtrHealth {
  const entries = [..._snapshots.values()];
  if (entries.length === 0) return "valid";
  if (entries.some(e => e.health === "invalid"))  return "invalid";
  if (entries.some(e => e.health === "warning"))  return "warning";
  return "valid";
}

// ─── Candle validation ──────────────────────────────────────────────────────

export interface CandleValidationResult {
  validCount:    number;
  invalidCount:  number;
  validCandles:  CandleOHLC[];
  invalidReasons: string[];
}

export function validateCandles(candles: CandleOHLC[]): CandleValidationResult {
  const validCandles:    CandleOHLC[] = [];
  const invalidReasons:  string[]     = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const { high: h, low: l, close: cl } = c;

    if (!isFinite(h) || !isFinite(l) || !isFinite(cl)) {
      invalidReasons.push(`[${i}] NaN/Infinity  H=${h} L=${l} C=${cl}`);
      continue;
    }
    if (cl <= 0) {
      invalidReasons.push(`[${i}] Close=${cl} ≤ 0`);
      continue;
    }
    if (h < l) {
      invalidReasons.push(`[${i}] High=${h} < Low=${l}`);
      continue;
    }
    if (h < 0 || l < 0) {
      invalidReasons.push(`[${i}] negative H=${h} or L=${l}`);
      continue;
    }
    validCandles.push(c);
  }

  return {
    validCount:   validCandles.length,
    invalidCount: candles.length - validCandles.length,
    validCandles,
    invalidReasons,
  };
}

// ─── ATR result validation ──────────────────────────────────────────────────

/** ATR % thresholds */
const ATR_PCT_WARNING = 0.10;   // 10 % — flag as warning
const ATR_PCT_MAX     = 0.20;   // 20 % — hard reject

export function validateATR(
  atr:       number | null,
  price:     number,
  symbol:    string,
  timeframe: string,
  last5?:    CandleOHLC[],
): AtrValidationResult {
  const ts = new Date().toISOString();

  if (atr === null) {
    return { valid: false, health: "invalid", atr: 0, atrPct: 0, reason: "insufficient_data" };
  }

  // NaN / Infinity
  if (!isFinite(atr) || isNaN(atr)) {
    const msg = `ATR=${atr} — NaN or Infinity`;
    logger.warn({ symbol, timeframe, atr, price }, `[ATR ERROR] ${msg}`);
    push({ ts, tag: "[ATR ERROR]", symbol, timeframe, message: msg, price, atr: 0, atrPct: 0 });
    if (last5) dumpCandles(symbol, timeframe, price, atr, 0, last5);
    return { valid: false, health: "invalid", atr: 0, atrPct: 0, reason: msg };
  }

  // ATR ≤ 0
  if (atr <= 0) {
    const msg = `ATR=${atr.toFixed(8)} ≤ 0`;
    logger.warn({ symbol, timeframe, atr, price }, `[ATR ERROR] ${msg}`);
    push({ ts, tag: "[ATR ERROR]", symbol, timeframe, message: msg, price, atr, atrPct: 0 });
    return { valid: false, health: "invalid", atr: 0, atrPct: 0, reason: msg };
  }

  // ATR > current price (impossible on any liquid market)
  if (price > 0 && atr > price) {
    const atrPct = (atr / price) * 100;
    const msg = `ATR=${atr.toFixed(8)} > Price=${price.toFixed(8)} (${atrPct.toFixed(1)}%)`;
    logger.error({ symbol, timeframe, atr, price, atrPct }, `[ATR ERROR] ${msg}`);
    push({ ts, tag: "[ATR ERROR]", symbol, timeframe, message: msg, price, atr, atrPct });
    if (last5) dumpCandles(symbol, timeframe, price, atr, atrPct, last5);
    _snapshots.set(symbol, { health: "invalid", atr: 0, atrPct: 0, price, timeframe, ts });
    return { valid: false, health: "invalid", atr: 0, atrPct: 0, reason: msg };
  }

  const atrPctDecimal = price > 0 ? atr / price : 0;
  const atrPctDisplay = atrPctDecimal * 100;

  // ATR% > 20 % — implausible
  if (atrPctDecimal > ATR_PCT_MAX) {
    const msg = `ATR%=${atrPctDisplay.toFixed(2)}% > ${ATR_PCT_MAX * 100}% — implausible`;
    logger.error({ symbol, timeframe, atr, price, atrPct: atrPctDisplay }, `[ATR ERROR] ${msg}`);
    push({ ts, tag: "[ATR ERROR]", symbol, timeframe, message: msg, price, atr, atrPct: atrPctDisplay });
    if (last5) dumpCandles(symbol, timeframe, price, atr, atrPctDisplay, last5);
    _snapshots.set(symbol, { health: "invalid", atr: 0, atrPct: 0, price, timeframe, ts });
    return { valid: false, health: "invalid", atr: 0, atrPct: 0, reason: msg };
  }

  // Health classification
  const health: AtrHealth = atrPctDecimal > ATR_PCT_WARNING ? "warning" : "valid";

  const msg = `ATR=${atr.toFixed(8)} (${atrPctDisplay.toFixed(3)}%)`;
  logger.debug({ symbol, timeframe, atr, price, atrPct: atrPctDisplay }, `[ATR] ${msg}`);
  push({ ts, tag: "[ATR]", symbol, timeframe, message: msg, price, atr, atrPct: atrPctDisplay });
  _snapshots.set(symbol, { health, atr, atrPct: atrPctDecimal, price, timeframe, ts });

  return { valid: true, health, atr, atrPct: atrPctDecimal, reason: null };
}

function dumpCandles(
  symbol:    string,
  timeframe: string,
  price:     number,
  atr:       number,
  atrPct:    number,
  candles:   CandleOHLC[],
): void {
  const last5 = candles.slice(-5);
  const lines = last5.map((c, i) =>
    `  [${i}] H=${c.high} L=${c.low} C=${c.close}`
  ).join("\n");
  logger.error(
    `[ATR ERROR] candle dump — ${symbol} ${timeframe} ` +
    `price=${price} atr=${atr} atrPct=${atrPct.toFixed(2)}%\n${lines}`
  );
}

// ─── Validated ATR computation ──────────────────────────────────────────────

/**
 * Compute ATR(period) with full candle + result validation.
 * Filters bad candles first (recovery path); logs [ATR RECOVERY] if any
 * were removed. Returns an invalid result if usable candles < period+1.
 */
export function computeValidatedATR(
  candles:   CandleOHLC[],
  price:     number,
  period:    number,
  symbol:    string,
  timeframe: string,
): AtrValidationResult {
  // ── Step 1: validate + filter candles ──────────────────────────────────
  const { validCandles, invalidCount, invalidReasons } = validateCandles(candles);

  if (invalidCount > 0) {
    const ts  = new Date().toISOString();
    const msg = `Filtered ${invalidCount}/${candles.length} bad candles — ` +
                `${invalidReasons[0] ?? "unknown"}`;
    logger.warn({ symbol, timeframe, invalidCount }, `[ATR RECOVERY] ${msg}`);
    push({ ts, tag: "[ATR RECOVERY]", symbol, timeframe, message: msg, price, atr: 0, atrPct: 0 });
  }

  if (validCandles.length < period + 1) {
    const reason = `Only ${validCandles.length} valid candles (need ≥ ${period + 1})`;
    return { valid: false, health: "invalid", atr: 0, atrPct: 0, reason };
  }

  // ── Step 2: True Range ──────────────────────────────────────────────────
  const trs: number[] = [];
  for (let i = 1; i < validCandles.length; i++) {
    const { high: h, low: l } = validCandles[i]!;
    const pc = validCandles[i - 1]!.close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  // ── Step 3: Wilder's smoothing — SMA seed then EMA ─────────────────────
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]!) / period;
  }

  return validateATR(atr, price, symbol, timeframe, candles.slice(-5));
}

// ─── Convenience: health from a raw ATR% value ──────────────────────────────

/**
 * Classify ATR health from a raw value.
 * @param atrPct  Accepts either decimal (0.03 = 3%) or percentage (3.0 = 3%).
 *                Auto-detects: values > 1 are treated as already in % form.
 */
export function atrHealthFromPct(atrPct: number | null | undefined): AtrHealth {
  if (atrPct == null || !isFinite(atrPct) || atrPct <= 0) return "invalid";
  const pct = atrPct > 1 ? atrPct : atrPct * 100;
  if (pct > ATR_PCT_MAX  * 100) return "invalid";
  if (pct > ATR_PCT_WARNING * 100) return "warning";
  return "valid";
}
