/**
 * executionAnalytics.ts — Phase 9.0 Execution Quality Engine
 *
 * Tracks per-trade execution quality: slippage, spread, fill quality,
 * latency, and execution cost. Maintains an in-memory ring buffer of
 * recent execution records and computes rolling averages.
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExecutionRecord {
  tradeId:         string;
  symbol:          string;
  side:            "buy" | "sell";
  intendedPrice:   number;
  filledPrice:     number;
  slippagePct:     number;     // (filled - intended) / intended * 100
  slippageUsdt:    number;
  spread:          number;     // ask - bid at time of entry
  spreadPct:       number;
  fillQuality:     number;     // 0-100 score
  latencyMs:       number;
  executionCostPct: number;    // (slippage + fee) / notional * 100
  feePct:          number;
  notionalUsdt:    number;
  timestamp:       string;
}

export interface ExecutionSummary {
  totalTrades:        number;
  avgSlippagePct:     number;
  avgSpreadPct:       number;
  avgFillQuality:     number;
  avgLatencyMs:       number;
  avgExecutionCostPct: number;
  totalSlippageCost:  number;   // cumulative USDT lost to slippage
  totalFeeCost:       number;
  bestFill:           ExecutionRecord | null;
  worstFill:          ExecutionRecord | null;
  recent:             ExecutionRecord[];
  computedAt:         string;
}

// ─── Fill quality scoring ──────────────────────────────────────────────────────

function scoreFillQuality(slippagePct: number, latencyMs: number, spreadPct: number): number {
  let score = 100;
  score -= Math.min(40, Math.abs(slippagePct) * 10);   // -10 pts per 1% slippage
  score -= Math.min(20, latencyMs / 100);              // -1 pt per 100ms
  score -= Math.min(20, spreadPct * 5);                // -5 pts per 1% spread
  return Math.max(0, Math.round(score));
}

// ─── Service class ────────────────────────────────────────────────────────────

class ExecutionAnalyticsService {
  private records: ExecutionRecord[] = [];
  private readonly maxRecords = 500;

  /** Record a new execution */
  record(data: {
    tradeId:       string;
    symbol:        string;
    side:          "buy" | "sell";
    intendedPrice: number;
    filledPrice:   number;
    spread:        number;
    latencyMs:     number;
    feePct:        number;
    notionalUsdt:  number;
  }): ExecutionRecord {
    const { tradeId, symbol, side, intendedPrice, filledPrice, spread, latencyMs, feePct, notionalUsdt } = data;

    const slippagePct  = intendedPrice > 0 ? ((filledPrice - intendedPrice) / intendedPrice) * 100 : 0;
    const slippageUsdt = (Math.abs(slippagePct) / 100) * notionalUsdt;
    const spreadPct    = intendedPrice > 0 ? (spread / intendedPrice) * 100 : 0;
    const executionCostPct = Math.abs(slippagePct) + feePct;
    const fillQuality  = scoreFillQuality(slippagePct, latencyMs, spreadPct);

    const rec: ExecutionRecord = {
      tradeId,
      symbol,
      side,
      intendedPrice:   Math.round(intendedPrice * 1e6) / 1e6,
      filledPrice:     Math.round(filledPrice * 1e6) / 1e6,
      slippagePct:     Math.round(slippagePct * 10000) / 10000,
      slippageUsdt:    Math.round(slippageUsdt * 100) / 100,
      spread:          Math.round(spread * 1e6) / 1e6,
      spreadPct:       Math.round(spreadPct * 10000) / 10000,
      fillQuality,
      latencyMs:       Math.round(latencyMs),
      executionCostPct: Math.round(executionCostPct * 10000) / 10000,
      feePct,
      notionalUsdt:    Math.round(notionalUsdt * 100) / 100,
      timestamp:       new Date().toISOString(),
    };

    this.records.unshift(rec);
    if (this.records.length > this.maxRecords) this.records.length = this.maxRecords;

    logger.info({ tradeId, symbol, slippagePct: rec.slippagePct, fillQuality }, "ExecutionAnalytics: trade recorded");
    return rec;
  }

  /** Get aggregated summary */
  getSummary(limit = 100): ExecutionSummary {
    const recs = this.records.slice(0, limit);
    if (recs.length === 0) {
      return {
        totalTrades: 0, avgSlippagePct: 0, avgSpreadPct: 0,
        avgFillQuality: 0, avgLatencyMs: 0, avgExecutionCostPct: 0,
        totalSlippageCost: 0, totalFeeCost: 0,
        bestFill: null, worstFill: null,
        recent: [], computedAt: new Date().toISOString(),
      };
    }

    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

    return {
      totalTrades:         recs.length,
      avgSlippagePct:      Math.round(avg(recs.map((r) => Math.abs(r.slippagePct))) * 10000) / 10000,
      avgSpreadPct:        Math.round(avg(recs.map((r) => r.spreadPct)) * 10000) / 10000,
      avgFillQuality:      Math.round(avg(recs.map((r) => r.fillQuality))),
      avgLatencyMs:        Math.round(avg(recs.map((r) => r.latencyMs))),
      avgExecutionCostPct: Math.round(avg(recs.map((r) => r.executionCostPct)) * 10000) / 10000,
      totalSlippageCost:   Math.round(recs.reduce((s, r) => s + r.slippageUsdt, 0) * 100) / 100,
      totalFeeCost:        Math.round(recs.reduce((s, r) => s + (r.feePct / 100) * r.notionalUsdt, 0) * 100) / 100,
      bestFill:            recs.reduce((best, r) => r.fillQuality > (best?.fillQuality ?? -1) ? r : best, null as ExecutionRecord | null),
      worstFill:           recs.reduce((worst, r) => r.fillQuality < (worst?.fillQuality ?? 101) ? r : worst, null as ExecutionRecord | null),
      recent:              recs.slice(0, 20),
      computedAt:          new Date().toISOString(),
    };
  }

  getRecords(limit = 100): ExecutionRecord[] { return this.records.slice(0, limit); }
  clear(): void { this.records = []; }
}

export const executionAnalytics = new ExecutionAnalyticsService();
