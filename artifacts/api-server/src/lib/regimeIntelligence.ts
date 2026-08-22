/**
 * regimeIntelligence.ts — Phase 8.0 Enhanced Market Regime Intelligence
 *
 * Extends the existing regime detection with:
 *   - ADX (trend strength)
 *   - Bollinger Band Width (volatility)
 *   - ATR Expansion / Compression ratio
 *   - Trend Strength Score
 *
 * Classifies: Strong Trend | Weak Trend | Range | Breakout |
 *             Volatility Expansion | Volatility Compression
 *
 * Outputs strategy weight multipliers for all 5 strategies.
 *
 * PURE ADVISORY — no execution side effects.
 */

import { logger }          from "./logger";
import { validateCandles } from "./atrValidator";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EnhancedRegime =
  | "strong_trend"
  | "weak_trend"
  | "range"
  | "breakout"
  | "volatility_expansion"
  | "volatility_compression"
  | "unknown";

export interface RegimeIndicators {
  adx:               number;    // 0-100, >25 = trending
  adxDi14Plus:       number;    // +DI (bullish directional)
  adxDi14Minus:      number;    // -DI (bearish directional)
  bollingerWidth:    number;    // (upper - lower) / middle  as %
  atrCurrent:        number;
  atrAverage:        number;
  atrRatio:          number;    // current / average
  trendStrengthScore: number;   // 0-100 composite
  rsi:               number;
  ema50:             number;
  ema200:            number;
  priceAboveEma200:  boolean;
}

export interface EnhancedRegimeResult {
  regime:           EnhancedRegime;
  confidence:       number;     // 0-100
  indicators:       RegimeIndicators;
  description:      string;
  strategyWeights:  Record<string, number>; // strategyId → multiplier 0-2
  tradingBias:      "bullish" | "bearish" | "neutral";
  computedAt:       string;
}

// ─── Indicator calculations from candle arrays ─────────────────────────────────

type Candle = { high: number; low: number; close: number };

function sma(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function computeATR(candles: Candle[], period = 14): { current: number; average: number; ratio: number } {
  if (candles.length < 2) return { current: 0, average: 0, ratio: 1 };
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i]!.high;
    const l = candles[i]!.low;
    const pc = candles[i - 1]!.close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const recent = trs.slice(-period);
  const older  = trs.slice(-period * 3, -period);
  const current = recent.length > 0 ? recent.reduce((s, v) => s + v, 0) / recent.length : 0;
  const average = older.length  > 0 ? older.reduce((s, v) => s + v, 0) / older.length   : current;
  return { current, average, ratio: average > 0 ? current / average : 1 };
}

function computeADX(candles: Candle[], period = 14): { adx: number; diPlus: number; diMinus: number } {
  if (candles.length < period * 2) return { adx: 0, diPlus: 0, diMinus: 0 };

  const dmPlus:  number[] = [];
  const dmMinus: number[] = [];
  const trs:     number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const c  = candles[i]!;
    const p  = candles[i - 1]!;
    const upMove   = c.high - p.high;
    const downMove = p.low  - c.low;
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }

  const smoothDmPlus  = sma(dmPlus,  period) * period;
  const smoothDmMinus = sma(dmMinus, period) * period;
  const smoothTr      = sma(trs,     period) * period;

  const diPlus  = smoothTr > 0 ? (smoothDmPlus  / smoothTr) * 100 : 0;
  const diMinus = smoothTr > 0 ? (smoothDmMinus / smoothTr) * 100 : 0;
  const dx      = (diPlus + diMinus) > 0 ? Math.abs(diPlus - diMinus) / (diPlus + diMinus) * 100 : 0;

  return { adx: Math.round(dx * 10) / 10, diPlus: Math.round(diPlus * 10) / 10, diMinus: Math.round(diMinus * 10) / 10 };
}

function computeBollingerWidth(candles: Candle[], period = 20, stdMult = 2): number {
  if (candles.length < period) return 0;
  const closes = candles.slice(-period).map((c) => c.close);
  const mid    = closes.reduce((s, v) => s + v, 0) / period;
  const std    = Math.sqrt(closes.reduce((s, v) => s + (v - mid) ** 2, 0) / period);
  const upper  = mid + stdMult * std;
  const lower  = mid - stdMult * std;
  return mid > 0 ? ((upper - lower) / mid) * 100 : 0;
}

function computeTrendStrength(adx: number, volRatio: number, ema50: number, ema200: number, rsi: number): number {
  let score = 0;
  // ADX contribution (0-40 pts)
  score += Math.min(40, adx * 1.6);
  // EMA alignment (0-20 pts)
  const emaGapPct = ema200 > 0 ? Math.abs((ema50 - ema200) / ema200) * 100 : 0;
  score += Math.min(20, emaGapPct * 4);
  // ATR contribution (0-20 pts) — moderate volatility is good for trends
  score += volRatio > 0.8 && volRatio < 2 ? 20 : volRatio >= 2 ? 10 : 5;
  // RSI trend confirmation (0-20 pts)
  const rsiBias = Math.abs(rsi - 50);
  score += Math.min(20, rsiBias * 0.6);
  return Math.round(Math.min(100, score));
}

// ─── Classify enhanced regime ─────────────────────────────────────────────────

