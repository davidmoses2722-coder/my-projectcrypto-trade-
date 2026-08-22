/**
 * DayTradingStrategy — EMA20/EMA50 trend with intraday momentum filter.
 *
 * Logic:
 *   BUY  when EMA20 > EMA50 AND price > EMA20 AND RSI 38–55 AND vol spike AND ATR > 0.08%
 *   SELL when EMA20 < EMA50 AND price < EMA20 AND RSI 60–75 AND ATR > 0.08%
 *
 * SL = 1.5 × ATR   TP = 2.5 × ATR
 * Min candles: 53   Daily trade cap: 6
 */

import {
  computeEMA, computeRSI, computeATR, computeVolumeAvg,
} from "../strategyService";
import type { StrategySignal, GenerateSignalInput } from "../strategyService";

export const ENGINE_NAME = "DayTradingStrategy";

const EMA_FAST    = 20;
const EMA_SLOW    = 50;
const MIN_CANDLES = EMA_SLOW + 3;
const DAILY_CAP   = 6;

const RSI_BUY_LO  = 38;
const RSI_BUY_HI  = 55;
const RSI_SELL_LO = 60;
const RSI_SELL_HI = 75;

const SL_ATR_MULT = 1.5;
const TP_ATR_MULT = 2.5;
const ATR_MIN_PCT = 0.0008;

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
    return hold(null, null, null, null, null, null, false, `Day-trading daily cap (${dailyTradeCount}/${DAILY_CAP})`);
  if (candles.length < MIN_CANDLES)
    return hold(null, null, null, null, null, null, true, `Need ${MIN_CANDLES} candles (have ${candles.length})`);

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const last    = closes.length - 1;
  const prev    = last - 1;

  const ema20Arr = computeEMA(closes, EMA_FAST);
  const ema50Arr = computeEMA(closes, EMA_SLOW);
  const ema20    = ema20Arr[last]  ?? null;
  const ema50    = ema50Arr[last]  ?? null;
  const ema20p   = ema20Arr[prev]  ?? null;
  const ema50p   = ema50Arr[prev]  ?? null;

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

  if (ema20 == null || ema50 == null || rsi == null) {
    return hold(ema20, ema50, rsi, atr, currentVol, avgVol, true, "DayTrading: insufficient indicator data");
  }

  const atrOk   = atr != null && price > 0 && (atr / price) >= ATR_MIN_PCT;
  const volOk   = currentVol != null && avgVol != null && currentVol > avgVol;
  const gapWide = ema20p != null && ema50p != null &&
    Math.abs(ema20 - ema50) > Math.abs(ema20p - ema50p);

  // ── BUY ──────────────────────────────────────────────────────────────────
  const buyConditions = {
    trendUp:    ema20 > ema50,
    gapWide,
    priceAbove: price > ema20,
    rsiInRange: rsi >= RSI_BUY_LO && rsi <= RSI_BUY_HI,
    volOk,
    atrOk,
  };
  if (Object.values(buyConditions).every(Boolean)) {
    const met = Object.values(buyConditions).filter(Boolean).length;
    return {
      action: "BUY", confidence: Math.round((met / Object.keys(buyConditions).length) * 100),
      ema50: ema20, ema200: ema50, rsi, atr, currentVol, avgVol,
      suggestedSl, suggestedTp, stopLossPct, takeProfitPct,
      canTrade: true, blockReason: null, conditions: null,
      reason: `DAYTRADING BUY: EMA20(${ema20.toFixed(2)})>EMA50(${ema50.toFixed(2)}), RSI=${rsi.toFixed(1)}, vol↑`,
    };
  }

  // ── SELL ─────────────────────────────────────────────────────────────────
  const sellConditions = {
    trendDown:  ema20 < ema50,
    priceBelow: price < ema20,
    rsiInRange: rsi >= RSI_SELL_LO && rsi <= RSI_SELL_HI,
    atrOk,
  };
  if (Object.values(sellConditions).every(Boolean)) {
    const met = Object.values(sellConditions).filter(Boolean).length;
    return {
      action: "SELL", confidence: Math.round((met / Object.keys(sellConditions).length) * 100),
      ema50: ema20, ema200: ema50, rsi, atr, currentVol, avgVol,
      suggestedSl: null, suggestedTp: null, stopLossPct: null, takeProfitPct: null,
      canTrade: true, blockReason: null, conditions: null,
      reason: `DAYTRADING SELL: EMA20(${ema20.toFixed(2)})<EMA50(${ema50.toFixed(2)}), RSI=${rsi.toFixed(1)}`,
    };
  }

  const met = Object.values(buyConditions).filter(Boolean).length;
  return hold(ema20, ema50, rsi, atr, currentVol, avgVol, true,
    `DAYTRADING HOLD: ${met}/${Object.keys(buyConditions).length} buy conditions — EMA20${ema20 > ema50 ? ">" : "<"}EMA50, RSI=${rsi.toFixed(1)}`);
}
