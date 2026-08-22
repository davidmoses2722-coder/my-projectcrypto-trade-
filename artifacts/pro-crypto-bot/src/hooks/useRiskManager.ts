// ─────────────────────────────────────────────────────────────────────────────
// useRiskManager — live risk monitoring hook
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from "react";
import {
  RiskState,
  RiskLimits,
  RiskAlert,
  DEFAULT_RISK_LIMITS,
  computeRiskScore,
  checkCircuitBreakers,
  riskStatusFromScore,
  safePositionSize,
  computeSharpe,
  computeProfitFactor,
  kellySize,
} from "../utils/riskManager";
import { logger } from "../utils/logger";
import { telegramAlert } from "../services/telegram";
import { hasValidTelegramConfig } from "../services/telegram";

interface TradeRecord {
  pnl: number;
  pnlPercent: number;
  status: "open" | "closed";
}

export function useRiskManager(
  trades: TradeRecord[],
  accountBalance: number,
  isBotRunning: boolean
) {
  const [limits, setLimits]           = useState<RiskLimits>(DEFAULT_RISK_LIMITS);
  const [riskState, setRiskState]     = useState<RiskState>({
    totalBalance:         accountBalance || 10000,
    usedMargin:           0,
    availableBalance:     accountBalance || 10000,
    dailyPnL:             0,
    dailyPnLPercent:      0,
    weeklyPnL:            0,
    drawdown:             0,
    peakEquity:           accountBalance || 10000,
    openPositions:        0,
    consecutiveLosses:    0,
    consecutiveWins:      0,
    totalTrades:          0,
    winningTrades:        0,
    winRate:              0,
    avgWin:               0,
    avgLoss:              0,
    profitFactor:         1,
    sharpeRatio:          0,
    maxDrawdown:          0,
    riskScore:            0,
    status:               "SAFE",
    alerts:               [],
    circuitBreakerTripped: false,
  });

  const dailyStartRef  = useRef(accountBalance || 10000);
  const peakEquityRef  = useRef(accountBalance || 10000);
  const returnsRef     = useRef<number[]>([]);
  const prevTradesRef  = useRef<TradeRecord[]>([]);

  const addAlert = useCallback((alert: Omit<RiskAlert, "id" | "timestamp">) => {
    const newAlert: RiskAlert = {
      ...alert,
      id: `alert-${Date.now()}`,
      timestamp: new Date(),
    };
    setRiskState((prev) => ({
      ...prev,
      alerts: [newAlert, ...prev.alerts.slice(0, 49)],
    }));
    logger.risk("RiskManager", `[${alert.level}] ${alert.message} (rule: ${alert.rule})`);
    if ((alert.level === "CRITICAL" || alert.level === "DANGER") && hasValidTelegramConfig) {
      telegramAlert(`🚨 RISK ALERT [${alert.level}]\n${alert.message}\nRule: ${alert.rule}\n⏰ ${new Date().toLocaleString()}`);
    }
  }, []);

  const updateLimits = useCallback((updates: Partial<RiskLimits>) => {
    setLimits((prev) => ({ ...prev, ...updates }));
    logger.info("RiskManager", "⚙️ Risk limits updated", updates as Record<string, unknown>);
  }, []);

  // ── Main risk computation ─────────────────────────────────────────────────
  useEffect(() => {
    const closed = trades.filter((t) => t.status === "closed");
    const open   = trades.filter((t) => t.status === "open");

    const wins   = closed.filter((t) => t.pnl > 0);
    const losses = closed.filter((t) => t.pnl <= 0);

    const totalPnL   = closed.reduce((s, t) => s + t.pnl, 0);
    const openPnL    = open.reduce((s, t) => s + (t.pnl || 0), 0);
    const equity     = (accountBalance || 10000) + totalPnL + openPnL;

    // Peak equity tracking
    if (equity > peakEquityRef.current) peakEquityRef.current = equity;
    const drawdown = peakEquityRef.current > 0
      ? ((peakEquityRef.current - equity) / peakEquityRef.current) * 100
      : 0;

    // Daily P&L
    const dailyPnL        = totalPnL; // simplified (full app would use date filter)
    const dailyPnLPercent = dailyStartRef.current > 0
      ? (dailyPnL / dailyStartRef.current) * 100 : 0;

    // Win rate & streaks
    const winRate   = closed.length ? (wins.length / closed.length) * 100 : 0;
    const avgWin    = wins.length   ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss   = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;

    // Profit factor
    const profitFactor = computeProfitFactor(
      wins.map((t) => t.pnl),
      losses.map((t) => t.pnl)
    );

    // Sharpe ratio
    const newTrades = trades.filter((t) => !prevTradesRef.current.includes(t) && t.status === "closed");
    newTrades.forEach((t) => returnsRef.current.push(t.pnlPercent / 100));
    prevTradesRef.current = trades;
    const sharpeRatio = computeSharpe(returnsRef.current);

    // Consecutive losses/wins
    let consLosses = 0, consWins = 0;
    for (let i = closed.length - 1; i >= 0; i--) {
      if (closed[i].pnl <= 0) { consLosses++; consWins = 0; }
      else                    { consWins++;    break; }
    }
    let cW = 0;
    for (let i = closed.length - 1; i >= 0; i--) {
      if (closed[i].pnl > 0) { cW++; }
      else break;
    }

    // Max drawdown from trade log
    let peak2 = 0, maxDD = 0, running = 0;
    for (const t of closed) {
      running += t.pnl;
      if (running > peak2) peak2 = running;
      const dd = ((peak2 - running) / (peak2 || 1)) * 100;
      if (dd > maxDD) maxDD = dd;
    }

    const usedMargin = open.reduce((s) => s + (accountBalance * (limits.maxPositionSizePercent / 100)), 0);

    const partial: Partial<RiskState> = {
      totalBalance:      equity,
      usedMargin,
      availableBalance:  equity - usedMargin,
      dailyPnL,
      dailyPnLPercent,
      weeklyPnL:         totalPnL,
      drawdown:          parseFloat(drawdown.toFixed(2)),
      peakEquity:        peakEquityRef.current,
      openPositions:     open.length,
      consecutiveLosses: consLosses,
      consecutiveWins:   cW,
      totalTrades:       closed.length,
      winningTrades:     wins.length,
      winRate:           parseFloat(winRate.toFixed(1)),
      avgWin:            parseFloat(avgWin.toFixed(2)),
      avgLoss:           parseFloat(avgLoss.toFixed(2)),
      profitFactor,
      sharpeRatio,
      maxDrawdown:       parseFloat(maxDD.toFixed(2)),
    };

    const riskScore = computeRiskScore(partial, limits);
    const status    = riskStatusFromScore(riskScore);

    // Circuit breaker
    const cb = checkCircuitBreakers(partial, limits);
    if (cb.shouldHalt && isBotRunning) {
      addAlert({ level: cb.level, message: cb.reason, rule: cb.rule });
    } else if (cb.rule && !cb.shouldHalt) {
      addAlert({ level: cb.level, message: cb.reason, rule: cb.rule });
    }

    // Warn on low win rate
    if (closed.length >= 10 && winRate < limits.minWinRatePercent) {
      addAlert({
        level: "WARN",
        message: `Win rate ${winRate.toFixed(1)}% below minimum ${limits.minWinRatePercent}%`,
        rule: "LOW_WIN_RATE",
      });
    }

    setRiskState((prev) => ({
      ...prev,
      ...partial,
      riskScore,
      status,
      circuitBreakerTripped: cb.shouldHalt,
    }));

    // Snapshot performance every update
    logger.snapPerformance({
      timestamp:     new Date(),
      equity,
      dailyPnL,
      openPositions: open.length,
      totalTrades:   closed.length,
      winRate:       parseFloat(winRate.toFixed(1)),
      drawdown:      parseFloat(drawdown.toFixed(2)),
      riskScore,
    });

  }, [trades, accountBalance, limits, isBotRunning, addAlert]);

  // ── Safe position size calculator ─────────────────────────────────────────
  const getPositionSize = useCallback(
    (price: number) =>
      safePositionSize(
        riskState.availableBalance,
        price,
        limits,
        riskState.winRate,
        riskState.avgWin,
        riskState.avgLoss
      ),
    [riskState, limits]
  );

  const getKellySize = useCallback(
    (price: number) =>
      kellySize(riskState.winRate, riskState.avgWin, riskState.avgLoss, riskState.availableBalance) / price,
    [riskState]
  );

  const canOpenTrade = useCallback((): { allowed: boolean; reason: string } => {
    if (riskState.circuitBreakerTripped)
      return { allowed: false, reason: "Circuit breaker tripped — bot halted" };
    if (riskState.openPositions >= limits.maxOpenPositions)
      return { allowed: false, reason: `Max open positions (${limits.maxOpenPositions}) reached` };
    if (riskState.dailyPnLPercent <= -limits.maxDailyLossPercent)
      return { allowed: false, reason: `Daily loss limit hit (${riskState.dailyPnLPercent.toFixed(2)}%)` };
    if (riskState.drawdown >= limits.maxDrawdownPercent)
      return { allowed: false, reason: `Max drawdown hit (${riskState.drawdown.toFixed(2)}%)` };
    if (riskState.consecutiveLosses >= limits.maxConsecutiveLosses)
      return { allowed: false, reason: `${riskState.consecutiveLosses} consecutive losses — cooling down` };
    return { allowed: true, reason: "" };
  }, [riskState, limits]);

  return {
    riskState,
    limits,
    updateLimits,
    getPositionSize,
    getKellySize,
    canOpenTrade,
  };
}