function classifyRegime(ind: RegimeIndicators): { regime: EnhancedRegime; confidence: number; description: string } {
  const { adx, bollingerWidth, atrRatio, trendStrengthScore } = ind;

  if (atrRatio > 1.8 && bollingerWidth > 8) {
    return { regime: "breakout", confidence: 85, description: "ATR expansion + wide Bollinger Bands — breakout in progress" };
  }
  if (atrRatio > 1.4 && bollingerWidth > 6) {
    return { regime: "volatility_expansion", confidence: 75, description: "ATR expanding, Bollinger Bands widening — increasing volatility" };
  }
  if (atrRatio < 0.7 && bollingerWidth < 3) {
    return { regime: "volatility_compression", confidence: 80, description: "ATR compressed, Bollinger Bands tight — consolidation, breakout imminent" };
  }
  if (adx > 35 && trendStrengthScore > 65) {
    return { regime: "strong_trend", confidence: 90, description: `ADX=${adx.toFixed(0)} confirms strong directional trend` };
  }
  if (adx > 20 && trendStrengthScore > 40) {
    return { regime: "weak_trend", confidence: 70, description: `ADX=${adx.toFixed(0)} shows mild trend — insufficient for strong conviction` };
  }
  return { regime: "range", confidence: 65, description: `ADX=${adx.toFixed(0)} below trend threshold — range-bound price action` };
}

function computeStrategyWeights(regime: EnhancedRegime, tradingBias: string): Record<string, number> {
  const weights: Record<string, number> = {
    "scalping":    1.0,
    "day-trading": 1.0,
    "swing":       1.0,
    "dca":         1.0,
    "grid":        1.0,
  };

  switch (regime) {
    case "strong_trend":
      weights["swing"]       = 1.8;
      weights["day-trading"] = 1.5;
      weights["scalping"]    = 0.5;
      weights["dca"]         = 0.4;
      weights["grid"]        = 0.3;
      break;
    case "weak_trend":
      weights["swing"]       = 1.3;
      weights["day-trading"] = 1.2;
      weights["scalping"]    = 0.8;
      break;
    case "range":
      weights["scalping"]    = 1.6;
      weights["dca"]         = 1.5;
      weights["grid"]        = 1.8;
      weights["swing"]       = 0.6;
      weights["day-trading"] = 0.7;
      break;
    case "breakout":
      weights["day-trading"] = 1.8;
      weights["swing"]       = 1.4;
      weights["scalping"]    = 0.5;
      weights["grid"]        = 0.2;
      break;
    case "volatility_expansion":
      weights["day-trading"] = 1.4;
      weights["swing"]       = 1.2;
      weights["scalping"]    = 0.4;
      weights["dca"]         = 0.5;
      weights["grid"]        = 0.3;
      break;
    case "volatility_compression":
      weights["scalping"]    = 0.5;
      weights["grid"]        = 1.4;
      weights["dca"]         = 1.6;
      weights["swing"]       = 0.8;
      weights["day-trading"] = 0.6;
      break;
  }

  return weights;
}

// ─── Service class ─────────────────────────────────────────────────────────────

class RegimeIntelligenceService {
  private lastResult: EnhancedRegimeResult | null = null;

  compute(candles: Candle[], extraSignal?: { rsi?: number; ema50?: number; ema200?: number }): EnhancedRegimeResult {
    // Phase 12.1: filter malformed candles before any ATR/ADX computation
    const { validCandles, invalidCount } = validateCandles(candles);
    if (invalidCount > 0) {
      logger.warn({ invalidCount, total: candles.length }, "[ATR RECOVERY] regimeIntelligence: filtered bad candles");
    }
    const safeCandles = validCandles.length >= 2 ? validCandles : candles;

    const { adx, diPlus, diMinus } = computeADX(safeCandles);
    const { current: atrCurrent, average: atrAverage, ratio: rawRatio } = computeATR(safeCandles);

    // Phase 12.1: clamp implausible ATR ratio (can occur with micro-cap data)
    const atrRatio = isFinite(rawRatio) && rawRatio > 0 && rawRatio < 50 ? rawRatio : 1;
    const bollingerWidth = computeBollingerWidth(candles);

    const rsi    = extraSignal?.rsi    ?? 50;
    const ema50  = extraSignal?.ema50  ?? 0;
    const ema200 = extraSignal?.ema200 ?? 0;

    const trendStrengthScore = computeTrendStrength(adx, atrRatio, ema50, ema200, rsi);
    const priceAboveEma200   = ema200 > 0 ? candles[candles.length - 1]!.close > ema200 : true;

    const indicators: RegimeIndicators = {
      adx, adxDi14Plus: diPlus, adxDi14Minus: diMinus,
      bollingerWidth: Math.round(bollingerWidth * 100) / 100,
      atrCurrent:     Math.round(atrCurrent * 1e6) / 1e6,
      atrAverage:     Math.round(atrAverage * 1e6) / 1e6,
      atrRatio:       Math.round(atrRatio * 100) / 100,
      trendStrengthScore,
      rsi, ema50, ema200, priceAboveEma200,
    };

    const { regime, confidence, description } = classifyRegime(indicators);
    const tradingBias: EnhancedRegimeResult["tradingBias"] =
      diPlus > diMinus && priceAboveEma200 ? "bullish" :
      diMinus > diPlus && !priceAboveEma200 ? "bearish" : "neutral";

    const result: EnhancedRegimeResult = {
      regime,
      confidence,
      indicators,
      description,
      strategyWeights: computeStrategyWeights(regime, tradingBias),
      tradingBias,
      computedAt: new Date().toISOString(),
    };

    this.lastResult = result;
    logger.info({ regime, confidence, adx, atrRatio: Math.round(atrRatio * 100) / 100 }, "RegimeIntelligence: computed");
    return result;
  }

  getLast(): EnhancedRegimeResult | null { return this.lastResult; }
}

export const regimeIntelligence = new RegimeIntelligenceService();
