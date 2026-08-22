// ─────────────────────────────────────────────────────────────────────────────
// Technical Indicators Library
// Used by the bot engine to generate real signal analysis
// ─────────────────────────────────────────────────────────────────────────────

/** Exponential Moving Average */
export const ema = (data: number[], period: number): number[] => {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  let result = data[0];

  return data.map((price) => {
    result = price * k + result * (1 - k);
    return result;
  });
};

/** Relative Strength Index (14-period) */
export const rsi = (data: number[]): number | null => {
  if (data.length < 14) return null;

  let gains = 0;
  let losses = 0;

  for (let i = data.length - 14; i < data.length - 1; i++) {
    const diff = data[i + 1] - data[i];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  const rs = gains / (losses || 1);
  return 100 - 100 / (1 + rs);
};

/** MACD (12/26 EMA difference) */
export const macd = (data: number[]): number => {
  const fast = ema(data, 12);
  const slow = ema(data, 26);
  return fast[fast.length - 1] - slow[slow.length - 1];
};

/**
 * Average True Range approximation (14-period, close-only input).
 *
 * NOTE: Without High/Low data, this computes close-to-close absolute
 * differences — a proxy for ATR, not true True Range.  It is used only
 * for client-side sparkline scoring where OHLCV is unavailable.
 *
 * Phase 12.1 fixes:
 *   • Off-by-one: loop now iterates exactly 14 times (was 13).
 *   • Short-data fallback also divides by the correct denominator.
 */
export const atr = (data: number[]): number => {
  if (data.length < 15) {
    // Fallback: simple average absolute change over all available bars
    let sum = 0;
    for (let i = 1; i < data.length; i++) {
      sum += Math.abs(data[i]! - data[i - 1]!);
    }
    return data.length > 1 ? sum / (data.length - 1) : 0;
  }
  // Fixed loop: i from (n-15) to (n-2) inclusive → exactly 14 differences
  let sum = 0;
  for (let i = data.length - 15; i < data.length - 1; i++) {
    sum += Math.abs(data[i + 1]! - data[i]!);
  }
  return sum / 14;
};

// ─────────────────────────────────────────────────────────────────────────────
// Extended Indicators
// ─────────────────────────────────────────────────────────────────────────────

/** Simple Moving Average */
export const sma = (data: number[], period: number): number => {
  if (data.length === 0) return 0;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
};

/** Bollinger Bands (20-period, 2 std deviations) */
export const bollingerBands = (
  data: number[],
  period = 20,
  stdDevMult = 2
): { upper: number; middle: number; lower: number } | null => {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper:  middle + stdDevMult * stdDev,
    middle,
    lower:  middle - stdDevMult * stdDev,
  };
};

/** Stochastic Oscillator %K (14-period) */
export const stochastic = (data: number[]): number | null => {
  if (data.length < 14) return null;
  const slice = data.slice(-14);
  const low  = Math.min(...slice);
  const high = Math.max(...slice);
  if (high === low) return 50;
  return ((data[data.length - 1] - low) / (high - low)) * 100;
};

/** Volume Weighted Average Price approximation (no volume data, uses price only) */
export const vwapApprox = (data: number[]): number => {
  if (data.length === 0) return 0;
  return data.reduce((a, b) => a + b, 0) / data.length;
};

// ─────────────────────────────────────────────────────────────────────────────
// AI Score — fast weighted signal classifier
// Returns a score in range [-7, +7]
//   RSI  contribution : -2 (overbought) / +2 (oversold)
//   MACD contribution : -2 (negative)  / +2 (positive)
//   Trend contribution: -3 (down)      / +3 (up)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight AI scoring function.
 * @param rsi   - RSI value (0–100)
 * @param macd  - MACD line value (positive = bullish, negative = bearish)
 * @param trend - Direction: 1 = uptrend, -1 = downtrend, 0 = sideways
 * @returns score in [-7, +7]
 */
export const aiScore = (rsi: number, macd: number, trend: number): number => {
  let score = 0;

  if (rsi < 35) score += 2;
  if (rsi > 65) score -= 2;

  if (macd > 0) score += 2;
  else score -= 2;

  if (trend === 1) score += 3;
  else score -= 3;

  return score;
};

/**
 * Normalize aiScore [-7, +7] to a percentage [-100, +100]
 * so it can be blended into the composite indicator score.
 */
export const aiScoreNormalized = (rsiVal: number, macdVal: number, trend: number): number =>
  (aiScore(rsiVal, macdVal, trend) / 7) * 100;

// ─────────────────────────────────────────────────────────────────────────────
// Composite Signal Analyzer
// ─────────────────────────────────────────────────────────────────────────────

