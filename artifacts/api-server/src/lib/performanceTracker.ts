/**
 * performanceTracker — long-term analytics cache.
 *
 * - Periodically pulls DB trades (every REFRESH_MS).
 * - Merges with in-memory session trades via analytics.normaliseTrades().
 * - Caches computed metrics for synchronous access inside buildStatus().
 * - Schedules enriched Telegram daily report (7-day and 30-day summaries).
 */

import { logger }           from "./logger";
import * as store            from "./store";
import { normaliseTrades, buildSnapshot }   from "./analytics";
import type { AnalyticsMetrics } from "./analytics";

// ─── Public snapshot ──────────────────────────────────────────────────────────

export interface PerfSnapshot {
  totalTrades:     number;
  winRate:         number;   // 0–100 %
  profitFactor:    number;
  avgTradeReturn:  number;   // avg pnlPct of closed trades
  avgHoldMins:     number;
  maxDrawdownPct:  number;
  totalPnlUsd:     number;
  weekly7dPnl:     number;
  monthly30dPnl:   number;
  /** ROI since the current session started (balance change / starting balance). */
  sessionRoiPct:   number;
  computedAt:      string;
}

const EMPTY: PerfSnapshot = {
  totalTrades: 0, winRate: 0, profitFactor: 0, avgTradeReturn: 0,
  avgHoldMins: 0, maxDrawdownPct: 0, totalPnlUsd: 0,
  weekly7dPnl: 0, monthly30dPnl: 0, sessionRoiPct: 0,
  computedAt: new Date().toISOString(),
};

// ─── Internal state ───────────────────────────────────────────────────────────

const REFRESH_MS = 5 * 60_000; // recompute every 5 minutes

let cached: PerfSnapshot = { ...EMPTY };
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

type GetMemTrades = () => {
  id: string | number; symbol: string; pnlUsd: number; pnlPct: number;
  reason: string; holdMins?: number; time: string; dryRun?: boolean;
}[];

type GetState = () => {
  memTrades:      ReturnType<GetMemTrades>;
  startingBalance: number;
  currentBalance:  number;
};

let getState: GetState | null = null;

// ─── Computation ──────────────────────────────────────────────────────────────

async function recompute(): Promise<void> {
  if (!getState) return;
  try {
    const { memTrades, startingBalance, currentBalance } = getState();
    const dbTrades  = await store.listTrades(500);
    const normalised = normaliseTrades(memTrades, dbTrades);

    if (normalised.length === 0) {
      cached = { ...EMPTY, computedAt: new Date().toISOString() };
      return;
    }

    const snap     = buildSnapshot(normalised);
    const m: AnalyticsMetrics = snap.metrics;

    // 7-day and 30-day PnL from equity points
    const now7d  = Date.now() - 7  * 24 * 3600_000;
    const now30d = Date.now() - 30 * 24 * 3600_000;
    const weekly7dPnl  = normalised
      .filter(t => new Date(t.time).getTime() >= now7d)
      .reduce((s, t) => s + t.pnlUsd, 0);
    const monthly30dPnl = normalised
      .filter(t => new Date(t.time).getTime() >= now30d)
      .reduce((s, t) => s + t.pnlUsd, 0);

    const sessionRoiPct = startingBalance > 0
      ? ((currentBalance - startingBalance) / startingBalance) * 100
      : 0;

    cached = {
      totalTrades:    m.totalTrades,
      winRate:        m.winRate,
      profitFactor:   m.profitFactor,
      avgTradeReturn: m.expectancy,
      avgHoldMins:    m.avgHoldMins,
      maxDrawdownPct: m.maxDrawdownPct,
      totalPnlUsd:    m.totalPnlUsd,
      weekly7dPnl,
      monthly30dPnl,
      sessionRoiPct,
      computedAt:     new Date().toISOString(),
    };
  } catch (err) {
    logger.warn({ err }, "performanceTracker: recompute failed");
  }
}

function scheduleNext(): void {
  refreshTimer = setTimeout(() => {
    void recompute().finally(() => scheduleNext());
  }, REFRESH_MS);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Call once at server boot, passing a getter that reads live bot state. */
export function startTracker(fn: GetState): void {
  getState = fn;
  void recompute();   // initial pass
  scheduleNext();
}

/** Synchronously returns the last cached snapshot (never throws). */
export function getSnapshot(): PerfSnapshot {
  return cached;
}

/** Force an immediate recompute (call after each trade close). */
export function invalidate(): void {
  void recompute();
}

/** Returns a rich data bag for the Telegram daily report. */
export function getDailySummaryData(extra: {
  totalTrades: number; wins: number; losses: number;
  winRate: string; dailyPnl: number; openPositions: number; balance: number;
}) {
  return {
    ...extra,
    profitFactor:   cached.profitFactor.toFixed(2),
    maxDrawdownPct: cached.maxDrawdownPct.toFixed(2),
    weekly7dPnl:    cached.weekly7dPnl.toFixed(2),
    monthly30dPnl:  cached.monthly30dPnl.toFixed(2),
    sessionRoiPct:  cached.sessionRoiPct.toFixed(2),
  };
}
