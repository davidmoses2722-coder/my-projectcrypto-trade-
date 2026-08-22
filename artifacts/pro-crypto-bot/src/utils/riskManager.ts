// ─────────────────────────────────────────────────────────────────────────────
// Risk Manager — Account Safety Engine
// Prevents account blow-up via multi-layer guardrails
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskState {
  totalBalance: number;
  usedMargin: number;
  availableBalance: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  weeklyPnL: number;
  drawdown: number;           // current drawdown from peak equity
  peakEquity: number;
  openPositions: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  riskScore: number;          // 0 (safe) – 100 (danger)
  status: "SAFE" | "CAUTION" | "WARNING" | "DANGER" | "HALTED";
  alerts: RiskAlert[];
  circuitBreakerTripped: boolean;
  killedAt?: Date;
}

export interface RiskAlert {
  id: string;
  level: "INFO" | "WARN" | "DANGER" | "CRITICAL";
  message: string;
  timestamp: Date;
  rule: string;
}

export interface RiskLimits {
  maxDailyLossPercent: number;    // e.g. 3  → halt if day loss > 3%
  maxDrawdownPercent: number;     // e.g. 10 → halt if drawdown > 10%
  maxOpenPositions: number;       // e.g. 5
  maxPositionSizePercent: number; // e.g. 2  → max 2% per trade
  maxConsecutiveLosses: number;   // e.g. 4  → pause after 4 losses
  minWinRatePercent: number;      // e.g. 40 → warn if win rate < 40%
  maxCorrelatedPositions: number; // e.g. 3  → max 3 same-sector trades
  cooldownMinutes: number;        // e.g. 30 → pause N min after circuit break
  maxWeeklyLossPercent: number;   // e.g. 8
  maxSingleTradeRisk: number;     // e.g. 1  → max 1% of account per trade
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxDailyLossPercent: 3,
  maxDrawdownPercent: 10,
  maxOpenPositions: 5,
  maxPositionSizePercent: 2,
  maxConsecutiveLosses: 4,
  minWinRatePercent: 40,
  maxCorrelatedPositions: 3,
  cooldownMinutes: 30,
  maxWeeklyLossPercent: 8,
  maxSingleTradeRisk: 1,
};

// ── Kelly Criterion position sizing ──────────────────────────────────────────
export function kellySize(
  winRate: number,
  avgWin: number,
  avgLoss: number,
  balance: number,
  capFraction = 0.5          // use 50% Kelly for safety
): number {
  if (avgLoss === 0 || winRate <= 0) return 0;
  const b = avgWin / avgLoss;                    // odds ratio
  const p = winRate / 100;
  const q = 1 - p;
  const kelly = (b * p - q) / b;                // full Kelly %
  const safeKelly = Math.max(0, kelly * capFraction); // half Kelly
  return parseFloat(((balance * safeKelly) / 100).toFixed(2));
}

// ── Position size guardrail ───────────────────────────────────────────────────
export function safePositionSize(
  balance: number,
  price: number,
  limits: RiskLimits,
  winRate: number,
  avgWin: number,
  avgLoss: number
): { qty: number; usdtAmount: number; method: string; cappedBy: string | null } {
  // Method 1: Fixed risk (1% of account)
  const fixedRiskUSDT = balance * (limits.maxSingleTradeRisk / 100);

  // Method 2: Kelly Criterion
  const kellyUSDT = kellySize(winRate, avgWin, avgLoss, balance);

  // Method 3: Max position size cap
  const maxPosUSDT = balance * (limits.maxPositionSizePercent / 100);

  // Use the most conservative of all three
  const candidates = [fixedRiskUSDT, kellyUSDT > 0 ? kellyUSDT : fixedRiskUSDT, maxPosUSDT];
  const usdtAmount = Math.min(...candidates);

  const cappedBy =
    usdtAmount === fixedRiskUSDT ? `Fixed ${limits.maxSingleTradeRisk}% risk` :
    usdtAmount === kellyUSDT     ? "Kelly Criterion" :
    usdtAmount === maxPosUSDT    ? `Max ${limits.maxPositionSizePercent}% position` : null;

  const qty = parseFloat((usdtAmount / price).toFixed(6));
  const method = usdtAmount === kellyUSDT ? "Kelly" : "Fixed%";

  return { qty, usdtAmount, method, cappedBy };
}

