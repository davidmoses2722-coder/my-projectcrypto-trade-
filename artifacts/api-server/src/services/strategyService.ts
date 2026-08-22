/**
 * strategyService.ts — High-probability multi-indicator trading strategy.
 *
 * Strategy: EMA Trend + RSI Pullback + Volume + ATR Volatility
 *
 * BUY conditions (ALL required):
 *   1. Strong trend:   EMA50 > EMA200 AND distance between them is increasing
 *   2. Pullback:       Price near EMA50 (within 2%) AND price above EMA200
 *   3. Momentum:       RSI between 30 and 45 (oversold pullback in uptrend)
 *   4. Volume:         Current candle volume > 20-period average volume
 *   5. Volatility:     ATR(14) > minimum threshold (ATR/price > 0.001 = 0.1%)
 *
 * SELL conditions (graceful exit, ALL required):
 *   1. Downtrend:      EMA50 < EMA200 AND distance increasing
 *   2. Pullback peak:  Price near EMA50 from above AND price below EMA200
 *   3. Momentum:       RSI between 55 and 70 (overbought in downtrend)
 *   4. Volume:         Current candle volume > average volume
 *   5. Volatility:     ATR above threshold
 *
 * Stop-loss:   entry - 1.5 × ATR
 * Take-profit: entry + 3.0 × ATR  (1:2 risk/reward ratio)
 * Max trades:  2 per day (checked via dailyTradeCount input)
 *
 * IMPORTANT: This module is PURE calculation only.
 *   • No exchange calls.
 *   • No database writes.
 *   • No side effects.
 *   Designed to plug in cleanly next to riskService and tradeService.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** OHLCV candle — must be sorted oldest → newest */
export interface MarketCandle {
  time:   number;   // Unix ms
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;   // base currency volume
}

/** Full signal output from generateSignal() */
export interface StrategySignal {
  // Phase 8.7: "SHORT" added for bearish-market entries (ActiveSwing dual mode).
  // Existing engines that never emit it are unaffected.
  action:     "BUY" | "SELL" | "SHORT" | "HOLD";
  confidence: number;    // 0–100; 100 = all conditions met

  // Indicator values (null if not enough data)
  ema50:      number | null;
  ema200:     number | null;
  rsi:        number | null;
  atr:        number | null;
  currentVol: number | null;
  avgVol:     number | null;

  // ATR-anchored SL/TP (relative to current price)
  suggestedSl:   number | null;   // entry - 1.5 × ATR
  suggestedTp:   number | null;   // entry + 3.0 × ATR
  stopLossPct:   number | null;   // SL expressed as fraction (e.g. 0.015)
  takeProfitPct: number | null;   // TP expressed as fraction (e.g. 0.030)

  // Trade gate status
  canTrade:    boolean;
  blockReason: string | null;     // set when canTrade = false

  // Diagnostics
  conditions: BuyConditions | SellConditions | null;
  reason:     string;             // human-readable summary

  // Phase 8.7: trend-based trading mode + structured HOLD diagnostics.
  // Optional so pre-existing engines (which don't set them) are unaffected.
  mode?:              "LONG" | "SHORT" | null;         // current trend regime
  conditionsMet?:     number | null;                   // e.g. 3 (of conditionsTotal)
  conditionsTotal?:   number | null;                   // e.g. 5
  missingConditions?: string[] | null;                 // named gates not satisfied
}

/** Checklist for BUY signal */
export interface BuyConditions {
  trendUp:          boolean;  // EMA50 > EMA200
  trendStrengthening: boolean; // gap widening
  nearEma50:        boolean;  // price within 2% of EMA50
  aboveEma200:      boolean;  // price > EMA200
  rsiInRange:       boolean;  // RSI 30–45
  volumeAboveAvg:   boolean;  // current vol > avg vol
  atrAboveMin:      boolean;  // ATR/price > 0.1%
}

/** Checklist for SELL signal */
export interface SellConditions {
  trendDown:           boolean;
  trendStrengthening:  boolean;
  nearEma50:           boolean;
  belowEma200:         boolean;
  rsiInRange:          boolean;
  volumeAboveAvg:      boolean;
  atrAboveMin:         boolean;
}

// ─── Tunable parameters ───────────────────────────────────────────────────────

const EMA_FAST_PERIOD    = 50;
const EMA_SLOW_PERIOD    = 200;
const RSI_PERIOD         = 14;
const ATR_PERIOD         = 14;
const VOLUME_AVG_PERIOD  = 20;

const RSI_BUY_LOW        = 30;
const RSI_BUY_HIGH       = 45;
const RSI_SELL_LOW       = 55;
const RSI_SELL_HIGH      = 70;

const EMA50_PROXIMITY    = 0.02;   // price must be within 2% of EMA50
const ATR_MIN_PCT        = 0.001;  // ATR must be > 0.1% of price