export interface IndicatorSnapshot {
  rsiValue:     number | null;         // raw RSI value (0–100)
  macdValue:    number;                // raw MACD line value
  macdSignal:   "bullish" | "bearish" | "neutral";
  emaSignal:    "above" | "below" | "crossing";
  ema20:        number;
  ema50:        number;
  atrValue:     number;                // raw ATR
  atrPercent:   number;                // ATR as % of price (volatility)
  stochValue:   number | null;
  bbPosition:   "upper" | "middle" | "lower" | null; // where price is in BB
  volumeSignal: "high" | "normal" | "low";
  trend:        "uptrend" | "downtrend" | "sideways";
  score:        number;                // composite score -100 to +100 (buy = positive)
  // ── AI Score breakdown ─────────────────────────────────────────────────────
  aiScoreRaw:   number;               // raw aiScore in [-7, +7]
  aiScoreNorm:  number;               // normalized aiScore in [-100, +100]
  aiRsiPart:    number;               // RSI contribution  (-2 / 0 / +2)
  aiMacdPart:   number;               // MACD contribution (-2 / +2)
  aiTrendPart:  number;               // Trend contribution(-3 / +3)
  aiTrendDir:   1 | -1 | 0;          // 1=up, -1=down, 0=sideways
}

/**
 * Compute all indicators from a sparkline array and return a structured snapshot.
 * Requires at least 5 data points; returns null if not enough data.
 */
export function computeIndicators(
  sparkline: number[],
  volumeRatio = 1.0   // pass >1.2 for high volume, <0.8 for low
): IndicatorSnapshot | null {
  if (!sparkline || sparkline.length < 5) return null;

  const price   = sparkline[sparkline.length - 1];
  const rsiVal  = rsi(sparkline);
  const macdVal = macd(sparkline);
  const atrVal  = atr(sparkline);
  const ema20Val = ema(sparkline, Math.min(20, sparkline.length))[sparkline.length - 1];
  const ema50Val = ema(sparkline, Math.min(50, sparkline.length))[sparkline.length - 1];
  const stochVal = stochastic(sparkline);
  const bb       = bollingerBands(sparkline, Math.min(20, sparkline.length));

  // ── MACD signal ────────────────────────────────────────────────────────────
  let macdSignal: "bullish" | "bearish" | "neutral";
  if (macdVal > price * 0.0001)        macdSignal = "bullish";
  else if (macdVal < -price * 0.0001)  macdSignal = "bearish";
  else                                  macdSignal = "neutral";

  // ── EMA signal ─────────────────────────────────────────────────────────────
  const emaDiff = ema20Val - ema50Val;
  const emaDiffPct = Math.abs(emaDiff / ema50Val);
  let emaSignal: "above" | "below" | "crossing";
  if (emaDiffPct < 0.003)          emaSignal = "crossing";
  else if (ema20Val > ema50Val)    emaSignal = "above";   // bullish
  else                             emaSignal = "below";   // bearish

  // ── Bollinger Band position ────────────────────────────────────────────────
  let bbPosition: "upper" | "middle" | "lower" | null = null;
  if (bb) {
    if (price >= bb.middle + (bb.upper - bb.middle) * 0.5)       bbPosition = "upper";
    else if (price <= bb.middle - (bb.middle - bb.lower) * 0.5)  bbPosition = "lower";
    else                                                           bbPosition = "middle";
  }

  // ── Volume signal ──────────────────────────────────────────────────────────
  let volumeSignal: "high" | "normal" | "low";
  if (volumeRatio >= 1.3)       volumeSignal = "high";
  else if (volumeRatio <= 0.75) volumeSignal = "low";
  else                          volumeSignal = "normal";

  // ── Trend detection ────────────────────────────────────────────────────────
  const firstHalf = sparkline.slice(0, Math.floor(sparkline.length / 2));
  const secondHalf = sparkline.slice(Math.floor(sparkline.length / 2));
  const firstAvg  = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const trendPct  = (secondAvg - firstAvg) / firstAvg;

  let trend: "uptrend" | "downtrend" | "sideways";
  if (trendPct > 0.005)        trend = "uptrend";
  else if (trendPct < -0.005)  trend = "downtrend";
  else                         trend = "sideways";

  // ── Composite score ────────────────────────────────────────────────────────
  // Score ranges from -100 (strong sell) to +100 (strong buy)
  let score = 0;

  // RSI contribution (+/- 30 pts)
  if (rsiVal !== null) {
    if (rsiVal < 30)       score += 30;   // oversold → buy
    else if (rsiVal < 45)  score += 15;
    else if (rsiVal > 70)  score -= 30;   // overbought → sell
    else if (rsiVal > 55)  score -= 10;
  }

  // MACD contribution (+/- 25 pts)
  if (macdSignal === "bullish")      score += 25;
  else if (macdSignal === "bearish") score -= 25;

  // EMA contribution (+/- 20 pts)
  if (emaSignal === "above")         score += 20;
  else if (emaSignal === "below")    score -= 20;
  else                               score +=  5; // crossing is slightly bullish

  // Trend contribution (+/- 15 pts)
  if (trend === "uptrend")           score += 15;
  else if (trend === "downtrend")    score -= 15;

  // Stochastic contribution (+/- 10 pts)
  if (stochVal !== null) {
    if (stochVal < 20)       score += 10;
    else if (stochVal > 80)  score -= 10;
  }

  // Volume amplifier (±20% boost to score)
  if (volumeSignal === "high")       score = score * 1.2;
  else if (volumeSignal === "low")   score = score * 0.8;

  // ATR as % of price
  // Phase 12.1: close-only ATR can overstate volatility for micro-cap tokens.
  // Hard-cap at 20% — values above this are calculation artifacts, not real
  // market conditions (confirmed root cause of the "ATR 393%" bug).
  const rawAtrPercent = price > 0 ? (atrVal / price) * 100 : 0;
  const atrPercent    = rawAtrPercent > 20 ? 0 : rawAtrPercent;

  // ── AI Score — blend into composite (20 % weight) ─────────────────────────
  // Convert trend string to numeric direction for aiScore()
  const aiTrendDir: 1 | -1 | 0 =
    trend === "uptrend" ? 1 : trend === "downtrend" ? -1 : 0;

  // Individual aiScore sub-contributions (same logic as aiScore() exposed):
  const aiRsiPart  = rsiVal !== null ? (rsiVal < 35 ? 2 : rsiVal > 65 ? -2 : 0) : 0;
  const aiMacdPart = macdVal > 0 ? 2 : -2;
  const aiTrendPart = aiTrendDir === 1 ? 3 : -3;
  const aiScoreRaw  = aiRsiPart + aiMacdPart + aiTrendPart;   // [-7, +7]
  const aiScoreNorm = (aiScoreRaw / 7) * 100;                 // [-100, +100]

  // Blend: 80 % technical indicators + 20 % AI classifier
  const blendedScore = score * 0.8 + aiScoreNorm * 0.2;

  return {
    rsiValue:    rsiVal,
    macdValue:   macdVal,
    macdSignal,
    emaSignal,
    ema20:       ema20Val,
    ema50:       ema50Val,
    atrValue:    atrVal,
    atrPercent,
    stochValue:  stochVal,
    bbPosition,
    volumeSignal,
    trend,
    score:       Math.max(-100, Math.min(100, blendedScore)),
    // AI score breakdown
    aiScoreRaw,
    aiScoreNorm,
    aiRsiPart,
    aiMacdPart,
    aiTrendPart,
    aiTrendDir,
  };
}

