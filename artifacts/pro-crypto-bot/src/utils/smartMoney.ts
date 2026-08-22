/**
 * Smart Money Concepts (SMC) Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects institutional footprints in price action:
 *   • Order Blocks (OB)       — origin of impulsive moves
 *   • Fair Value Gaps (FVG)   — price gaps left by fast institutional moves
 *   • Break of Structure (BOS) — market structure shift
 *   • Change of Character (CHoCH) — trend reversal signal
 *   • Liquidity Sweeps         — stop hunts above highs / below lows
 *   • Premium / Discount zones — Fibonacci equilibrium areas
 *   • Institutional Flow Score — aggregated smart money sentiment
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type SMCBias = "bullish" | "bearish" | "neutral";

export interface OrderBlock {
  id:          string;
  type:        "bullish" | "bearish";
  priceHigh:   number;
  priceLow:    number;
  midPrice:    number;
  strength:    number;   // 0–100
  testedCount: number;
  isMitigated: boolean;
  isActive:    boolean;
  candleIndex: number;
  label:       string;
}

export interface FairValueGap {
  id:          string;
  type:        "bullish" | "bearish";
  gapHigh:     number;
  gapLow:      number;
  midPrice:    number;
  size:        number;   // gap size in price units
  sizePct:     number;   // gap size as % of price
  isFilled:    boolean;
  fillPct:     number;   // 0–100, how much has been filled
  strength:    number;
  candleIndex: number;
}

export interface StructurePoint {
  type:    "HH" | "HL" | "LH" | "LL";   // Higher High/Low, Lower High/Low
  price:   number;
  index:   number;
  label:   string;
}

export interface BOS {
  id:      string;
  type:    "bullish" | "bearish";
  price:   number;
  index:   number;
  label:   "BOS" | "CHoCH";
  strength: number;
}

export interface LiquiditySweep {
  id:          string;
  type:        "buy_stop" | "sell_stop";   // buy stops above highs, sell stops below lows
  price:       number;
  sweptLevel:  number;
  recovered:   boolean;   // price reversed after sweep
  strength:    number;
  index:       number;
  label:       string;
}

export interface PremiumDiscount {
  equilibrium:  number;   // 50% fib of swing
  premium:      number;   // above 61.8%
  discount:     number;   // below 38.2%
  currentZone:  "premium" | "discount" | "equilibrium";
  fibLevels:    { level: number; price: number; label: string }[];
}

export interface SMCAnalysis {
  symbol:         string;
  bias:           SMCBias;
  flowScore:      number;   // -100 to +100 (institutional sentiment)
  orderBlocks:    OrderBlock[];
  fvgs:           FairValueGap[];
  structure:      StructurePoint[];
  bosEvents:      BOS[];
  sweeps:         LiquiditySweep[];
  premiumDiscount: PremiumDiscount;
  swingHigh:      number;
  swingLow:       number;
  keyLevels:      { price: number; label: string; type: "support" | "resistance" }[];
  summary:        string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

function swingHighs(prices: number[], lookback = 3): number[] {
  const highs: number[] = [];
  for (let i = lookback; i < prices.length - lookback; i++) {
    const window = prices.slice(i - lookback, i + lookback + 1);
    if (prices[i] === Math.max(...window)) highs.push(prices[i]);
  }
  return highs;
}

function swingLows(prices: number[], lookback = 3): number[] {
  const lows: number[] = [];
  for (let i = lookback; i < prices.length - lookback; i++) {
    const window = prices.slice(i - lookback, i + lookback + 1);
    if (prices[i] === Math.min(...window)) lows.push(prices[i]);
  }
  return lows;
}

// ─── Order Blocks ─────────────────────────────────────────────────────────────

export function detectOrderBlocks(prices: number[], _symbol: string): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  if (prices.length < 10) return blocks;

  const len = prices.length;

  for (let i = 2; i < len - 2; i++) {
    const prev   = prices[i - 1];
    const curr   = prices[i];
    const next   = prices[i + 1];
    const next2  = prices[i + 2];

    // Bullish OB: last bearish candle before impulsive bullish move
    const impulsiveBull = next > curr * 1.005 && next2 > next;
    if (curr < prev && impulsiveBull) {
      const priceHigh  = Math.max(curr, prev);
      const priceLow   = Math.min(curr, prev);
      const currentPrice = prices[len - 1];
      const isMitigated = currentPrice >= priceLow && currentPrice <= priceHigh;
      const isActive    = currentPrice < priceHigh && currentPrice > priceLow * 0.98;

      // Count how many times price returned to this zone
      let testedCount = 0;
      for (let j = i + 2; j < len; j++) {
        if (prices[j] >= priceLow && prices[j] <= priceHigh) testedCount++;
      }

      blocks.push({
        id:          uid(),
        type:        "bullish",
        priceHigh,
        priceLow,
        midPrice:    (priceHigh + priceLow) / 2,
        strength:    Math.min(100, 40 + testedCount * 15 + (isActive ? 20 : 0)),
        testedCount,
        isMitigated,
        isActive,
        candleIndex: i,
        label:       `Bullish OB @ ${priceLow.toFixed(2)}`,
      });
    }

    // Bearish OB: last bullish candle before impulsive bearish move
    const impulsiveBear = next < curr * 0.995 && next2 < next;
    if (curr > prev && impulsiveBear) {
      const priceHigh  = Math.max(curr, prev);
      const priceLow   = Math.min(curr, prev);
      const currentPrice = prices[len - 1];
      const isMitigated = currentPrice >= priceLow && currentPrice <= priceHigh;
      const isActive    = currentPrice > priceLow && currentPrice < priceHigh * 1.02;

      let testedCount = 0;
      for (let j = i + 2; j < len; j++) {
        if (prices[j] >= priceLow && prices[j] <= priceHigh) testedCount++;
      }

      blocks.push({
        id:          uid(),
        type:        "bearish",
        priceHigh,
        priceLow,
        midPrice:    (priceHigh + priceLow) / 2,
        strength:    Math.min(100, 40 + testedCount * 15 + (isActive ? 20 : 0)),
        testedCount,
        isMitigated,
        isActive,
        candleIndex: i,
        label:       `Bearish OB @ ${priceHigh.toFixed(2)}`,
      });
    }
  }

  // Return strongest, non-overlapping blocks (max 6)
  return blocks
    .filter((b) => !b.isMitigated || b.testedCount >= 2)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 6);
}

// ─── Fair Value Gaps ──────────────────────────────────────────────────────────

export function detectFVGs(prices: number[], _symbol: string): FairValueGap[] {
  const fvgs: FairValueGap[] = [];
  if (prices.length < 5) return fvgs;

  const len  = prices.length;
  // Approximate high/low from price: use ±0.3% around close
  const high = (p: number) => p * 1.003;
  const low  = (p: number) => p * 0.997;

  for (let i = 1; i < len - 1; i++) {
    const prevHigh = high(prices[i - 1]);
    const prevLow  = low(prices[i - 1]);
    const nextHigh = high(prices[i + 1]);
    const nextLow  = low(prices[i + 1]);

    // Bullish FVG: gap between candle[i-1] high and candle[i+1] low
    if (nextLow > prevHigh) {
      const gapHigh  = nextLow;
      const gapLow   = prevHigh;
      const size     = gapHigh - gapLow;
      const sizePct  = (size / prices[i]) * 100;

      if (sizePct > 0.05) {
        // Check fill
        let fillPct = 0;
        for (let j = i + 2; j < len; j++) {
          if (prices[j] <= gapHigh && prices[j] >= gapLow) {
            fillPct = Math.min(100, fillPct + 20);
          }
        }

        fvgs.push({
          id: uid(), type: "bullish", gapHigh, gapLow,
          midPrice: (gapHigh + gapLow) / 2,
          size, sizePct, isFilled: fillPct >= 80, fillPct,
          strength: Math.min(100, 50 + sizePct * 10),
          candleIndex: i,
        });
      }
    }

    // Bearish FVG: gap between candle[i+1] high and candle[i-1] low
    if (prevLow > nextHigh) {
      const gapHigh  = prevLow;
      const gapLow   = nextHigh;
      const size     = gapHigh - gapLow;
      const sizePct  = (size / prices[i]) * 100;

      if (sizePct > 0.05) {
        let fillPct = 0;
        for (let j = i + 2; j < len; j++) {
          if (prices[j] <= gapHigh && prices[j] >= gapLow) {
            fillPct = Math.min(100, fillPct + 20);
          }
        }

        fvgs.push({
          id: uid(), type: "bearish", gapHigh, gapLow,
          midPrice: (gapHigh + gapLow) / 2,
          size, sizePct, isFilled: fillPct >= 80, fillPct,
          strength: Math.min(100, 50 + sizePct * 10),
          candleIndex: i,
        });
      }
    }
  }

  return fvgs
    .filter((f) => !f.isFilled)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 8);
}

// ─── Market Structure ─────────────────────────────────────────────────────────

export function detectMarketStructure(prices: number[]): {
  structure: StructurePoint[];
  bosEvents: BOS[];
} {
  if (prices.length < 8) return { structure: [], bosEvents: [] };

  const structure: StructurePoint[] = [];
  const bosEvents:  BOS[]           = [];
  const len = prices.length;

  // Simplified: find local swing highs/lows
  let lastHigh = prices[0];
  let lastLow  = prices[0];
  let trend: "up" | "down" | "unknown" = "unknown";

  for (let i = 2; i < len - 2; i++) {
    const isSwingHigh = prices[i] > prices[i - 1] && prices[i] > prices[i - 2] &&
                        prices[i] > prices[i + 1] && prices[i] > prices[i + 2];
    const isSwingLow  = prices[i] < prices[i - 1] && prices[i] < prices[i - 2] &&
                        prices[i] < prices[i + 1] && prices[i] < prices[i + 2];

    if (isSwingHigh) {
      const type: StructurePoint["type"] = prices[i] > lastHigh ? "HH" : "LH";
      structure.push({ type, price: prices[i], index: i, label: type });

      // BOS: price breaks above previous high in downtrend
      if (trend === "down" && prices[i] > lastHigh) {
        bosEvents.push({
          id: uid(), type: "bullish", price: prices[i],
          index: i, label: "CHoCH", strength: 75,
        });
        trend = "up";
      } else if (trend === "up" && prices[i] > lastHigh) {
        bosEvents.push({
          id: uid(), type: "bullish", price: prices[i],
          index: i, label: "BOS", strength: 60,
        });
      }

      lastHigh    = prices[i];
    }

    if (isSwingLow) {
      const type: StructurePoint["type"] = prices[i] < lastLow ? "LL" : "HL";
      structure.push({ type, price: prices[i], index: i, label: type });

      // CHoCH: price breaks below previous low in uptrend
      if (trend === "up" && prices[i] < lastLow) {
        bosEvents.push({
          id: uid(), type: "bearish", price: prices[i],
          index: i, label: "CHoCH", strength: 78,
        });
        trend = "down";
      } else if (trend === "down" && prices[i] < lastLow) {
        bosEvents.push({
          id: uid(), type: "bearish", price: prices[i],
          index: i, label: "BOS", strength: 62,
        });
      }

      lastLow = prices[i];

      if (trend === "unknown") trend = "down";
    }
  }

  return {
    structure: structure.slice(-8),
    bosEvents: bosEvents.slice(-4),
  };
}

// ─── Liquidity Sweeps ─────────────────────────────────────────────────────────

export function detectLiquiditySweeps(prices: number[]): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  if (prices.length < 10) return sweeps;

  const len     = prices.length;
  const lookback = Math.min(10, Math.floor(len / 3));

  for (let i = lookback; i < len - 2; i++) {
    const window     = prices.slice(i - lookback, i);
    const recentHigh = Math.max(...window);
    const recentLow  = Math.min(...window);
    const spike      = prices[i];
    const recovery   = prices[i + 1];
    const recovery2  = prices[i + 2] ?? recovery;

    // Buy stop sweep: spike above recent high, then reverses
    if (spike > recentHigh * 1.002) {
      const recovered = recovery < spike * 0.999 && recovery2 < spike * 0.998;
      if (recovered) {
        sweeps.push({
          id:          uid(),
          type:        "buy_stop",
          price:       spike,
          sweptLevel:  recentHigh,
          recovered:   true,
          strength:    Math.min(100, Math.round(((spike - recentHigh) / recentHigh) * 10000)),
          index:       i,
          label:       `🧹 Buy Stop Sweep @ ${recentHigh.toFixed(2)}`,
        });
      }
    }

    // Sell stop sweep: spike below recent low, then reverses
    if (spike < recentLow * 0.998) {
      const recovered = recovery > spike * 1.001 && recovery2 > spike * 1.001;
      if (recovered) {
        sweeps.push({
          id:          uid(),
          type:        "sell_stop",
          price:       spike,
          sweptLevel:  recentLow,
          recovered:   true,
          strength:    Math.min(100, Math.round(((recentLow - spike) / recentLow) * 10000)),
          index:       i,
          label:       `🧹 Sell Stop Sweep @ ${recentLow.toFixed(2)}`,
        });
      }
    }
  }

  return sweeps.sort((a, b) => b.strength - a.strength).slice(0, 5);
}

// ─── Premium / Discount ───────────────────────────────────────────────────────

export function computePremiumDiscount(prices: number[]): PremiumDiscount {
  const high = Math.max(...prices);
  const low  = Math.min(...prices);
  const range = high - low;
  const curr  = prices[prices.length - 1];

  const fib = (pct: number) => low + range * pct;
  const eq  = fib(0.5);

  const fibLevels = [
    { level: 0,    price: fib(0),    label: "0%" },
    { level: 0.236, price: fib(0.236), label: "23.6%" },
    { level: 0.382, price: fib(0.382), label: "38.2%" },
    { level: 0.5,  price: fib(0.5),  label: "50% EQ" },
    { level: 0.618, price: fib(0.618), label: "61.8%" },
    { level: 0.786, price: fib(0.786), label: "78.6%" },
    { level: 1,    price: fib(1),    label: "100%" },
  ];

  const currentPct  = range > 0 ? (curr - low) / range : 0.5;
  const currentZone: PremiumDiscount["currentZone"] =
    currentPct >= 0.618 ? "premium" :
    currentPct <= 0.382 ? "discount" : "equilibrium";

  return {
    equilibrium: eq,
    premium:     fib(0.618),
    discount:    fib(0.382),
    currentZone,
    fibLevels,
  };
}

// ─── Key Levels ───────────────────────────────────────────────────────────────

export function extractKeyLevels(prices: number[]): {
  price: number;
  label: string;
  type: "support" | "resistance";
}[] {
  const sHighs = swingHighs(prices, 2);
  const sLows  = swingLows(prices, 2);
  const curr   = prices[prices.length - 1];

  const levels: { price: number; label: string; type: "support" | "resistance" }[] = [];

  sHighs.slice(-3).forEach((h, i) => {
    levels.push({ price: h, label: `Resistance ${i + 1}`, type: "resistance" });
  });
  sLows.slice(-3).forEach((l, i) => {
    levels.push({ price: l, label: `Support ${i + 1}`, type: "support" });
  });

  return levels.sort((a, b) => Math.abs(a.price - curr) - Math.abs(b.price - curr)).slice(0, 6);
}

// ─── Institutional Flow Score ─────────────────────────────────────────────────

export function computeFlowScore(
  orderBlocks:  OrderBlock[],
  fvgs:         FairValueGap[],
  bosEvents:    BOS[],
  sweeps:       LiquiditySweep[],
  premDisc:     PremiumDiscount
): number {
  let score = 0;

  // Order blocks
  orderBlocks.forEach((ob) => {
    if (ob.isActive && ob.type === "bullish") score += 15;
    if (ob.isActive && ob.type === "bearish") score -= 15;
  });

  // FVGs
  fvgs.forEach((fvg) => {
    if (fvg.type === "bullish" && !fvg.isFilled) score += 10;
    if (fvg.type === "bearish" && !fvg.isFilled) score -= 10;
  });

  // BOS / CHoCH
  bosEvents.slice(-2).forEach((bos) => {
    if (bos.type === "bullish") score += bos.label === "CHoCH" ? 20 : 10;
    if (bos.type === "bearish") score -= bos.label === "CHoCH" ? 20 : 10;
  });

  // Sweeps: recovered sell-stop sweep is bullish signal
  sweeps.slice(-2).forEach((sw) => {
    if (sw.recovered && sw.type === "sell_stop") score += 12;
    if (sw.recovered && sw.type === "buy_stop")  score -= 12;
  });

  // Premium / Discount
  if (premDisc.currentZone === "discount")    score += 8;
  if (premDisc.currentZone === "premium")     score -= 8;

  return Math.max(-100, Math.min(100, score));
}

// ─── Full SMC Analysis ────────────────────────────────────────────────────────

export function analyzeSMC(prices: number[], symbol: string): SMCAnalysis {
  if (prices.length < 10) {
    return {
      symbol, bias: "neutral", flowScore: 0,
      orderBlocks: [], fvgs: [], structure: [],
      bosEvents: [], sweeps: [],
      premiumDiscount: computePremiumDiscount([100, 100]),
      swingHigh: 0, swingLow: 0, keyLevels: [],
      summary: ["Insufficient price data for SMC analysis."],
    };
  }

  const orderBlocks    = detectOrderBlocks(prices, symbol);
  const fvgs           = detectFVGs(prices, symbol);
  const { structure, bosEvents } = detectMarketStructure(prices);
  const sweeps         = detectLiquiditySweeps(prices);
  const premiumDiscount = computePremiumDiscount(prices);
  const keyLevels      = extractKeyLevels(prices);
  const flowScore      = computeFlowScore(orderBlocks, fvgs, bosEvents, sweeps, premiumDiscount);
  const swingHigh      = Math.max(...swingHighs(prices, 2), prices[prices.length - 1]);
  const swingLow       = Math.min(...swingLows(prices, 2), prices[prices.length - 1]);

  const bias: SMCBias = flowScore >= 20 ? "bullish" : flowScore <= -20 ? "bearish" : "neutral";

  // Generate summary bullets
  const summary: string[] = [];
  const lastBOS = bosEvents[bosEvents.length - 1];
  if (lastBOS) summary.push(`${lastBOS.label} ${lastBOS.type === "bullish" ? "📈" : "📉"} detected at ${lastBOS.price.toFixed(2)}`);
  const activeBullOB = orderBlocks.find((b) => b.type === "bullish" && b.isActive);
  if (activeBullOB) summary.push(`Bullish OB active at ${activeBullOB.priceLow.toFixed(2)}–${activeBullOB.priceHigh.toFixed(2)}`);
  const activeBearOB = orderBlocks.find((b) => b.type === "bearish" && b.isActive);
  if (activeBearOB) summary.push(`Bearish OB active at ${activeBearOB.priceLow.toFixed(2)}–${activeBearOB.priceHigh.toFixed(2)}`);
  const openFVG = fvgs.find((f) => !f.isFilled);
  if (openFVG) summary.push(`Open ${openFVG.type} FVG at ${openFVG.gapLow.toFixed(2)}–${openFVG.gapHigh.toFixed(2)}`);
  const recentSweep = sweeps[0];
  if (recentSweep) summary.push(recentSweep.label);
  summary.push(`Price in ${premiumDiscount.currentZone} zone (${Math.round(flowScore > 0 ? flowScore : -flowScore)}% confidence)`);
  if (summary.length === 0) summary.push("No significant SMC patterns detected currently.");

  return {
    symbol, bias, flowScore,
    orderBlocks, fvgs, structure, bosEvents, sweeps,
    premiumDiscount, swingHigh, swingLow, keyLevels,
    summary,
  };
}
