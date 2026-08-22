/**
 * correlationRiskEngine.ts — Phase 8.2 Correlation Risk Engine
 *
 * Prevents opening multiple highly correlated positions simultaneously.
 * Computes pairwise correlation between symbols using recent returns and
 * returns a position-sizing modifier or block signal.
 *
 * PURE ADVISORY — never touches execution.
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CorrelationConfig {
  blockThreshold:  number;   // correlation above this → block new entry (default 0.85)
  reduceThreshold: number;   // correlation above this → reduce position size (default 0.65)
  reductionFactor: number;   // multiply position size by this (default 0.5)
  lookbackPeriods: number;   // candles/prices to compute correlation (default 30)
}

export interface CorrelationPair {
  symbolA:     string;
  symbolB:     string;
  correlation: number;  // -1 to 1
  strength:    "none" | "weak" | "moderate" | "strong" | "extreme";
}

export interface CorrelationDecision {
  symbol:          string;
  openPositions:   string[];
  pairs:           CorrelationPair[];
  maxCorrelation:  number;
  action:          "allow" | "reduce" | "block";
  sizingFactor:    number;   // 0-1, multiply intended position size
  reason:          string;
}

export interface CorrelationMatrix {
  symbols:   string[];
  pairs:     CorrelationPair[];
  computedAt: string;
}

const DEFAULT_CONFIG: CorrelationConfig = {
  blockThreshold:  0.85,
  reduceThreshold: 0.65,
  reductionFactor: 0.5,
  lookbackPeriods: 30,
};

// Known highly correlated groups (static baseline, updated by live data)
const KNOWN_GROUPS: string[][] = [
  ["BTC/USDT", "ETH/USDT", "BNB/USDT"],
  ["ETH/USDT", "SOL/USDT", "AVAX/USDT", "MATIC/USDT"],
  ["BNB/USDT", "TRX/USDT"],
  ["DOGE/USDT", "SHIB/USDT", "PEPE/USDT"],
  ["LINK/USDT", "UNI/USDT", "AAVE/USDT"],
];

function correlationStrength(r: number): CorrelationPair["strength"] {
  const abs = Math.abs(r);
  if (abs >= 0.85) return "extreme";
  if (abs >= 0.70) return "strong";
  if (abs >= 0.50) return "moderate";
  if (abs >= 0.30) return "weak";
  return "none";
}

// Pearson correlation of two equal-length arrays
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const devA = (a[i]! - meanA);
    const devB = (b[i]! - meanB);
    num += devA * devB;
    da  += devA * devA;
    db  += devB * devB;
  }
  const denom = Math.sqrt(da * db);
  return denom > 0 ? Math.max(-1, Math.min(1, num / denom)) : 0;
}

// ─── Service class ────────────────────────────────────────────────────────────

class CorrelationRiskEngine {
  private cfg: CorrelationConfig = { ...DEFAULT_CONFIG };
  // symbol → recent % returns
  private priceHistory = new Map<string, number[]>();

  configure(patch: Partial<CorrelationConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    logger.info({ cfg: this.cfg }, "CorrelationRisk: config updated");
  }

  getConfig(): CorrelationConfig { return { ...this.cfg }; }

  /** Feed a new price point for a symbol */
  recordPrice(symbol: string, price: number): void {
    const hist = this.priceHistory.get(symbol) ?? [];
    hist.push(price);
    if (hist.length > this.cfg.lookbackPeriods + 2) hist.shift();
    this.priceHistory.set(symbol, hist);
  }

  private getReturns(symbol: string): number[] {
    const prices = this.priceHistory.get(symbol) ?? [];
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1]!;
      returns.push(prev !== 0 ? (prices[i]! - prev) / prev : 0);
    }
    return returns;
  }

  /** Get pairwise correlation between two symbols */
  getCorrelation(symbolA: string, symbolB: string): number {
    const rA = this.getReturns(symbolA);
    const rB = this.getReturns(symbolB);
    if (rA.length >= 5 && rB.length >= 5) return pearson(rA, rB);

    // Fall back to static group correlation
    for (const group of KNOWN_GROUPS) {
      if (group.includes(symbolA) && group.includes(symbolB)) {
        return 0.75; // baseline strong correlation
      }
    }
    return 0;
  }

  /** Main check: can we open a new position in `symbol` given existing open positions? */
  checkEntry(symbol: string, openPositions: string[]): CorrelationDecision {
    const others = openPositions.filter((s) => s !== symbol);

    const pairs: CorrelationPair[] = others.map((other) => {
      const r = this.getCorrelation(symbol, other);
      return { symbolA: symbol, symbolB: other, correlation: Math.round(r * 1000) / 1000, strength: correlationStrength(r) };
    });

    const maxCorr = pairs.reduce((m, p) => Math.max(m, Math.abs(p.correlation)), 0);

    let action: CorrelationDecision["action"] = "allow";
    let sizingFactor = 1.0;
    let reason = "No significant correlation detected";

    if (maxCorr >= this.cfg.blockThreshold) {
      action       = "block";
      sizingFactor = 0;
      const highPairs = pairs.filter((p) => Math.abs(p.correlation) >= this.cfg.blockThreshold);
      reason = `Correlation too high with ${highPairs.map((p) => p.symbolB).join(", ")} (max ${(maxCorr * 100).toFixed(0)}%)`;
    } else if (maxCorr >= this.cfg.reduceThreshold) {
      action       = "reduce";
      sizingFactor = this.cfg.reductionFactor;
      const modPairs = pairs.filter((p) => Math.abs(p.correlation) >= this.cfg.reduceThreshold);
      reason = `Correlated with ${modPairs.map((p) => p.symbolB).join(", ")} — position reduced to ${(sizingFactor * 100).toFixed(0)}%`;
    }

    if (action !== "allow") {
      logger.info({ symbol, openPositions, maxCorr, action }, "CorrelationRisk: entry check");
    }

    return { symbol, openPositions: others, pairs, maxCorrelation: Math.round(maxCorr * 1000) / 1000, action, sizingFactor, reason };
  }

  /** Compute full correlation matrix for a set of symbols */
  getMatrix(symbols: string[]): CorrelationMatrix {
    const pairs: CorrelationPair[] = [];
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const r = this.getCorrelation(symbols[i]!, symbols[j]!);
        pairs.push({ symbolA: symbols[i]!, symbolB: symbols[j]!, correlation: Math.round(r * 1000) / 1000, strength: correlationStrength(r) });
      }
    }
    return { symbols, pairs, computedAt: new Date().toISOString() };
  }
}

export const correlationRiskEngine = new CorrelationRiskEngine();
