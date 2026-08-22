/**
 * optimizerEngine.ts — Phase 7.2 Strategy Optimizer
 *
 * Grid-search over strategy parameters: RSI values, EMA periods, TP%, SL%, ATR multipliers.
 * Returns best configuration and top-20 configurations.
 *
 * PURE COMPUTATION — no DB writes, no live orders.
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OptimizerParams {
  strategyId:    string;
  symbol:        string;
  /** Range definitions for each parameter */
  rsiRange?:     { min: number; max: number; step: number };
  ema1Range?:    { min: number; max: number; step: number };
  ema2Range?:    { min: number; max: number; step: number };
  tpRange?:      { min: number; max: number; step: number };
  slRange?:      { min: number; max: number; step: number };
  atrRange?:     { min: number; max: number; step: number };
  /** Callback: run strategy with given params, return score metrics */
  simulateFn:    (cfg: ParameterSet) => SimulationResult;
  maxCombinations?: number;  // default 500
}

export interface ParameterSet {
  rsi:   number;
  ema1:  number;
  ema2:  number;
  tp:    number;   // %
  sl:    number;   // %
  atr:   number;   // multiplier
}

export interface SimulationResult {
  returnPct:    number;
  winRate:      number;
  profitFactor: number;
  sharpeRatio:  number;
  maxDrawdown:  number;
  totalTrades:  number;
}

export interface RankedConfig {
  rank:         number;
  params:       ParameterSet;
  metrics:      SimulationResult;
  score:        number;   // composite 0-100
}

export interface OptimizerResult {
  strategyId:    string;
  symbol:        string;
  bestConfig:    RankedConfig;
  top20:         RankedConfig[];
  totalTested:   number;
  computedAt:    string;
  searchSpace:   number;
}

// ─── Parameter defaults ───────────────────────────────────────────────────────

const DEFAULT_RANGES = {
  rsiRange:  { min: 20, max: 80, step: 5 },
  ema1Range: { min: 10, max: 50, step: 5 },
  ema2Range: { min: 50, max: 200, step: 25 },
  tpRange:   { min: 0.5, max: 5.0, step: 0.5 },
  slRange:   { min: 0.25, max: 3.0, step: 0.25 },
  atrRange:  { min: 1.0, max: 4.0, step: 0.5 },
};

function range(min: number, max: number, step: number): number[] {
  const vals: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) {
    vals.push(Math.round(v * 1000) / 1000);
  }
  return vals;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreConfig(m: SimulationResult): number {
  if (m.totalTrades < 5) return 0; // not enough data
  const retNorm  = Math.min(100, Math.max(0, m.returnPct * 5));
  const winNorm  = Math.min(100, m.winRate);
  const pfNorm   = Math.min(100, m.profitFactor * 20);
  const shNorm   = Math.min(100, Math.max(0, (m.sharpeRatio + 3) * 16.7));
  const ddNorm   = Math.max(0, 100 - m.maxDrawdown * 2);
  return Math.round(retNorm * 0.3 + winNorm * 0.2 + pfNorm * 0.2 + shNorm * 0.2 + ddNorm * 0.1);
}

// ─── Main optimizer ───────────────────────────────────────────────────────────

export function runOptimizer(params: OptimizerParams): OptimizerResult {
  const {
    strategyId, symbol, simulateFn,
    maxCombinations = 500,
  } = params;

  const rsiVals  = range((params.rsiRange  ?? DEFAULT_RANGES.rsiRange).min,  (params.rsiRange  ?? DEFAULT_RANGES.rsiRange).max,  (params.rsiRange  ?? DEFAULT_RANGES.rsiRange).step);
  const ema1Vals = range((params.ema1Range ?? DEFAULT_RANGES.ema1Range).min, (params.ema1Range ?? DEFAULT_RANGES.ema1Range).max, (params.ema1Range ?? DEFAULT_RANGES.ema1Range).step);
  const ema2Vals = range((params.ema2Range ?? DEFAULT_RANGES.ema2Range).min, (params.ema2Range ?? DEFAULT_RANGES.ema2Range).max, (params.ema2Range ?? DEFAULT_RANGES.ema2Range).step);
  const tpVals   = range((params.tpRange   ?? DEFAULT_RANGES.tpRange).min,   (params.tpRange   ?? DEFAULT_RANGES.tpRange).max,   (params.tpRange   ?? DEFAULT_RANGES.tpRange).step);
  const slVals   = range((params.slRange   ?? DEFAULT_RANGES.slRange).min,   (params.slRange   ?? DEFAULT_RANGES.slRange).max,   (params.slRange   ?? DEFAULT_RANGES.slRange).step);
  const atrVals  = range((params.atrRange  ?? DEFAULT_RANGES.atrRange).min,  (params.atrRange  ?? DEFAULT_RANGES.atrRange).max,  (params.atrRange  ?? DEFAULT_RANGES.atrRange).step);

  const searchSpace = rsiVals.length * ema1Vals.length * ema2Vals.length * tpVals.length * slVals.length * atrVals.length;

  // Build candidate set (sample evenly if too large)
  const candidates: ParameterSet[] = [];
  let count = 0;
  const sampleRate = searchSpace > maxCombinations ? maxCombinations / searchSpace : 1;

  outer: for (const rsi of rsiVals) {
    for (const ema1 of ema1Vals) {
      for (const ema2 of ema2Vals) {
        if (ema2 <= ema1) continue; // ema2 must be longer period
        for (const tp of tpVals) {
          for (const sl of slVals) {
            if (sl >= tp) continue; // SL must be tighter than TP
            for (const atr of atrVals) {
              if (Math.random() > sampleRate) continue;
              candidates.push({ rsi, ema1, ema2, tp, sl, atr });
              count++;
              if (count >= maxCombinations) break outer;
            }
          }
        }
      }
    }
  }

  logger.info({ strategyId, candidates: candidates.length, searchSpace }, "Optimizer: running grid search");

  // Run simulation on all candidates
  const results: RankedConfig[] = candidates.map((cfg, i) => ({
    rank:    i + 1,
    params:  cfg,
    metrics: simulateFn(cfg),
    score:   0,
  }));

  // Score and sort
  for (const r of results) r.score = scoreConfig(r.metrics);
  results.sort((a, b) => b.score - a.score);

  // Assign ranks after sorting
  results.forEach((r, i) => { r.rank = i + 1; });

  const top20 = results.slice(0, 20);
  const best  = results[0] ?? {
    rank: 1,
    params: candidates[0] ?? { rsi: 50, ema1: 20, ema2: 100, tp: 2.0, sl: 1.0, atr: 2.0 },
    metrics: { returnPct: 0, winRate: 0, profitFactor: 0, sharpeRatio: 0, maxDrawdown: 0, totalTrades: 0 },
    score: 0,
  };

  logger.info({ strategyId, bestScore: best.score, top20: top20.length }, "Optimizer: complete");

  return {
    strategyId,
    symbol,
    bestConfig:  best,
    top20,
    totalTested: results.length,
    computedAt:  new Date().toISOString(),
    searchSpace,
  };
}
