/**
 * DcaStrategy — Interval accumulation / dollar-cost averaging.
 *
 * Logic:
 *   BUY  unconditionally when RSI < 40 (buying dips, no trend filter).
 *   SELL only when RSI > 72 (emergency take-profit) — DCA never forces holds.
 *   Ignores EMA trend direction on purpose (accumulation strategy).
 *
 * SL = 1.5 × ATR   TP = 3.0 × ATR
 * Min candles: 16   Daily trade cap: 20 (high-frequency accumulation)
 */

import {
  computeEMA, computeRSI, computeATR, computeVolumeAvg,
} from "../strategyService";
import type { StrategySignal, GenerateSignalInput } from "../strategyService";

export const ENGINE_NAME = "DcaStrategy";

const MIN_CANDLES = 16;
const DAILY_CAP   = 20;
const EMA_REF     = 14;   // short reference EMA for context only

const RSI_BUY_MAX  = 40;   // buy any dip below this
const RSI_SELL_MIN = 72;   // emergency sell above this

const SL_ATR_MULT = 1.5;
const TP_ATR_MULT = 3.0;

function hold(
  ema50: number | null, ema200: number | null,
  rsi: number | null, atr: number | null,
  currentVol: number | null, avgVol: number | null,
  canTrade: boolean, reason: string,
): StrategySignal {
  return {
    action: "HOLD", confidence: 0,
    ema50, ema200, rsi, atr, currentVol, avgVol,
    suggestedSl: null, suggestedTp: null,
    stopLossPct: null, takeProfitPct: null,
    canTrade, blockReason: canTrade ? null : reason,
    conditions: null, reason,
  };
}

export function generateSignal(input: GenerateSignalInput): StrategySignal {
  const { candles, currentPrice, dailyTradeCount } = input;

  if (dailyTradeCount >= DAILY_CAP)
    return hold(null, null, null, null, null, null, false, `DCA daily cap (${dailyTradeCount}/${DAILY_CAP})`);
  if (candles.length < MIN_CANDLES)
    return hold(null, null, null, null, null, null, true, `Need ${MIN_CANDLES} candles (have ${candles.length})`);

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const last    = closes.length - 1;

  const emaRefArr  = computeEMA(closes, EMA_REF);
  const emaRef     = emaRefArr[last] ?? null;

  const rsi        = computeRSI(closes);
  const atr        = computeATR(highs, lows, closes);
  const currentVol = volumes[last] ?? null;
  const avgVol     = computeVolumeAvg(volumes.slice(0, -1));

  const price = currentPrice > 0 ? currentPrice : (closes[last] ?? 0);

  let suggestedSl: number | null = null;
  let suggestedTp: number | null = null;
  let stopLossPct: number | null = null;
  let takeProfitPct: number | null = null;
  if (atr != null && price > 0) {
    suggestedSl   = price - SL_ATR_MULT * atr;
    suggestedTp   = price + TP_ATR_MULT * atr;
    stopLossPct   = (SL_ATR_MULT * atr) / price;
    takeProfitPct = (TP_ATR_MULT * atr) / price;
  }

  if (rsi == null) {
    return hold(emaRef, null, rsi, atr, currentVol, avgVol, true, "DCA: insufficient RSI data");
  }

  // ── BUY dip ───────────────────────────────────────────────────────────────
  if (rsi < RSI_BUY_MAX) {
    const dipStrength = Math.round(((RSI_BUY_MAX - rsi) / RSI_BUY_MAX) * 100);
    return {
      action: "BUY", confidence: Math.min(dipStrength, 95),
      ema50: emaRef, ema200: null, rsi, atr, currentVol, avgVol,
      suggestedSl, suggestedTp, stopLossPct, takeProfitPct,
      canTrade: true, blockReason: null, conditions: null,
      reason: `DCA BUY: RSI=${rsi.toFixed(1)} < ${RSI_BUY_MAX} — accumulating dip`,
    };
  }

  // ── SELL take-profit (emergency exit) ────────────────────────────────────
  if (rsi > RSI_SELL_MIN) {
    const overboughtStrength = Math.round(((rsi - RSI_SELL_MIN) / (100 - RSI_SELL_MIN)) * 100);
    return {
      action: "SELL", confidence: Math.min(overboughtStrength, 90),
      ema50: emaRef, ema200: null, rsi, atr, currentVol, avgVol,
      suggestedSl: null, suggestedTp: null, stopLossPct: null, takeProfitPct: null,
      canTrade: true, blockReason: null, conditions: null,
      reason: `DCA SELL: RSI=${rsi.toFixed(1)} > ${RSI_SELL_MIN} — taking profit`,
    };
  }

  return hold(emaRef, null, rsi, atr, currentVol, avgVol, true,
    `DCA HOLD: RSI=${rsi.toFixed(1)} — waiting for dip < ${RSI_BUY_MAX} or profit > ${RSI_SELL_MIN}`);
}
