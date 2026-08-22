/**
 * Footprint Chart Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Reconstructs footprint candles from trade data.
 * Each candle shows bid/ask volume at every price level (cluster),
 * delta (buy − sell pressure), and imbalance zones.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FootprintCluster {
  price:       number;   // price level (rounded to tick)
  bidVol:      number;   // total sell-side volume at this level
  askVol:      number;   // total buy-side volume at this level
  delta:       number;   // askVol - bidVol (positive = buying pressure)
  imbalance:   "bid" | "ask" | "none";  // 3:1 imbalance detection
  isPoint:     boolean;  // high-volume node (POC candidate)
  pctOfCandle: number;   // 0–1, share of total candle volume
}

export interface FootprintCandle {
  open:        number;
  high:        number;
  low:         number;
  close:       number;
  timestamp:   number;
  clusters:    FootprintCluster[];
  totalDelta:  number;   // net delta for the whole candle
  totalVol:    number;
  poc:         number;   // Price Of Control — highest vol cluster price
  pocVol:      number;
  valueAreaHigh: number;
  valueAreaLow:  number;
  cvd:         number;   // cumulative volume delta (running sum)
  isBullish:   boolean;
  deltaColor:  "green" | "red" | "neutral";
  absorbed:    boolean;  // large delta but price didn't move much
}

export interface FootprintData {
  symbol:      string;
  candles:     FootprintCandle[];
  currentCVD:  number;   // running CVD across all candles
  avgDelta:    number;
  maxAbsVol:   number;   // for rendering scale
}

export interface TradeEvent {
  price:    number;
  qty:      number;
  isBuyer:  boolean;  // true = market buy (taker is buyer)
  time:     number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const TICK_SIZE: Record<string, number> = {
  BTC:  10,
  ETH:  1,
  SOL:  0.1,
  BNB:  0.1,
  XRP:  0.0001,
  ADA:  0.0001,
  AVAX: 0.01,
  DOGE: 0.00001,
};

const IMBALANCE_RATIO = 3.0;  // 3:1 ratio to flag imbalance
const VALUE_AREA_PCT  = 0.68; // 68% of volume in value area

// ─── Core Functions ───────────────────────────────────────────────────────────

/** Round price to nearest tick */
export function snapToTick(price: number, symbol: string): number {
  const tick = TICK_SIZE[symbol] ?? 0.01;
  return Math.round(price / tick) * tick;
}

/** Build footprint candle from a list of trades */
export function buildFootprintCandle(
  trades:    TradeEvent[],
  symbol:    string,
  timestamp: number,
  prevCVD:   number = 0
): FootprintCandle {
  if (trades.length === 0) {
    const empty: FootprintCandle = {
      open: 0, high: 0, low: 0, close: 0, timestamp,
      clusters: [], totalDelta: 0, totalVol: 0,
      poc: 0, pocVol: 0, valueAreaHigh: 0, valueAreaLow: 0,
      cvd: prevCVD, isBullish: true, deltaColor: "neutral", absorbed: false,
    };
    return empty;
  }

  // OHLC
  const prices = trades.map((t) => t.price);
  const open   = trades[0].price;
  const close  = trades[trades.length - 1].price;
  const high   = Math.max(...prices);
  const low    = Math.min(...prices);

  // Build cluster map
  const clusterMap = new Map<number, { bidVol: number; askVol: number }>();
  let totalDelta = 0;
  let totalVol   = 0;

  for (const trade of trades) {
    const level = snapToTick(trade.price, symbol);
    const entry = clusterMap.get(level) ?? { bidVol: 0, askVol: 0 };

    if (trade.isBuyer) {
      entry.askVol += trade.qty;
      totalDelta   += trade.qty;
    } else {
      entry.bidVol += trade.qty;
      totalDelta   -= trade.qty;
    }

    totalVol += trade.qty;
    clusterMap.set(level, entry);
  }

  // Find POC (Price Of Control)
  let pocLevel = 0;
  let pocVol   = 0;
  clusterMap.forEach((v, price) => {
    const vol = v.bidVol + v.askVol;
    if (vol > pocVol) { pocVol = vol; pocLevel = price; }
  });

  // Value Area (68% of total volume around POC)
  const sortedLevels = Array.from(clusterMap.entries())
    .map(([price, v]) => ({ price, vol: v.bidVol + v.askVol }))
    .sort((a, b) => b.vol - a.vol);

  let vaVol = 0;
  const vaTarget = totalVol * VALUE_AREA_PCT;
  const vaLevels: number[] = [];
  for (const lvl of sortedLevels) {
    vaVol += lvl.vol;
    vaLevels.push(lvl.price);
    if (vaVol >= vaTarget) break;
  }
  const valueAreaHigh = vaLevels.length ? Math.max(...vaLevels) : high;
  const valueAreaLow  = vaLevels.length ? Math.min(...vaLevels) : low;

  // Build cluster array with imbalance detection
  const clusters: FootprintCluster[] = [];
  clusterMap.forEach((v, price) => {
    const delta     = v.askVol - v.bidVol;
    const vol       = v.askVol + v.bidVol;
    const pctOfCandle = totalVol > 0 ? vol / totalVol : 0;

    let imbalance: FootprintCluster["imbalance"] = "none";
    if (v.bidVol > 0 && v.askVol / v.bidVol >= IMBALANCE_RATIO) imbalance = "ask";
    if (v.askVol > 0 && v.bidVol / v.askVol >= IMBALANCE_RATIO) imbalance = "bid";

    clusters.push({
      price,
      bidVol:  v.bidVol,
      askVol:  v.askVol,
      delta,
      imbalance,
      isPoint: price === pocLevel,
      pctOfCandle,
    });
  });

  clusters.sort((a, b) => b.price - a.price);

  const cvd        = prevCVD + totalDelta;
  const isBullish  = close >= open;
  const priceRange = high - low;
  const absorbed   = Math.abs(totalDelta) > totalVol * 0.4 && priceRange < (TICK_SIZE[symbol] ?? 0.01) * 5;

  const deltaColor =
    totalDelta > totalVol * 0.1  ? "green" :
    totalDelta < -totalVol * 0.1 ? "red"   : "neutral";

  return {
    open, high, low, close, timestamp,
    clusters, totalDelta, totalVol,
    poc: pocLevel, pocVol,
    valueAreaHigh, valueAreaLow,
    cvd, isBullish, deltaColor, absorbed,
  };
}

