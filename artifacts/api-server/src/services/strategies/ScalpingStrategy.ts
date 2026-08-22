/**
 * ScalpingStrategy — Fast EMA9/EMA21 crossover with tight ATR-based SL/TP.
 *
 * Logic:
 *   BUY  when EMA9 > EMA21 AND RSI 25–55 AND ATR > 0.05%
 *   SELL when EMA9 < EMA21 AND RSI 58–82 AND ATR > 0.05%
 *
 * RSI buy window widened to 25–55 (was 25–42) to catch more scalp entries
 * in trending crypto markets where RSI rarely drops below 42 on 1h charts.
 *
 * SL = 1.0 × ATR   TP = 1.5 × ATR   (fast scalp: tight, high frequency)
 * Min candles needed: 24   Daily trade cap: 10
 */

import {
  computeEMA, computeRSI, computeATR, computeVolumeAvg,
} from "../strategyService";
import type { StrategySignal, GenerateSignalInput } from "../strategyService";

export const ENGINE_NAME = "ScalpingStrategy";

const EMA_FAST    = 9;
const EMA_SLOW    = 21;
const MIN_CANDLES = EMA_SLOW + 3;
const DAILY_CAP   = 10;

const RSI_BUY_LO  = 25;
const RSI_BUY_HI  = 55;   // widened from 42 — catches more entries in trending markets
const RSI_SELL_LO = 58;   // tightened slightly to maintain sell precision
const RSI_SELL_HI = 82;

const SL_ATR_MULT = 1.0;
const TP_ATR_MULT = 1.5;
const ATR_MIN_PCT = 0.0005;

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
    return hold(null, null, null, null, null, null, false, `Scalping daily cap (${dailyTradeCount}/${DAILY_CAP})`);
  if (candles.length < MIN_CANDLES)
    return hold(null, null, null, null, null, null, true, `Need ${MIN_CANDLES} candles (have ${candles.length})`);

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const last    = closes.length - 1;
  const prev    = last - 1;

  const ema9Arr  = computeEMA(closes, EMA_FAST);
  const ema21Arr = computeEMA(closes, EMA_SLOW);
  const ema9     = ema9Arr[last]  ?? null;
  const ema21    = ema21Arr[last] ?? null;
  const ema9p    = ema9Arr[prev]  ?? null;
  const ema21p   = ema21Arr[prev] ?? null;

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

  if (ema9 == null || ema21 == null || rsi == null) {
    return hold(ema9, ema21, rsi, atr, currentVol, avgVol, true, "Scalping: insufficient indicator data");
  }

  const atrOk       = atr != null && price > 0 && (atr / price) >= ATR_MIN_PCT;
  const volOk       = currentVol != null && avgVol != null && currentVol > avgVol;
  const crossedUp   = ema9p != null && ema21p != null && ema9p <= ema21p && ema9 > ema21;
  const crossedDown = ema9p != null && ema21p != null && ema9p >= ema21p && ema9 < ema21;
  const trendUp     = ema9 > ema21;
  const trendDown   = ema9 < ema21;

  // ── BUY ──────────────────────────────────────────────────────────────────
  if ((crossedUp || trendUp) && rsi >= RSI_BUY_LO && rsi <= RSI_BUY_HI && atrOk) {
    const metCount = [trendUp, crossedUp, rsi >= RSI_BUY_LO && rsi <= RSI_BUY_HI, volOk, atrOk].filter(Boolean).length;
    return {
      action: "BUY", confidence: Math.round((metCount / 5) * 100),
      ema50: ema9, ema200: ema21, rsi, atr, currentVol, avgVol,
      suggestedSl, suggestedTp, stopLossPct, takeProfitPct,
      canTrade: true, blockReason: null, conditions: null,
      reason: `SCALP BUY: EMA9(${ema9.toFixed(2)})>EMA21(${ema21.toFixed(2)}), RSI=${rsi.toFixed(1)}, ATR=${atr?.toFixed(2)}`,
    };
  }

  // ── SELL ─────────────────────────────────────────────────────────────────
  if ((crossedDown || trendDown) && rsi >= RSI_SELL_LO && rsi <= RSI_SELL_HI && atrOk) {
    const metCount = [trendDown, crossedDown, rsi >= RSI_SELL_LO && rsi <= RSI_SELL_HI, atrOk].filter(Boolean).length;
    return {
      action: "SELL", confidence: Math.round((metCount / 4) * 100),
      ema50: ema9, ema200: ema21, rsi, atr, currentVol, avgVol,
      suggestedSl: null, suggestedTp: null, stopLossPct: null, takeProfitPct: null,
      canTrade: true, blockReason: null, conditions: null,
      reason: `SCALP SELL: EMA9(${ema9.toFixed(2)})<EMA21(${ema21.toFixed(2)}), RSI=${rsi.toFixed(1)}`,
    };
  }

  return hold(ema9, ema21, rsi, atr, currentVol, avgVol, true,
    `SCALP HOLD: EMA9${trendUp ? ">" : "<"}EMA21, RSI=${rsi.toFixed(1)} (buy ${RSI_BUY_LO}–${RSI_BUY_HI}, sell ${RSI_SELL_LO}–${RSI_SELL_HI})`);
}
