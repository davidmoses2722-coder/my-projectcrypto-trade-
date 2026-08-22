/**
 * livePerformanceVerifier.ts — Phase 10.1 Live Performance Verification
 *
 * Compares live trading results against backtest expectations and paper trading.
 * Detects strategy degradation, slippage impact, and drift from projected returns.
 * Alerts when live performance deviates significantly from backtest baselines.
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PerformanceLayer = "backtest" | "paper" | "live";

export interface PerformanceSnapshot {
  layer:         PerformanceLayer;
  strategyId:    string;
  period:        string;   // e.g. "30d"
  totalTrades:   number;
  winRate:       number;
  netReturnPct:  number;
  profitFactor:  number;
  sharpeRatio:   number;
  maxDrawdownPct: number;
  avgSlippagePct: number;
  recordedAt:    string;
}

export interface DriftReport {
  strategyId:      string;
  period:          string;
  backtestReturn:  number | null;
  paperReturn:     number | null;
  liveReturn:      number | null;
  btToLiveDrift:   number | null;   // live - backtest (pp)
  paperToLiveDrift: number | null;  // live - paper (pp)
  slippageImpact:  number | null;   // estimated performance drag from slippage
  degradationRisk: "none" | "low" | "moderate" | "high" | "critical";
  alerts:          string[];
  computedAt:      string;
}

export interface VerificationReport {
  snapshots:   PerformanceSnapshot[];
  driftReport: DriftReport[];
  overallHealth: "excellent" | "good" | "degrading" | "critical";
  computedAt: string;
}

// ─── Drift thresholds ─────────────────────────────────────────────────────────

const DRIFT_THRESHOLDS = {
  low:      2,   // 2pp drift = low concern
  moderate: 5,   // 5pp drift = moderate concern
  high:     10,  // 10pp drift = high concern
  critical: 20,  // 20pp drift = critical
};

function classifyDrift(drift: number | null): DriftReport["degradationRisk"] {
  if (drift === null) return "none";
  const abs = Math.abs(drift);
  if (abs >= DRIFT_THRESHOLDS.critical) return "critical";
  if (abs >= DRIFT_THRESHOLDS.high)     return "high";
  if (abs >= DRIFT_THRESHOLDS.moderate) return "moderate";
  if (abs >= DRIFT_THRESHOLDS.low)      return "low";
  return "none";
}

// ─── Service class ────────────────────────────────────────────────────────────

class LivePerformanceVerifier {
  private snapshots: PerformanceSnapshot[] = [];

  /** Register a performance snapshot (called after backtest runs, paper period ends, or on demand) */
  recordSnapshot(snap: Omit<PerformanceSnapshot, "recordedAt">): void {
    this.snapshots.push({ ...snap, recordedAt: new Date().toISOString() });
    // Keep last 200 snapshots
    if (this.snapshots.length > 200) this.snapshots.shift();
    logger.info({ layer: snap.layer, strategyId: snap.strategyId, netReturn: snap.netReturnPct }, "PerfVerifier: snapshot recorded");
  }

  /** Get all snapshots, optionally filtered */
  getSnapshots(filter?: { layer?: PerformanceLayer; strategyId?: string; period?: string }): PerformanceSnapshot[] {
    let s = [...this.snapshots];
    if (filter?.layer)      s = s.filter((x) => x.layer === filter.layer);
    if (filter?.strategyId) s = s.filter((x) => x.strategyId === filter.strategyId);
    if (filter?.period)     s = s.filter((x) => x.period === filter.period);
    return s.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  /** Compute drift report for a strategy over a given period */
  computeDrift(strategyId: string, period = "30d"): DriftReport {
    const latest = (layer: PerformanceLayer): PerformanceSnapshot | null => {
      const matches = this.snapshots.filter((s) => s.strategyId === strategyId && s.layer === layer && s.period === period);
      return matches.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0] ?? null;
    };

    const bt    = latest("backtest");
    const paper = latest("paper");
    const live  = latest("live");

    const btToLiveDrift    = bt && live ? Math.round((live.netReturnPct - bt.netReturnPct) * 100) / 100 : null;
    const paperToLiveDrift = paper && live ? Math.round((live.netReturnPct - paper.netReturnPct) * 100) / 100 : null;
    const slippageImpact   = live ? Math.round(-live.avgSlippagePct * live.totalTrades * 0.1 * 100) / 100 : null;

    const riskBt    = classifyDrift(btToLiveDrift);
    const riskPaper = classifyDrift(paperToLiveDrift);
    const riskOrder = ["none", "low", "moderate", "high", "critical"];
    const degradationRisk = riskOrder[Math.max(riskOrder.indexOf(riskBt), riskOrder.indexOf(riskPaper))] as DriftReport["degradationRisk"];

    const alerts: string[] = [];
    if (btToLiveDrift !== null && btToLiveDrift <= -DRIFT_THRESHOLDS.high) {
      alerts.push(`⚠️ Live return is ${Math.abs(btToLiveDrift).toFixed(1)}pp below backtest — strategy may be degrading`);
    }
    if (paperToLiveDrift !== null && paperToLiveDrift <= -DRIFT_THRESHOLDS.moderate) {
      alerts.push(`⚠️ Live underperforms paper by ${Math.abs(paperToLiveDrift).toFixed(1)}pp — check execution quality`);
    }
    if (slippageImpact !== null && slippageImpact < -2) {
      alerts.push(`⚠️ Estimated slippage drag: ${Math.abs(slippageImpact).toFixed(2)}pp — consider limit orders`);
    }
    if (live && bt && live.winRate < bt.winRate - 10) {
      alerts.push(`⚠️ Live win rate (${live.winRate.toFixed(0)}%) is ${(bt.winRate - live.winRate).toFixed(0)}pp below backtest`);
    }

    return {
      strategyId, period,
      backtestReturn:  bt    ? bt.netReturnPct    : null,
      paperReturn:     paper ? paper.netReturnPct  : null,
      liveReturn:      live  ? live.netReturnPct   : null,
      btToLiveDrift,
      paperToLiveDrift,
      slippageImpact,
      degradationRisk,
      alerts,
      computedAt: new Date().toISOString(),
    };
  }

  /** Full verification report across all strategies */
  getVerificationReport(strategyIds = ["scalping", "day-trading", "swing", "dca", "grid"], period = "30d"): VerificationReport {
    const driftReport = strategyIds.map((id) => this.computeDrift(id, period));
    const riskLevels  = driftReport.map((d) => d.degradationRisk);
    const hasCritical = riskLevels.includes("critical");
    const hasHigh     = riskLevels.includes("high");
    const hasModerate = riskLevels.includes("moderate");

    const overallHealth: VerificationReport["overallHealth"] =
      hasCritical ? "critical"   :
      hasHigh     ? "degrading"  :
      hasModerate ? "good"       : "excellent";

    return {
      snapshots:    this.snapshots.slice(-50),
      driftReport,
      overallHealth,
      computedAt:   new Date().toISOString(),
    };
  }
}

export const livePerformanceVerifier = new LivePerformanceVerifier();