/** Generate realistic mock footprint candles from a sparkline */
export function generateMockFootprint(
  sparkline: number[],
  symbol:    string
): FootprintData {
  const candles: FootprintCandle[] = [];
  let cvd = 0;
  const now = Date.now();

  const prices = sparkline.length >= 20 ? sparkline : Array.from({ length: 20 }, (_, i) => {
    const base = symbol === "BTC" ? 67000 : symbol === "ETH" ? 3500 : 100;
    return base * (1 + (Math.sin(i * 0.5) * 0.02) + (Math.random() - 0.5) * 0.01);
  });

  const sliceSize = Math.max(1, Math.floor(prices.length / 20));

  for (let c = 0; c < Math.min(20, prices.length - 1); c++) {
    const sliceStart = c * sliceSize;
    const sliceEnd   = Math.min(sliceStart + sliceSize + 1, prices.length);
    const slice      = prices.slice(sliceStart, sliceEnd);

    // Simulate trades within candle
    const trades: TradeEvent[] = [];
    const basePrice  = slice[0];
    const numTrades  = 20 + Math.floor(Math.random() * 60);
    const sentiment  = Math.random() > 0.5 ? 1 : -1;

    for (let t = 0; t < numTrades; t++) {
      const frac  = t / numTrades;
      const tprice = basePrice * (1 + (Math.random() - 0.5) * 0.002);
      const qty   = (0.1 + Math.random() * 2) * (Math.abs(sentiment) + 0.5);
      const isBuyer = Math.random() > (sentiment === 1 ? 0.35 : 0.65);
      trades.push({ price: tprice, qty, isBuyer, time: now - (20 - c) * 300_000 + frac * 300_000 });
    }

    const candle = buildFootprintCandle(trades, symbol, now - (20 - c) * 300_000, cvd);
    cvd = candle.cvd;
    candles.push(candle);
  }

  const allDeltas = candles.map((c) => c.totalDelta);
  const avgDelta  = allDeltas.reduce((s, d) => s + d, 0) / (allDeltas.length || 1);
  const maxAbsVol = Math.max(...candles.map((c) => c.totalVol), 1);

  return { symbol, candles, currentCVD: cvd, avgDelta, maxAbsVol };
}

/** Delta divergence: price up but delta negative (or vice versa) */
export function detectDeltaDivergence(candles: FootprintCandle[]): {
  type: "bearish" | "bullish" | "none";
  strength: number;
} {
  if (candles.length < 3) return { type: "none", strength: 0 };
  const recent = candles.slice(-3);
  const priceUp = recent[recent.length - 1].close > recent[0].close;
  const deltaUp = recent.reduce((s, c) => s + c.totalDelta, 0) > 0;

  if (priceUp && !deltaUp) return { type: "bearish", strength: 72 };
  if (!priceUp && deltaUp) return { type: "bullish", strength: 68 };
  return { type: "none", strength: 0 };
}

/** Find absorption candles (high delta but small range) */
export function findAbsorptionZones(candles: FootprintCandle[]): FootprintCandle[] {
  return candles.filter((c) => c.absorbed);
}

/** CVD trend: is cumulative delta rising or falling? */
export function cvdTrend(candles: FootprintCandle[]): "bullish" | "bearish" | "flat" {
  if (candles.length < 2) return "flat";
  const first = candles[0].cvd;
  const last  = candles[candles.length - 1].cvd;
  const change = (last - first) / (Math.abs(first) || 1);
  if (change >  0.05) return "bullish";
  if (change < -0.05) return "bearish";
  return "flat";
}