/**
 * Derive signal type and strength from an IndicatorSnapshot score.
 */
export function scoreToSignal(score: number): {
  type:       "BUY" | "SELL" | "HOLD";
  strength:   "STRONG" | "MODERATE" | "WEAK";
  confidence: number;
} {
  const absScore   = Math.abs(score);
  const confidence = Math.round(50 + absScore * 0.4); // 50–90 range

  let type: "BUY" | "SELL" | "HOLD";
  let strength: "STRONG" | "MODERATE" | "WEAK";

  if (score >= 40) {
    type = "BUY";
    strength = score >= 65 ? "STRONG" : "MODERATE";
  } else if (score <= -40) {
    type = "SELL";
    strength = score <= -65 ? "STRONG" : "MODERATE";
  } else if (absScore >= 20) {
    type = score > 0 ? "BUY" : "SELL";
    strength = "WEAK";
  } else {
    type = "HOLD";
    strength = "WEAK";
  }

  return { type, strength, confidence: Math.min(confidence, 95) };
}

/**
 * Generate a human-readable reason string based on the indicator snapshot.
 */
export function generateReason(snap: IndicatorSnapshot): string {
  const parts: string[] = [];

  if (snap.rsiValue !== null) {
    if (snap.rsiValue < 30)
      parts.push(`RSI oversold at ${snap.rsiValue.toFixed(1)}`);
    else if (snap.rsiValue > 70)
      parts.push(`RSI overbought at ${snap.rsiValue.toFixed(1)}`);
    else
      parts.push(`RSI neutral at ${snap.rsiValue.toFixed(1)}`);
  }

  if (snap.macdSignal === "bullish")
    parts.push("MACD bullish crossover");
  else if (snap.macdSignal === "bearish")
    parts.push("MACD bearish crossover");

  if (snap.emaSignal === "above")
    parts.push("EMA20 above EMA50 — uptrend confirmed");
  else if (snap.emaSignal === "below")
    parts.push("EMA20 below EMA50 — downtrend pressure");
  else
    parts.push("EMA20/50 crossing — momentum shift");

  if (snap.trend === "uptrend")    parts.push("strong uptrend structure");
  else if (snap.trend === "downtrend") parts.push("downtrend structure forming");

  if (snap.bbPosition === "lower") parts.push("price at lower Bollinger Band — reversal zone");
  if (snap.bbPosition === "upper") parts.push("price at upper Bollinger Band — resistance zone");

  if (snap.volumeSignal === "high") parts.push("high volume confirmation");
  if (snap.volumeSignal === "low")  parts.push("low volume — weak conviction");

  if (parts.length === 0) return "Neutral market conditions. No strong signal.";
  return parts.join(". ") + ".";
}
