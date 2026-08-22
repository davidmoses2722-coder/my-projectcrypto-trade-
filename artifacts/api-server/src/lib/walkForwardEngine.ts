/**
 * walkForwardEngine.ts — Phase 7.1 Walk-Forward Testing
 *
 * Prevents overfitting by splitting history into train/validate windows and
 * running the same strategy on each. Returns robustness and consistency scores.
 *
 * PURE COMPUTATION — no DB writes, no BullMQ, no live orders.
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WalkForwardSplit = 60 | 70 | 80;

export interface WalkForwardWindow {
  windowIndex:    number;
  trainStart:     string;
  trainEnd:       string;
  validateStart:  string;
  validateEnd:    string;
  trainReturn:    number;   // %
  validateReturn: number;   // %
  trainTrades:    number;
  validateTrades: number;
  trainWinRate:   number;
  validateWinRate: number;
  passed:         boolean;  // validate ≥ 50% of train performance
}

export interface WalkForwardResult {
  strategyId:        string;
  symbol:            string;
  trainSplitPct:     WalkForwardSplit;
  windows:           WalkForwardWindow[];
  avgTrainReturn:    number;
  avgValidateReturn: number;
  robustnessScore:   number;   // 0-100: how well validate tracks train
  consistencyScore:  number;   // 0-100: std-dev consistency across windows
  passRate:          number;   // % windows that passed
  verdict:           "robust" | "moderate" | "overfit" | "insufficient_data";
  computedAt:        string;
}

export interface WalkForwardParams {
  strategyId:    string;
  symbol:        string;
  trainSplitPct: WalkForwardSplit;
  candles:       Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  simulateFn:    (candles: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>, startIdx: number, endIdx: number) => { returnPct: number; trades: number; winRate: number };
}

// TypeScript needs the param type resolved; we inline it
export interface WalkForwardRunParams {
  strategyId:    string;
  symbol:        string;
  trainSplitPct: WalkForwardSplit;
  candles:       Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  simulateFn:    (startIdx: number, endIdx: number) => { returnPct: number; trades: number; winRate: number };
}

// ─── Core walk-forward logic ──────────────────────────────────────────────────

export function runWalkForward(params: WalkForwardRunParams): WalkForwardResult {
  const { strategyId, symbol, trainSplitPct, candles, simulateFn } = params;
  const n = candles.length;

  if (n < 200) {
    logger.warn({ n, strategyId }, "WalkForward: insufficient candles");
    return {
      strategyId,
      symbol,
      trainSplitPct,
      windows:           [],
      avgTrainReturn:    0,
      avgValidateReturn: 0,
      robustnessScore:   0,
      consistencyScore:  0,
      passRate:          0,
      verdict:           "insufficient_data",
      computedAt:        new Date().toISOString(),
    };
  }

  // Build non-overlapping walk-forward windows
  // We use anchored forward-walk: each window is 1/3 of data, shifted by 1/4
  const windowSizePct = trainSplitPct === 80 ? 40 : trainSplitPct === 70 ? 35 : 30;
  const windowSize    = Math.floor(n * (windowSizePct / 100));
  const trainSize     = Math.floor(windowSize * (trainSplitPct / 100));
  const valSize       = windowSize - trainSize;
  const stepSize      = Math.floor(windowSize * 0.25); // 25% step

  const windows: WalkForwardWindow[] = [];
  let start = 0;
  let idx   = 0;

  while (start + windowSize <= n) {
    const trainStart = start;
    const trainEnd   = start + trainSize;
    const valStart   = trainEnd;
    const valEnd     = valStart + valSize;

    const trainResult = simulateFn(trainStart, trainEnd);
    const valResult   = simulateFn(valStart, valEnd);

    // Passed = validate achieves ≥ 40% of train performance (or both negative)
    const passed =
      trainResult.returnPct <= 0
        ? valResult.returnPct <= 0
        : valResult.returnPct >= trainResult.returnPct * 0.4;

    windows.push({
      windowIndex:     idx,
      trainStart:      candles[trainStart]?.time ?? "",
      trainEnd:        candles[trainEnd - 1]?.time ?? "",
      validateStart:   candles[valStart]?.time ?? "",
      validateEnd:     candles[valEnd - 1]?.time ?? "",
      trainReturn:     Math.round(trainResult.returnPct * 100) / 100,
      validateReturn:  Math.round(valResult.returnPct * 100) / 100,
      trainTrades:     trainResult.trades,
      validateTrades:  valResult.trades,
      trainWinRate:    Math.round(trainResult.winRate * 10) / 10,
      validateWinRate: Math.round(valResult.winRate * 10) / 10,
      passed,
    });

    start += stepSize;
    idx++;
    if (idx >= 8) break; // max 8 windows
  }

  if (windows.length === 0) {
    return {
      strategyId, symbol, trainSplitPct,
      windows: [], avgTrainReturn: 0, avgValidateReturn: 0,
      robustnessScore: 0, consistencyScore: 0, passRate: 0,
      verdict: "insufficient_data",
      computedAt: new Date().toISOString(),
    };
  }

  const avgTrain    = windows.reduce((s, w) => s + w.trainReturn, 0)    / windows.length;
  const avgValidate = windows.reduce((s, w) => s + w.validateReturn, 0) / windows.length;
  const passRate    = (windows.filter((w) => w.passed).length / windows.length) * 100;

  // Robustness: ratio of validate/train returns (capped 0-100)
  const rawRobustness = avgTrain > 0
    ? Math.min(1, Math.max(0, avgValidate / avgTrain))
    : avgValidate >= 0 ? 0.5 : 0;
  const robustnessScore = Math.round(rawRobustness * 100);

  // Consistency: lower std-dev of validate returns = higher score
  const valReturns = windows.map((w) => w.validateReturn);
  const valMean    = valReturns.reduce((s, v) => s + v, 0) / valReturns.length;
  const valStd     = Math.sqrt(valReturns.reduce((s, v) => s + (v - valMean) ** 2, 0) / valReturns.length);
  const consistencyScore = Math.round(Math.max(0, 100 - valStd * 5));

  const combined = (robustnessScore + consistencyScore + passRate) / 3;
  const verdict: WalkForwardResult["verdict"] =
    combined >= 70 ? "robust"    :
    combined >= 45 ? "moderate"  :
    windows.length < 3 ? "insufficient_data" : "overfit";

  logger.info({ strategyId, windows: windows.length, robustnessScore, consistencyScore, verdict }, "WalkForward: completed");

  return {
    strategyId, symbol, trainSplitPct,
    windows,
    avgTrainReturn:    Math.round(avgTrain * 100) / 100,
    avgValidateReturn: Math.round(avgValidate * 100) / 100,
    robustnessScore,
    consistencyScore,
    passRate:          Math.round(passRate * 10) / 10,
    verdict,
    computedAt: new Date().toISOString(),
  };
}
