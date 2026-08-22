/**
 * strategyRankingService.ts — Phase 7 Strategy Ranking System
 *
 * Reads trade history and computes per-strategy performance metrics.
 * Produces a ranking score and marks poor performers so the orchestrator
 * can reduce allocation to weak strategies.
 *
 * PURE ADVISORY — reads trade data only, never touches execution.
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrategyMetrics {
  strategyId:    string;
  strategyName:  string;
  totalTrades:   number;
  winRate:       number;       // 0-100
  profitFactor:  number;       // gross profit / gross loss
  sharpeRatio:   number;
  netPnl:        number;       // USDT
  maxDrawdown:   number;       // % (positive number)
  pnl30d:        number;       // last 30 days USDT
  pnl90d:        number;       // last 90 days USDT
  rankScore:     number;       // composite 0-100
  tier:          "elite" | "strong" | "average" | "weak" | "poor";
  allocationMod: number;       // multiplier for orchestrator: 0.0 – 1.5
  lastTrade:     string | null;
}

export interface StrategyRankingResult {
  rankings:    StrategyMetrics[];
  computedAt:  string;
  totalTrades: number;
  bestStrategy:  string | null;
  worstStrategy: string | null;
}

// ─── Simple trade record (matches what the DB/bot exposes) ────────────────────

export interface TradeSummary {
  strategyId:   string;
  pnlUsd:       number;
  closedAt:     string | null;   // ISO timestamp
  status:       string;          // "closed" | "open" | ...
}

// ─── Scoring weights ──────────────────────────────────────────────────────────

const W = {
  winRate:      0.25,
  profitFactor: 0.25,
  sharpe:       0.20,
  pnl30d:       0.15,
  drawdown:     0.15,   // inverse — lower drawdown = higher score
};

const STRATEGY_NAMES: Record<string, string> = {
  "scalping":    "Scalping",
  "day-trading": "Day Trading",
  "swing":       "Swing",
  "dca":         "DCA",
  "grid":        "Grid",
};

// ─── Core computation ─────────────────────────────────────────────────────────

function computeMetrics(strategyId: string, trades: TradeSummary[]): StrategyMetrics {
  const closed = trades.filter((t) => t.status === "closed" && t.closedAt);
  const name   = STRATEGY_NAMES[strategyId] ?? strategyId;

  if (closed.length === 0) {
    return {
      strategyId,
      strategyName:  name,
      totalTrades:   0,
      winRate:       0,
      profitFactor:  0,
      sharpeRatio:   0,
      netPnl:        0,
      maxDrawdown:   0,
      pnl30d:        0,
      pnl90d:        0,
      rankScore:     0,
      tier:          "poor",
      allocationMod: 0.5,
      lastTrade:     null,
    };
  }

  const now   = Date.now();
  const d30   = now - 30 * 24 * 3600 * 1000;
  const d90   = now - 90 * 24 * 3600 * 1000;

  const wins    = closed.filter((t) => t.pnlUsd > 0);
  const losses  = closed.filter((t) => t.pnlUsd <= 0);
  const winRate = (wins.length / closed.length) * 100;

  const grossWin  = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const pf        = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  const netPnl = closed.reduce((s, t) => s + t.pnlUsd, 0);
  const pnl30d = closed
    .filter((t) => new Date(t.closedAt!).getTime() >= d30)
    .reduce((s, t) => s + t.pnlUsd, 0);
  const pnl90d = closed
    .filter((t) => new Date(t.closedAt!).getTime() >= d90)
    .reduce((s, t) => s + t.pnlUsd, 0);

  // Running drawdown from cumulative equity curve
  let peak = 0;
  let equity = 0;
  let maxDD = 0;
  for (const t of closed) {
    equity += t.pnlUsd;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe: mean daily pnl / stddev (simplified)
  const pnls   = closed.map((t) => t.pnlUsd);
  const mean   = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length;
  const stddev = Math.sqrt(variance);
  const sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(252) : 0;

  const lastTrade = closed[closed.length - 1]?.closedAt ?? null;

  // ── Rank score ──────────────────────────────────────────────────────────────
  const winNorm = Math.min(100, winRate);
  const pfNorm  = Math.min(100, pf * 20);           // PF of 5 → 100
  const shNorm  = Math.min(100, Math.max(0, (sharpe + 3) * 16.7)); // -3 to 3 → 0-100
  const p30Norm = Math.min(100, Math.max(0, pnl30d / 10 + 50));    // ±$500 range
  const ddNorm  = Math.max(0, 100 - maxDD * 2);     // 0% dd → 100, 50% dd → 0

  const rankScore = Math.round(
    winNorm   * W.winRate +
    pfNorm    * W.profitFactor +
    shNorm    * W.sharpe +
    p30Norm   * W.pnl30d +
    ddNorm    * W.drawdown,
  );

  const tier: StrategyMetrics["tier"] =
    rankScore >= 80 ? "elite"   :
    rankScore >= 65 ? "strong"  :
    rankScore >= 45 ? "average" :
    rankScore >= 25 ? "weak"    : "poor";

  const allocationMod =
    tier === "elite"   ? 1.5 :
    tier === "strong"  ? 1.2 :
    tier === "average" ? 1.0 :
    tier === "weak"    ? 0.6 : 0.3;

  return {
    strategyId,
    strategyName:  name,
    totalTrades:   closed.length,
    winRate:       Math.round(winRate * 10) / 10,
    profitFactor:  Math.round(pf * 100) / 100,
    sharpeRatio:   Math.round(sharpe * 100) / 100,
    netPnl:        Math.round(netPnl * 100) / 100,
    maxDrawdown:   Math.round(maxDD * 10) / 10,
    pnl30d:        Math.round(pnl30d * 100) / 100,
    pnl90d:        Math.round(pnl90d * 100) / 100,
    rankScore:     Math.max(0, Math.min(100, rankScore)),
    tier,
    allocationMod,
    lastTrade,
  };
}

// ─── Service class ────────────────────────────────────────────────────────────

class StrategyRankingService {
  private cache: StrategyRankingResult | null = null;
  private cacheTs = 0;
  private readonly TTL_MS = 60_000; // 1 minute cache

  compute(trades: TradeSummary[]): StrategyRankingResult {
    const now = Date.now();
    if (this.cache && now - this.cacheTs < this.TTL_MS) return this.cache;

    const strategyIds = ["scalping", "day-trading", "swing", "dca", "grid"];
    const tradesByStrategy = new Map<string, TradeSummary[]>();

    for (const id of strategyIds) tradesByStrategy.set(id, []);

    for (const t of trades) {
      const list = tradesByStrategy.get(t.strategyId);
      if (list) list.push(t);
      else tradesByStrategy.set(t.strategyId, [t]);
    }

    const rankings: StrategyMetrics[] = strategyIds
      .map((id) => computeMetrics(id, tradesByStrategy.get(id) ?? []))
      .sort((a, b) => b.rankScore - a.rankScore);

    const best  = rankings[0]?.totalTrades > 0 ? rankings[0]!.strategyId  : null;
    const worst = rankings[rankings.length - 1]?.totalTrades > 0
      ? rankings[rankings.length - 1]!.strategyId : null;

    const result: StrategyRankingResult = {
      rankings,
      computedAt:    new Date().toISOString(),
      totalTrades:   trades.filter((t) => t.status === "closed").length,
      bestStrategy:  best,
      worstStrategy: worst,
    };

    this.cache   = result;
    this.cacheTs = now;
    logger.info({ strategies: rankings.length }, "StrategyRanking: computed rankings");
    return result;
  }

  /** Invalidate cache on new trade close */
  invalidate(): void { this.cacheTs = 0; }

  /** Get allocation modifier for a strategy (used by orchestrator) */
  getAllocationModifier(strategyId: string): number {
    if (!this.cache) return 1.0;
    return this.cache.rankings.find((r) => r.strategyId === strategyId)?.allocationMod ?? 1.0;
  }
}

export const strategyRankingService = new StrategyRankingService();