// ── Risk score calculator ─────────────────────────────────────────────────────
export function computeRiskScore(state: Partial<RiskState>, limits: RiskLimits): number {
  let score = 0;

  const dailyLossPct = state.dailyPnLPercent ?? 0;
  const drawdown = state.drawdown ?? 0;
  const openPos = state.openPositions ?? 0;
  const consLoss = state.consecutiveLosses ?? 0;
  const winRate = state.winRate ?? 50;

  // Daily loss weight: 40 pts max
  score += Math.min(40, (Math.abs(Math.min(0, dailyLossPct)) / limits.maxDailyLossPercent) * 40);
  // Drawdown weight: 30 pts max
  score += Math.min(30, (drawdown / limits.maxDrawdownPercent) * 30);
  // Open positions weight: 15 pts max
  score += Math.min(15, (openPos / limits.maxOpenPositions) * 15);
  // Consecutive losses weight: 10 pts max
  score += Math.min(10, (consLoss / limits.maxConsecutiveLosses) * 10);
  // Low win rate weight: 5 pts max
  if (winRate < limits.minWinRatePercent) {
    score += ((limits.minWinRatePercent - winRate) / limits.minWinRatePercent) * 5;
  }

  return Math.round(Math.min(100, score));
}

// ── Circuit breaker check ─────────────────────────────────────────────────────
export interface CircuitBreakerResult {
  shouldHalt: boolean;
  reason: string;
  rule: string;
  level: RiskAlert["level"];
}

export function checkCircuitBreakers(
  state: Partial<RiskState>,
  limits: RiskLimits
): CircuitBreakerResult {
  const daily = state.dailyPnLPercent ?? 0;
  const weekly = state.weeklyPnL ?? 0;
  const drawdown = state.drawdown ?? 0;
  const openPos = state.openPositions ?? 0;
  const consLoss = state.consecutiveLosses ?? 0;
  const balance = state.totalBalance ?? 0;

  if (daily <= -limits.maxDailyLossPercent)
    return { shouldHalt: true, reason: `Daily loss limit hit: ${daily.toFixed(2)}%`, rule: "MAX_DAILY_LOSS", level: "CRITICAL" };

  if (drawdown >= limits.maxDrawdownPercent)
    return { shouldHalt: true, reason: `Max drawdown hit: ${drawdown.toFixed(2)}%`, rule: "MAX_DRAWDOWN", level: "CRITICAL" };

  if (weekly <= -(balance * limits.maxWeeklyLossPercent / 100))
    return { shouldHalt: true, reason: `Weekly loss limit exceeded`, rule: "MAX_WEEKLY_LOSS", level: "CRITICAL" };

  if (consLoss >= limits.maxConsecutiveLosses)
    return { shouldHalt: true, reason: `${consLoss} consecutive losses — cooling down`, rule: "CONSECUTIVE_LOSSES", level: "DANGER" };

  if (openPos >= limits.maxOpenPositions)
    return { shouldHalt: false, reason: `Max open positions reached: ${openPos}`, rule: "MAX_POSITIONS", level: "WARN" };

  return { shouldHalt: false, reason: "", rule: "", level: "INFO" };
}

// ── Status label from risk score ──────────────────────────────────────────────
export function riskStatusFromScore(score: number): RiskState["status"] {
  if (score >= 90) return "HALTED";
  if (score >= 70) return "DANGER";
  if (score >= 50) return "WARNING";
  if (score >= 30) return "CAUTION";
  return "SAFE";
}

// ── Sharpe ratio (simplified) ─────────────────────────────────────────────────
export function computeSharpe(returns: number[], riskFreeRate = 0.02): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return parseFloat(((mean - riskFreeRate / 252) / stdDev).toFixed(2));
}

// ── Profit factor ─────────────────────────────────────────────────────────────
export function computeProfitFactor(wins: number[], losses: number[]): number {
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  if (grossLoss === 0) return grossWin > 0 ? 999 : 1;
  return parseFloat((grossWin / grossLoss).toFixed(2));
}
