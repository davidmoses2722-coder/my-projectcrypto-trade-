/**
 * Analytics Engine — pure computation, no side effects.
 * All functions accept normalised AnalyticsTrade[] and return typed objects.
 * No imports from bot.ts so this stays independent of trading logic.
 */

// ─── Input ────────────────────────────────────────────────────────────────────

/** Minimal DB trade shape — only the fields analytics actually reads. */
interface DbTrade {
  id:          number;
  symbol:      string;
  kind:        string;
  price:       string;
  pnlUsd:      string | null;
  pnlPct:      string | null;
  reason:      string | null;
  isPaper:     boolean;
  executedAt:  Date;
}

export interface AnalyticsTrade {
  id:       string;
  symbol:   string;
  pnlUsd:   number;
  pnlPct:   number;
  reason:   string;
  holdMins: number;
  time:     string;
  entry:    number;
  exit:     number;
  isPaper:  boolean;
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface AnalyticsMetrics {
  totalTrades:     number;
  wins:            number;
  losses:          number;
  breakevens:      number;
  winRate:         number;
  lossRate:        number;
  profitFactor:    number;
  expectancy:      number;
  avgWin:          number;
  avgLoss:         number;
  largestWin:      number;
  largestLoss:     number;
  avgHoldMins:     number;
  riskRewardRatio: number;
  sharpeRatio:     number;
  maxDrawdownPct:  number;
  totalPnlUsd:     number;
  grossWin:        number;
  grossLoss:       number;
}

export interface EquityPoint {
  time:   string;
  date:   string;
  pnlUsd: number;
  cumPnl: number;
}

export interface DailyEquity {
  date:     string;
  dailyPnl: number;
  cumPnl:   number;
  trades:   number;
  wins:     number;
}

export interface BreakdownSlice {
  label:    string;
  trades:   number;
  wins:     number;
  totalPnl: number;
  winRate:  number;
  avgPnl:   number;
}

export interface RollingPoint {
  date:       string;
  rolling7d:  number;
  rolling30d: number;
}

export interface HeatmapCell {
  date:   string;
  pnl:    number;
  trades: number;
}

export interface AiSnapshot {
  version:     number;
  timestamp:   string;
  metrics:     AnalyticsMetrics;
  topSymbols:  { symbol: string; pnl: number }[];
  topReasons:  { reason: string; count: number; pnl: number }[];
  recentTrades:{ time: string; pnl: number; symbol: string; reason: string }[];
  equityCurve: { date: string; cumPnl: number }[];
}

export interface AnalyticsSnapshot {
  metrics:           AnalyticsMetrics;
  equityCurve:       EquityPoint[];
  dailyEquity:       DailyEquity[];
  strategyBreakdown: BreakdownSlice[];
  symbolBreakdown:   BreakdownSlice[];
  rollingPnl:        RollingPoint[];
  heatmap:           HeatmapCell[];
  aiSnapshot:        AiSnapshot;
  tradeCount:        number;
  computedAt:        string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

function r(n: number, dp = 4): number {
  return +n.toFixed(dp);
}

// ─── Normalise ────────────────────────────────────────────────────────────────

interface MemTrade {
  id:        string | number;
  symbol:    string;
  pnlUsd:    number;
  pnlPct:    number;
  reason:    string;
  holdMins?: number;
  time:      string;
  entry?:    number;
  exit?:     number;
  dryRun?:   boolean;
}

/**
 * Merge in-memory and DB trades into a common format.
 * In-memory trades are richer (holdMins, entry/exit).
 * DB EXIT trades older than the oldest in-memory trade fill in history.
 */
export function normaliseTrades(
  memTrades: MemTrade[],
  dbTrades:  DbTrade[],
): AnalyticsTrade[] {
  const memNorm: AnalyticsTrade[] = memTrades.map((t) => ({
    id:       String(t.id),
    symbol:   t.symbol,
    pnlUsd:   t.pnlUsd,
    pnlPct:   t.pnlPct,
    reason:   t.reason ?? "unknown",
    holdMins: t.holdMins ?? 0,
    time:     t.time,
    entry:    t.entry ?? 0,
    exit:     t.exit ?? 0,
    isPaper:  t.dryRun ?? true,
  }));

  const oldestMemMs = memNorm.length
    ? Math.min(...memNorm.map((t) => new Date(t.time).getTime()))
    : Date.now();

  const dbNorm: AnalyticsTrade[] = dbTrades
    .filter((t) => t.kind === "EXIT" && t.pnlUsd != null)
    .filter((t) => new Date(t.executedAt).getTime() < oldestMemMs - 60_000)
    .map((t) => ({
      id:       String(t.id),
      symbol:   t.symbol,
      pnlUsd:   parseFloat(t.pnlUsd!),
      pnlPct:   t.pnlPct ? parseFloat(t.pnlPct) : 0,
      reason:   t.reason ?? "unknown",
      holdMins: 0,
      time:     t.executedAt.toISOString(),
      entry:    0,
      exit:     parseFloat(t.price),
      isPaper:  t.isPaper,
    }));

  return [...dbNorm, ...memNorm].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );
}

// ─── Core metrics ─────────────────────────────────────────────────────────────

const ZERO_METRICS: AnalyticsMetrics = {
  totalTrades: 0, wins: 0, losses: 0, breakevens: 0,
  winRate: 0, lossRate: 0, profitFactor: 0, expectancy: 0,
  avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0,
  avgHoldMins: 0, riskRewardRatio: 0, sharpeRatio: 0,
  maxDrawdownPct: 0, totalPnlUsd: 0, grossWin: 0, grossLoss: 0,
};

export function computeMetrics(trades: AnalyticsTrade[]): AnalyticsMetrics {
  if (!trades.length) return { ...ZERO_METRICS };

  const wins       = trades.filter((t) => t.pnlUsd > 0);
  const losses     = trades.filter((t) => t.pnlUsd < 0);
  const breakevens = trades.filter((t) => t.pnlUsd === 0);

  const grossWin  = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const totalPnl  = trades.reduce((s, t) => s + t.pnlUsd, 0);

  const avgWin  = wins.length   ? grossWin  / wins.length          : 0;
  const avgLoss = losses.length ? -(grossLoss / losses.length)     : 0;
  const winRate  = (wins.length   / trades.length) * 100;
  const lossRate = (losses.length / trades.length) * 100;

  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const expectancy   = (winRate / 100) * avgWin + (lossRate / 100) * avgLoss;
  const rrRatio      = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
  const avgHold      = mean(trades.map((t) => t.holdMins).filter((m) => m > 0));

  const largestWin  = wins.length   ? Math.max(...wins.map((t)   => t.pnlUsd)) : 0;
  const largestLoss = losses.length ? Math.min(...losses.map((t) => t.pnlUsd)) : 0;

  // Trade-level Sharpe (annualised)
  const returns = trades.map((t) => t.pnlUsd);
  const sharpe  = stdDev(returns) > 0
    ? (mean(returns) / stdDev(returns)) * Math.sqrt(252)
    : 0;

  // Max drawdown
  let cum = 0, peak = 0, maxDD = 0;
  for (const t of trades) {
    cum += t.pnlUsd;
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? (peak - cum) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    totalTrades:     trades.length,
    wins:            wins.length,
    losses:          losses.length,
    breakevens:      breakevens.length,
    winRate:         r(winRate, 2),
    lossRate:        r(lossRate, 2),
    profitFactor:    r(profitFactor, 3),
    expectancy:      r(expectancy, 4),
    avgWin:          r(avgWin, 4),
    avgLoss:         r(avgLoss, 4),
    largestWin:      r(largestWin, 4),
    largestLoss:     r(largestLoss, 4),
    avgHoldMins:     r(avgHold, 1),
    riskRewardRatio: r(rrRatio, 3),
    sharpeRatio:     r(sharpe, 3),
    maxDrawdownPct:  r(maxDD * 100, 2),
    totalPnlUsd:     r(totalPnl, 4),
    grossWin:        r(grossWin, 4),
    grossLoss:       r(grossLoss, 4),
  };
}

// ─── Equity curve ─────────────────────────────────────────────────────────────

export function computeEquityCurve(trades: AnalyticsTrade[]): EquityPoint[] {
  let cum = 0;
  return trades.map((t) => {
    cum += t.pnlUsd;
    return { time: t.time, date: isoDate(t.time), pnlUsd: r(t.pnlUsd), cumPnl: r(cum) };
  });
}

export function computeDailyEquity(trades: AnalyticsTrade[]): DailyEquity[] {
  const byDate = new Map<string, { pnl: number; trades: number; wins: number }>();
  for (const t of trades) {
    const d   = isoDate(t.time);
    const cur = byDate.get(d) ?? { pnl: 0, trades: 0, wins: 0 };
    cur.pnl    += t.pnlUsd;
    cur.trades += 1;
    if (t.pnlUsd > 0) cur.wins++;
    byDate.set(d, cur);
  }
  const sorted = [...byDate.keys()].sort();
  let cum = 0;
  return sorted.map((d) => {
    const row = byDate.get(d)!;
    cum += row.pnl;
    return { date: d, dailyPnl: r(row.pnl), cumPnl: r(cum), trades: row.trades, wins: row.wins };
  });
}

// ─── Rolling PnL ──────────────────────────────────────────────────────────────

export function computeRollingPnl(daily: DailyEquity[]): RollingPoint[] {
  return daily.map((_, i) => ({
    date:       daily[i].date,
    rolling7d:  r(daily.slice(Math.max(0, i - 6),  i + 1).reduce((s, d) => s + d.dailyPnl, 0)),
    rolling30d: r(daily.slice(Math.max(0, i - 29), i + 1).reduce((s, d) => s + d.dailyPnl, 0)),
  }));
}

// ─── Breakdowns ───────────────────────────────────────────────────────────────

function buildSlices(
  trades: AnalyticsTrade[],
  key:    (t: AnalyticsTrade) => string,
): BreakdownSlice[] {
  const map = new Map<string, { t: number; w: number; pnl: number }>();
  for (const t of trades) {
    const k   = key(t) || "unknown";
    const cur = map.get(k) ?? { t: 0, w: 0, pnl: 0 };
    cur.t++;
    if (t.pnlUsd > 0) cur.w++;
    cur.pnl += t.pnlUsd;
    map.set(k, cur);
  }
  return [...map.entries()]
    .map(([label, v]) => ({
      label,
      trades:   v.t,
      wins:     v.w,
      totalPnl: r(v.pnl),
      winRate:  r(v.w / v.t * 100, 1),
      avgPnl:   r(v.pnl / v.t),
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

export function computeStrategyBreakdown(trades: AnalyticsTrade[]): BreakdownSlice[] {
  return buildSlices(trades, (t) => t.reason);
}

export function computeSymbolBreakdown(trades: AnalyticsTrade[]): BreakdownSlice[] {
  return buildSlices(trades, (t) => t.symbol);
}

// ─── Heatmap (last 90 trading days) ──────────────────────────────────────────

export function computeHeatmap(trades: AnalyticsTrade[]): HeatmapCell[] {
  const byDate = new Map<string, { pnl: number; trades: number }>();
  for (const t of trades) {
    const d   = isoDate(t.time);
    const cur = byDate.get(d) ?? { pnl: 0, trades: 0 };
    cur.pnl    += t.pnlUsd;
    cur.trades++;
    byDate.set(d, cur);
  }
  return [...byDate.entries()]
    .map(([date, v]) => ({ date, pnl: r(v.pnl), trades: v.trades }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-90);
}

// ─── AI-ready snapshot ────────────────────────────────────────────────────────

export function buildAiSnapshot(
  metrics:  AnalyticsMetrics,
  trades:   AnalyticsTrade[],
  equity:   EquityPoint[],
  strategy: BreakdownSlice[],
  symbol:   BreakdownSlice[],
): AiSnapshot {
  const stride = Math.max(1, Math.floor(equity.length / 50));
  return {
    version:      1,
    timestamp:    new Date().toISOString(),
    metrics,
    topSymbols:   symbol.slice(0, 5).map((s)  => ({ symbol: s.label, pnl: s.totalPnl })),
    topReasons:   strategy.slice(0, 5).map((s) => ({ reason: s.label, count: s.trades, pnl: s.totalPnl })),
    recentTrades: trades.slice(-20).map((t)    => ({ time: t.time, pnl: t.pnlUsd, symbol: t.symbol, reason: t.reason })),
    equityCurve:  equity.filter((_, i) => i % stride === 0).map((p) => ({ date: p.date, cumPnl: p.cumPnl })),
  };
}

// ─── Full snapshot builder ────────────────────────────────────────────────────

export function buildSnapshot(trades: AnalyticsTrade[]): AnalyticsSnapshot {
  const metrics  = computeMetrics(trades);
  const equity   = computeEquityCurve(trades);
  const daily    = computeDailyEquity(trades);
  const rolling  = computeRollingPnl(daily);
  const strategy = computeStrategyBreakdown(trades);
  const symbol   = computeSymbolBreakdown(trades);
  const heatmap  = computeHeatmap(trades);
  const ai       = buildAiSnapshot(metrics, trades, equity, strategy, symbol);

  return {
    metrics,
    equityCurve:       equity,
    dailyEquity:       daily,
    strategyBreakdown: strategy,
    symbolBreakdown:   symbol,
    rollingPnl:        rolling,
    heatmap,
    aiSnapshot:        ai,
    tradeCount:        trades.length,
    computedAt:        new Date().toISOString(),
  };
}
