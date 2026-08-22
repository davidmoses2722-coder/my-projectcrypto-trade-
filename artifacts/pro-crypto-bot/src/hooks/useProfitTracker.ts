/**
 * useProfitTracker — Real-time Profit Analytics Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Derives rich performance metrics from a Trade[] array:
 *   • Equity curve (cumulative realized PnL over time)
 *   • Drawdown curve
 *   • Win/loss streaks
 *   • Sharpe ratio (approximate, using daily returns)
 *   • Profit factor (gross wins / gross losses)
 *   • Average R:R
 *   • Best / worst trade
 *   • Daily / weekly / monthly breakdown
 *   • Fee impact analysis
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from "react";
import { Trade } from "../types/crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EquityPoint {
  time:       string;   // ISO date string
  equity:     number;   // cumulative realized PnL
  drawdown:   number;   // drawdown from peak (negative)
  drawdownPct:number;
  tradeCount: number;
}

export interface DayStats {
  date:      string;
  pnl:       number;
  trades:    number;
  wins:      number;
  losses:    number;
  fees:      number;
}

export interface ProfitStats {
  // ── Core metrics ──────────────────────────────────────────────────────────
  totalRealised:     number;   // sum of closed trade net PnL
  totalUnrealized:   number;   // sum of open trade PnL
  totalGross:        number;   // before fees
  totalFees:         number;
  totalNet:          number;   // after fees

  // ── Win / Loss ────────────────────────────────────────────────────────────
  totalTrades:       number;
  openTrades:        number;
  closedTrades:      number;
  wins:              number;
  losses:            number;
  winRate:           number;   // 0-100

  // ── Averages ─────────────────────────────────────────────────────────────
  avgWin:            number;
  avgLoss:           number;
  avgTrade:          number;
  avgDuration:       number;   // ms

  // ── Risk metrics ─────────────────────────────────────────────────────────
  profitFactor:      number;   // gross wins / gross losses
  sharpeRatio:       number;   // approximate
  maxDrawdown:       number;   // max peak-to-trough in USDT
  maxDrawdownPct:    number;
  currentDrawdown:   number;
  peakEquity:        number;

  // ── Streaks ───────────────────────────────────────────────────────────────
  currentStreak:     number;   // + = wins, - = losses
  maxWinStreak:      number;
  maxLossStreak:     number;

  // ── Best / Worst ──────────────────────────────────────────────────────────
  bestTrade:         Trade | null;
  worstTrade:        Trade | null;
  bestDay:           DayStats | null;
  worstDay:          DayStats | null;

  // ── Coin breakdown ───────────────────────────────────────────────────────
  bySymbol:          Record<string, { pnl: number; trades: number; wins: number; fees: number }>;

  // ── Time series ──────────────────────────────────────────────────────────
  equityCurve:       EquityPoint[];
  dailyStats:        DayStats[];

  // ── Today ─────────────────────────────────────────────────────────────────
  todayPnL:          number;
  todayTrades:       number;
  weekPnL:           number;
  monthPnL:          number;

  // ── Fee impact ───────────────────────────────────────────────────────────
  feeImpact:         number;   // % of gross profit eaten by fees
  realTrades:        number;   // count of live Binance trades
  simTrades:         number;   // count of simulated trades
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

function monthAgo(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useProfitTracker(trades: Trade[]): ProfitStats {
  return useMemo<ProfitStats>(() => {
    const closed = trades.filter(t => t.status === "closed");
    const open   = trades.filter(t => t.status === "open");

    if (trades.length === 0) {
      return EMPTY_STATS;
    }

    // ── Closed trade metrics ──────────────────────────────────────────────
    const wins   = closed.filter(t => (t.pnl ?? 0) > 0);
    const losses = closed.filter(t => (t.pnl ?? 0) <= 0);

    const grossWins   = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
    const totalFees   = trades.reduce((s, t) => s + (t.fees ?? 0), 0);
    const totalGross  = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const totalNet    = closed.reduce((s, t) => s + (t.realised ?? t.pnl ?? 0), 0);
    const unrealized  = open.reduce((s, t) => s + (t.pnl ?? 0), 0);

    const avgWin  = wins.length   ? grossWins / wins.length   : 0;
    const avgLoss = losses.length ? -grossLosses / losses.length : 0;
    const avgTrade = closed.length ? totalGross / closed.length : 0;
    const avgDuration = closed.filter(t => t.duration).reduce((s, t) => s + (t.duration ?? 0), 0)
      / (closed.filter(t => t.duration).length || 1);

    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;
    const winRate      = closed.length ? (wins.length / closed.length) * 100 : 0;

    // ── Equity curve + drawdown ───────────────────────────────────────────
    const sorted = [...closed].sort((a, b) =>
      (a.exitTime ?? a.timestamp).getTime() - (b.exitTime ?? b.timestamp).getTime()
    );

    let runningPnL  = 0;
    let peakEquity  = 0;
    let maxDD       = 0;
    let maxDDPct    = 0;
    let currentDD   = 0;

    const equityCurve: EquityPoint[] = [];

    sorted.forEach((t, i) => {
      runningPnL += (t.realised ?? t.pnl ?? 0);
      if (runningPnL > peakEquity) peakEquity = runningPnL;
      const dd    = runningPnL - peakEquity;
      const ddPct = peakEquity > 0 ? (dd / peakEquity) * 100 : 0;
      if (dd < maxDD) { maxDD = dd; maxDDPct = ddPct; }
      currentDD = dd;

      equityCurve.push({
        time:        (t.exitTime ?? t.timestamp).toISOString(),
        equity:      runningPnL,
        drawdown:    dd,
        drawdownPct: ddPct,
        tradeCount:  i + 1,
      });
    });

    // ── Sharpe ratio (approximate using trade returns) ────────────────────
    const returns   = closed.map(t => (t.pnl ?? 0) / (t.total || 1));
    const meanRet   = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
    const variance  = returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length || 1);
    const stdDev    = Math.sqrt(variance);
    const sharpe    = stdDev > 0 ? (meanRet / stdDev) * Math.sqrt(252) : 0;

    // ── Streaks ───────────────────────────────────────────────────────────
    let curStreak = 0, maxWinS = 0, maxLossS = 0, runS = 0;
    sorted.forEach(t => {
      const w = (t.pnl ?? 0) > 0;
      if (runS === 0) { runS = w ? 1 : -1; }
      else if (w && runS > 0) { runS++; }
      else if (!w && runS < 0) { runS--; }
      else { runS = w ? 1 : -1; }
      if (runS > maxWinS)        maxWinS  = runS;
      if (runS < -maxLossS)      maxLossS = -runS;
    });
    curStreak = runS;

    // ── Best / Worst trade ────────────────────────────────────────────────
    const bestTrade  = closed.length ? closed.reduce((b, t) => (t.pnl ?? 0) > (b.pnl ?? 0) ? t : b, closed[0]) : null;
    const worstTrade = closed.length ? closed.reduce((w, t) => (t.pnl ?? 0) < (w.pnl ?? 0) ? t : w, closed[0]) : null;

    // ── Daily stats ───────────────────────────────────────────────────────
    const dayMap: Record<string, DayStats> = {};
    closed.forEach(t => {
      const dk = dayKey(t.exitTime ?? t.timestamp);
      if (!dayMap[dk]) dayMap[dk] = { date: dk, pnl: 0, trades: 0, wins: 0, losses: 0, fees: 0 };
      dayMap[dk].pnl    += t.realised ?? t.pnl ?? 0;
      dayMap[dk].trades += 1;
      dayMap[dk].fees   += t.fees ?? 0;
      if ((t.pnl ?? 0) > 0) dayMap[dk].wins++; else dayMap[dk].losses++;
    });
    const dailyStats = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
    const bestDay    = dailyStats.length ? dailyStats.reduce((b, d) => d.pnl > b.pnl ? d : b, dailyStats[0]) : null;
    const worstDay   = dailyStats.length ? dailyStats.reduce((w, d) => d.pnl < w.pnl ? d : w, dailyStats[0]) : null;

    // ── Symbol breakdown ──────────────────────────────────────────────────
    const bySymbol: ProfitStats["bySymbol"] = {};
    closed.forEach(t => {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { pnl: 0, trades: 0, wins: 0, fees: 0 };
      bySymbol[t.symbol].pnl    += t.realised ?? t.pnl ?? 0;
      bySymbol[t.symbol].trades += 1;
      bySymbol[t.symbol].fees   += t.fees ?? 0;
      if ((t.pnl ?? 0) > 0) bySymbol[t.symbol].wins++;
    });

    // ── Time-window PnL ───────────────────────────────────────────────────
    const now      = new Date();
    const todayKey = dayKey(now);
    const wa       = weekAgo();
    const ma       = monthAgo();

    const todayPnL  = closed.filter(t => dayKey(t.exitTime ?? t.timestamp) === todayKey)
                            .reduce((s, t) => s + (t.realised ?? t.pnl ?? 0), 0);
    const todayCnt  = closed.filter(t => dayKey(t.exitTime ?? t.timestamp) === todayKey).length;
    const weekPnL   = closed.filter(t => (t.exitTime ?? t.timestamp) >= wa)
                            .reduce((s, t) => s + (t.realised ?? t.pnl ?? 0), 0);
    const monthPnL  = closed.filter(t => (t.exitTime ?? t.timestamp) >= ma)
                            .reduce((s, t) => s + (t.realised ?? t.pnl ?? 0), 0);

    // ── Fee impact ────────────────────────────────────────────────────────
    const feeImpact = totalGross > 0 ? (totalFees / totalGross) * 100 : 0;
    const realTrades = trades.filter(t => t.isReal).length;
    const simTrades  = trades.filter(t => !t.isReal).length;

    return {
      totalRealised:   totalNet,
      totalUnrealized: unrealized,
      totalGross,
      totalFees,
      totalNet:        totalNet + unrealized,
      totalTrades:     trades.length,
      openTrades:      open.length,
      closedTrades:    closed.length,
      wins:            wins.length,
      losses:          losses.length,
      winRate,
      avgWin,
      avgLoss,
      avgTrade,
      avgDuration,
      profitFactor,
      sharpeRatio:     sharpe,
      maxDrawdown:     maxDD,
      maxDrawdownPct:  maxDDPct,
      currentDrawdown: currentDD,
      peakEquity,
      currentStreak:   curStreak,
      maxWinStreak:    maxWinS,
      maxLossStreak:   maxLossS,
      bestTrade,
      worstTrade,
      bestDay,
      worstDay,
      bySymbol,
      equityCurve,
      dailyStats,
      todayPnL,
      todayTrades:     todayCnt,
      weekPnL,
      monthPnL,
      feeImpact,
      realTrades,
      simTrades,
    };
  }, [trades]);
}

// ─── Empty state ─────────────────────────────────────────────────────────────

const EMPTY_STATS: ProfitStats = {
  totalRealised: 0, totalUnrealized: 0, totalGross: 0, totalFees: 0, totalNet: 0,
  totalTrades: 0, openTrades: 0, closedTrades: 0, wins: 0, losses: 0, winRate: 0,
  avgWin: 0, avgLoss: 0, avgTrade: 0, avgDuration: 0,
  profitFactor: 0, sharpeRatio: 0,
  maxDrawdown: 0, maxDrawdownPct: 0, currentDrawdown: 0, peakEquity: 0,
  currentStreak: 0, maxWinStreak: 0, maxLossStreak: 0,
  bestTrade: null, worstTrade: null, bestDay: null, worstDay: null,
  bySymbol: {}, equityCurve: [], dailyStats: [],
  todayPnL: 0, todayTrades: 0, weekPnL: 0, monthPnL: 0,
  feeImpact: 0, realTrades: 0, simTrades: 0,
};
