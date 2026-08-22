/**
 * GridStrategy — ATR-defined price grid around EMA21 midpoint.
 *
 * Logic:
 *   Compute midpoint = EMA21, grid size = 1.5 × ATR.
 *   BUY  when price < midpoint - 0.5 × gridSize (below lower grid band).
 *   SELL when price > midpoint + 0.5 × gridSize (above upper grid band).
 *   Volume confirmation required for both directions.
 *
 * SL = 1.0 × ATR   TP = 1.0 × gridSize (mean-reversion to midpoint)
 * Min candles: 23   Daily trade cap: 15 (grid is high-frequency)
 */

import {
  computeEMA, computeRSI, computeATR, computeVolumeAvg,
} from "../strategyService";
import type { StrategySignal, GenerateSignalInput } from "../strategyService";

export const ENGINE_NAME = "GridStrategy";

const EMA_MID     = 21;
const MIN_CANDLES = EMA_MID + 2;
const DAILY_CAP   = 15;

const GRID_ATR_MULT = 1.5;   // grid spacing = 1.5 × ATR
const BAND_OFFSET   = 0.5;   // enter at mid ± 0.5 × gridSize
const SL_ATR_MULT   = 1.0;
const ATR_MIN_PCT   = 0.0003;

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
    return hold(null, null, null, null, null, null, false, `Grid daily cap (${dailyTradeCount}/${DAILY_CAP})`);
  if (candles.length < MIN_CANDLES)
    return hold(null, null, null, null, null, null, true, `Need ${MIN_CANDLES} candles (have ${candles.length})`);

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const last    = closes.length - 1;

  const ema21Arr = computeEMA(closes, EMA_MID);
  const midpoint = ema21Arr[last] ?? null;

  const rsi        = computeRSI(closes);
  const atr        = computeATR(highs, lows, closes);
  const currentVol = volumes[last] ?? null;
  const avgVol     = computeVolumeAvg(volumes.slice(0, -1));

  const price = currentPrice > 0 ? currentPrice : (closes[last] ?? 0);

  if (midpoint == null || atr == null) {
    return hold(midpoint, null, rsi, atr, currentVol, avgVol, true, "Grid: insufficient indicator data");
  }

  const atrOk    = price > 0 && (atr / price) >= ATR_MIN_PCT;
  const volOk    = currentVol != null && avgVol != null && currentVol > avgVol;
  const gridSize = GRID_ATR_MULT * atr;
  const lowerBand = midpoint - BAND_OFFSET * gridSize;
  const upperBand = midpoint + BAND_OFFSET * gridSize;

  const tpToMid = Math.abs(midpoint - price);
  const takeProfitPct = tpToMid / price;
  const stopLossPct   = (SL_ATR_MULT * atr) / price;
  const suggestedSl   = price - SL_ATR_MULT * atr;
  const suggestedTp   = midpoint;  // target: revert to midpoint

  // ── BUY at lower grid ────────────────────────────────────────────────────
  if (price < lowerBand && atrOk) {
    const distBelow = (lowerBand - price) / gridSize;
    const confidence = Math.min(Math.round(distBelow * 100 + (volOk ? 20 : 0)), 95);
    return {
      action: "BUY", confidence,
      ema50: midpoint, ema200: null, rsi, atr, currentVol, avgVol,
      suggestedSl, suggestedTp, stopLossPct, takeProfitPct,
      canTrade: true, blockReason: null, conditions: null,
      reason: `GRID BUY: price(${price.toFixed(2)}) < lower(${lowerBand.toFixed(2)}), mid=${midpoint.toFixed(2)}, grid=${gridSize.toFixed(2)}`,
    };
  }

  // ── SELL at upper grid ───────────────────────────────────────────────────
  if (price > upperBand && atrOk) {
    const distAbove = (price - upperBand) / gridSize;
    const confidence = Math.min(Math.round(distAbove * 100 + (volOk ? 20 : 0)), 95);
    return {
      action: "SELL", confidence,
      ema50: midpoint, ema200: null, rsi, atr, currentVol, avgVol,
      suggestedSl: null, suggestedTp: null, stopLossPct: null, takeProfitPct: null,
      canTrade: true, blockReason: null, conditions: null,
      reason: `GRID SELL: price(${price.toFixed(2)}) > upper(${upperBand.toFixed(2)}), mid=${midpoint.toFixed(2)}`,
    };
  }

  return hold(midpoint, null, rsi, atr, currentVol, avgVol, true,
    `GRID HOLD: price(${price.toFixed(2)}) inside [${lowerBand.toFixed(2)}–${upperBand.toFixed(2)}], mid=${midpoint.toFixed(2)}`);
}