const SL_ATR_MULT        = 1.5;    // stopLoss  = entry - 1.5 × ATR
const TP_ATR_MULT        = 3.0;    // takeProfit = entry + 3.0 × ATR  (1:2 RR)

const MAX_DAILY_TRADES   = 2;

// ─── Indicator functions ──────────────────────────────────────────────────────

/**
 * Exponential Moving Average.
 * Returns an array of EMA values (same length as input), null-padded at the start.
 * Uses SMA seed for the first window.
 */
export function computeEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length < period) return closes.map(() => null);

  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(closes.length).fill(null);

  // Seed: SMA of first `period` values
  let sma = 0;
  for (let i = 0; i < period; i++) sma += closes[i]!;
  sma /= period;

  result[period - 1] = sma;
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i]! * k + result[i - 1]! * (1 - k);
  }
  return result;
}

/**
 * Relative Strength Index (Wilder's smoothing method).
 * Returns the RSI for the latest price (or null if not enough data).
 */
export function computeRSI(closes: number[], period: number = RSI_PERIOD): number | null {
  if (closes.length < period + 1) return null;

  // Use Wilder's smoothed RS (EMA with period as smoothing factor)
  // First average: simple mean of first `period` changes
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff > 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for remaining bars
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain  = diff > 0 ? diff : 0;
    const loss  = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Average True Range (Wilder's smoothing).
 * Returns ATR for the latest bar, or null if not enough data.
 *
 * True Range = max(H-L, |H-C_prev|, |L-C_prev|)
 */
export function computeATR(
  highs:  number[],
  lows:   number[],
  closes: number[],
  period: number = ATR_PERIOD,
): number | null {
  if (highs.length < period + 1) return null;

  const trList: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const hl    = highs[i]!  - lows[i]!;
    const hcp   = Math.abs(highs[i]!  - closes[i - 1]!);
    const lcp   = Math.abs(lows[i]!   - closes[i - 1]!);
    trList.push(Math.max(hl, hcp, lcp));
  }

  if (trList.length < period) return null;

  // Seed: SMA of first `period` TRs
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trList[i]!;
  atr /= period;

  // Wilder smoothing
  for (let i = period; i < trList.length; i++) {
    atr = (atr * (period - 1) + trList[i]!) / period;
  }
  return atr;
}

/**
 * Simple moving average of volumes.
 * Returns the average, or null if not enough data.
 */
export function computeVolumeAvg(volumes: number[], period: number = VOLUME_AVG_PERIOD): number | null {
  if (volumes.length < period) return null;
  const slice = volumes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

// ─── Main signal generator ────────────────────────────────────────────────────

export interface GenerateSignalInput {
  candles:          MarketCandle[];  // sorted oldest → newest (min 201 needed for EMA200)
  currentPrice:     number;
  dailyTradeCount:  number;         // trades placed today (from riskManager)
}

export function generateSignal(input: GenerateSignalInput): StrategySignal {
  const { candles, currentPrice, dailyTradeCount } = input;

  // ── Gate: daily trade limit ───────────────────────────────────────────────
  if (dailyTradeCount >= MAX_DAILY_TRADES) {
    return hold(null, null, null, null, null, null,
      false, `Daily trade limit reached (${dailyTradeCount}/${MAX_DAILY_TRADES})`);
  }

  // ── Minimum data check ────────────────────────────────────────────────────
  if (candles.length < EMA_SLOW_PERIOD + 2) {
    return hold(null, null, null, null, null, null,
      true, `Not enough candles (have ${candles.length}, need ${EMA_SLOW_PERIOD + 2})`);
  }

  const closes  = candles.map((c) => c.close);
  const highs   = candles.map((c) => c.high);
  const lows    = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  // ── Compute indicators ────────────────────────────────────────────────────
  const ema50Arr  = computeEMA(closes, EMA_FAST_PERIOD);
  const ema200Arr = computeEMA(closes, EMA_SLOW_PERIOD);

  const lastIdx    = closes.length - 1;
  const prevIdx    = lastIdx - 1;

  const ema50      = ema50Arr[lastIdx]  ?? null;
  const ema200     = ema200Arr[lastIdx] ?? null;
  const ema50prev  = ema50Arr[prevIdx]  ?? null;
  const ema200prev = ema200Arr[prevIdx] ?? null;

  const rsi     = computeRSI(closes);
  const rawAtr  = computeATR(highs, lows, closes);

  // ── Shared calculations ───────────────────────────────────────────────────
  const price = currentPrice > 0 ? currentPrice : (closes[lastIdx] ?? 0);

  // Phase 12.1: reject impossible ATR values before they poison SL/TP sizing
  const atr = (
    rawAtr !== null &&
    price  >  0    &&
    rawAtr >  0    &&
    rawAtr <= price &&
    rawAtr / price <= 0.20
  ) ? rawAtr : null;

  const currentVol = volumes[lastIdx] ?? null;
  const avgVol     = computeVolumeAvg(volumes.slice(0, -1));  // avg excludes current bar

  let suggestedSl:   number | null = null;
  let suggestedTp:   number | null = null;
  let stopLossPct:   number | null = null;
  let takeProfitPct: number | null = null;

  if (atr != null && price > 0) {
    suggestedSl   = price - SL_ATR_MULT * atr;
    suggestedTp   = price + TP_ATR_MULT * atr;
    stopLossPct   = (SL_ATR_MULT * atr) / price;
    takeProfitPct = (TP_ATR_MULT * atr) / price;
  }

  // ── EMA gap conditions ────────────────────────────────────────────────────
  const gap     = ema50 != null && ema200 != null ? ema50 - ema200 : null;
  const gapPrev = ema50prev != null && ema200prev != null ? ema50prev - ema200prev : null;
  const gapIncreasing     = gap != null && gapPrev != null && Math.abs(gap) > Math.abs(gapPrev);

  // ── Shared conditions ─────────────────────────────────────────────────────
  const nearEma50     = ema50 != null && Math.abs(price - ema50) / ema50 <= EMA50_PROXIMITY;
  const atrAboveMin   = atr != null && price > 0 && (atr / price) >= ATR_MIN_PCT;
  const volAboveAvg   = currentVol != null && avgVol != null && currentVol > avgVol;

  // ── Evaluate BUY conditions ────────────────────────────────────────────────
  if (ema50 != null && ema200 != null && rsi != null) {
    const buy: BuyConditions = {
      trendUp:             ema50 > ema200,
      trendStrengthening:  ema50 > ema200 && gapIncreasing,
      nearEma50,
      aboveEma200:         price > ema200,
      rsiInRange:          rsi >= RSI_BUY_LOW && rsi <= RSI_BUY_HIGH,
      volumeAboveAvg:      volAboveAvg,
      atrAboveMin,
    };

    const metConditions = Object.values(buy).filter(Boolean).length;
    const totalConditions = Object.keys(buy).length;
    const confidence = Math.round((metConditions / totalConditions) * 100);

    const allMet = Object.values(buy).every(Boolean);

    if (allMet) {
      return {
        action:        "BUY",
        confidence,
        ema50,
        ema200,
        rsi,
        atr,
        currentVol,
        avgVol,
        suggestedSl,
        suggestedTp,
        stopLossPct,
        takeProfitPct,
        canTrade:    true,
        blockReason: null,
        conditions:  buy,
        reason:      `BUY: EMA50(${ema50.toFixed(2)})>EMA200(${ema200.toFixed(2)}) gap↑, RSI=${rsi.toFixed(1)}, vol↑, ATR=${atr?.toFixed(2)}`,
      };
    }

    // ── Evaluate SELL conditions ─────────────────────────────────────────────
    const sell: SellConditions = {
      trendDown:           ema50 < ema200,
      trendStrengthening:  ema50 < ema200 && gapIncreasing,
      nearEma50,
      belowEma200:         price < ema200,
      rsiInRange:          rsi >= RSI_SELL_LOW && rsi <= RSI_SELL_HIGH,
      volumeAboveAvg:      volAboveAvg,
      atrAboveMin,
    };

    const sellAllMet = Object.values(sell).every(Boolean);
    const sellMet    = Object.values(sell).filter(Boolean).length;
    const sellConf   = Math.round((sellMet / Object.keys(sell).length) * 100);

    if (sellAllMet) {
      return {
        action:        "SELL",
        confidence:    sellConf,
        ema50,
        ema200,
        rsi,
        atr,
        currentVol,
        avgVol,
        suggestedSl:   null,
        suggestedTp:   null,
        stopLossPct:   null,
        takeProfitPct: null,
        canTrade:      true,
        blockReason:   null,
        conditions:    sell,
        reason:        `SELL: EMA50(${ema50.toFixed(2)})<EMA200(${ema200.toFixed(2)}) gap↑, RSI=${rsi.toFixed(1)}, vol↑`,
      };
    }

    return hold(ema50, ema200, rsi, atr, currentVol, avgVol,
      true,
      `HOLD: conditions ${metConditions}/${totalConditions} met — ` +
      `EMA50${ema50 > ema200 ? ">" : "<"}EMA200, RSI=${rsi.toFixed(1)}, ` +
      `near50=${nearEma50}, vol↑=${volAboveAvg}`,
    );
  }

  return hold(ema50, ema200, rsi, atr, currentVol, avgVol,
    true, "HOLD: insufficient indicator data");
}

// ─── Helper: HOLD signal factory ─────────────────────────────────────────────

function hold(
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
    ema50,
    ema200,
    rsi,
    atr,
    currentVol,
    avgVol,
    suggestedSl:   null,
    suggestedTp:   null,
    stopLossPct:   null,
    takeProfitPct: null,
    canTrade,
    blockReason:   canTrade ? null : reason,
    conditions:    null,
    reason,
  };
}
