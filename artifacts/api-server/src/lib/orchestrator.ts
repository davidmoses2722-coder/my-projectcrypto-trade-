/**
 * Orchestrator Engine — Phase 4 Automation & Intelligence
 *
 * Reads live bot-status and analytics; computes market regime,
 * strategy weights, allocations, and intelligence rule verdicts.
 * PURE ADVISORY — never touches execution, BullMQ, or strategy engines.
 */

export type Regime =
  | "trending"
  | "ranging"
  | "high_volatility"
  | "low_volatility"
  | "breakout"
  | "reversal"
  | "unknown";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrategyEntry {
  id:         string;
  name:       string;
  enabled:    boolean;
  weight:     number;     // relative weight 0-100
  allocation: number;     // final capital % (post-scaling)
  reason:     string;
  suitable:   Regime[];
}

export interface IntelligenceRule {
  id:          string;
  name:        string;
  description: string;
  triggered:   boolean;
  action:      string;
  severity:    "info" | "warning" | "critical";
}

export interface OrchestratorStatus {
  regime:           Regime;
  regimeConfidence: number;    // 0-100
  regimeReason:     string;
  marketConfidence: number;    // 0-100
  strategies:       StrategyEntry[];
  rules:            IntelligenceRule[];
  totalAllocPct:    number;
  activeStrategyId: string;
  lossStreak:       number;
  volRatio:         number;
  lastComputed:     string;
  log:              { ts: string; level: string; msg: string }[];
}

export interface OrchestratorConfig {
  autoEnabled:           boolean;
  volHighThreshold:      number;  // default 1.5
  volLowThreshold:       number;  // default 0.7
  emaGapTrendPct:        number;  // default 1.0
  losingStreakThreshold: number;  // default 3
  maxSingleAllocPct:     number;  // default 60
}

// ─── Base strategy registry ───────────────────────────────────────────────────

const BASE_STRATEGIES: Array<{
  id: string; name: string; suitable: Regime[]; baseWeight: number;
}> = [
  { id: "swing",       name: "Swing",       suitable: ["trending", "ranging"],          baseWeight: 35 },
  { id: "scalping",    name: "Scalping",    suitable: ["ranging", "low_volatility"],    baseWeight: 30 },
  { id: "day-trading", name: "Day Trading", suitable: ["trending", "breakout"],         baseWeight: 20 },
  { id: "dca",         name: "DCA",         suitable: ["ranging", "low_volatility"],    baseWeight: 10 },
  { id: "grid",        name: "Grid",        suitable: ["ranging"],                      baseWeight: 5  },
];

const DEFAULT_CONFIG: OrchestratorConfig = {
  autoEnabled:           true,
  volHighThreshold:      1.5,
  volLowThreshold:       0.7,
  emaGapTrendPct:        1.0,
  losingStreakThreshold: 3,
  maxSingleAllocPct:     60,
};

// ─── Regime detection ─────────────────────────────────────────────────────────

function detectRegime(
  sig:  any | null,
  cfg:  OrchestratorConfig,
): { regime: Regime; confidence: number; reason: string; volRatio: number } {
  if (!sig) {
    return { regime: "unknown", confidence: 0, reason: "No strategy signal data", volRatio: 1 };
  }

  const { rsi, ema50, ema200, currentVol, avgVol } = sig;
  const volRatio = (currentVol != null && avgVol != null && avgVol > 0)
    ? (currentVol as number) / (avgVol as number)
    : 1;

  // High volatility
  if (volRatio >= cfg.volHighThreshold) {
    const conf = Math.min(99, Math.round((volRatio - 1) * 60 + 40));
    return {
      regime: "high_volatility",
      confidence: conf,
      reason: `Vol ${volRatio.toFixed(2)}× avg (threshold ${cfg.volHighThreshold}×)`,
      volRatio,
    };
  }
  // Low volatility
  if (volRatio <= cfg.volLowThreshold) {
    const conf = Math.min(99, Math.round((1 - volRatio) * 80 + 40));
    return {
      regime: "low_volatility",
      confidence: conf,
      reason: `Vol ${volRatio.toFixed(2)}× avg (threshold ${cfg.volLowThreshold}×)`,
      volRatio,
    };
  }

  // EMA trend
  if (ema50 != null && ema200 != null && (ema200 as number) > 0) {
    const emaGapPct = Math.abs((ema50 as number) - (ema200 as number)) / (ema200 as number) * 100;

    // Breakout — EMA convergence + rising vol
    if (emaGapPct < 0.4 && volRatio > 1.1) {
      return {
        regime: "breakout",
        confidence: Math.min(99, Math.round(volRatio * 30 + 40)),
        reason: `EMA convergence ${emaGapPct.toFixed(2)}% gap + rising vol ${volRatio.toFixed(2)}×`,
        volRatio,
      };
    }

    // Trending
    if (emaGapPct >= cfg.emaGapTrendPct) {
      const isBull = (ema50 as number) > (ema200 as number);
      const conf   = Math.min(99, Math.round(emaGapPct * 12 + 50));
      return {
        regime: "trending",
        confidence: conf,
        reason: `EMA50 ${isBull ? ">" : "<"} EMA200 by ${emaGapPct.toFixed(2)}% | RSI ${rsi != null ? (rsi as number).toFixed(0) : "?"}`,
        volRatio,
      };
    }
  }

  // Reversal — RSI extremes
  if (rsi != null) {
    if ((rsi as number) >= 72) {
      return {
        regime: "reversal",
        confidence: Math.min(99, Math.round(((rsi as number) - 70) * 5 + 50)),
        reason: `RSI overbought ${(rsi as number).toFixed(0)}`,
        volRatio,
      };
    }
    if ((rsi as number) <= 28) {
      return {
        regime: "reversal",
        confidence: Math.min(99, Math.round((30 - (rsi as number)) * 5 + 50)),
        reason: `RSI oversold ${(rsi as number).toFixed(0)}`,
        volRatio,
      };
    }
  }

  return {
    regime: "ranging",
    confidence: 60,
    reason: "Tight EMA spread, neutral RSI, normal vol",
    volRatio,
  };
}

// ─── Strategy weight computation ──────────────────────────────────────────────

function computeStrategies(
  regime:       Regime,
  volRatio:     number,
  lossStreak:   number,
  cfg:          OrchestratorConfig,
  overrides:    Map<string, Partial<StrategyEntry>>,
): StrategyEntry[] {
  // Raw weights
  const weighted = BASE_STRATEGIES.map((base) => {
    const ov = overrides.get(base.id) ?? {};

    // Manual disable override
    if (ov.enabled === false) {
      return { id: base.id, name: base.name, enabled: false, weight: 0, allocation: 0,
        reason: "Manually disabled via override", suitable: base.suitable };
    }

    let weight = (ov.weight != null) ? ov.weight : base.baseWeight;
    const isSuitable = base.suitable.includes(regime) || regime === "unknown";

    // Regime fit
    if (isSuitable) weight = weight * 1.3;
    else            weight = weight * 0.55;

    // Specific rules
    if (base.id === "scalping" && regime === "high_volatility") {
      return { id: base.id, name: base.name, enabled: false, weight: 0, allocation: 0,
        reason: "Suspended: scalping paused during high volatility", suitable: base.suitable };
    }
    if (base.id === "dca" && regime === "high_volatility") {
      return { id: base.id, name: base.name, enabled: false, weight: 0, allocation: 0,
        reason: "Suspended: DCA not suitable during high volatility", suitable: base.suitable };
    }
    if (base.id === "swing"       && regime === "trending")   weight = weight * 1.4;
    if (base.id === "day-trading" && regime === "breakout")   weight = weight * 1.5;
    if (base.id === "scalping"    && regime === "reversal")   weight = weight * 0.5;
    if (base.id === "grid"        && regime !== "ranging")    weight = weight * 0.4;

    // Losing streak penalty
    if (lossStreak >= cfg.losingStreakThreshold) weight = weight * 0.7;

    const finalWeight = Math.max(0, Math.round(weight));
    return {
      id: base.id, name: base.name,
      enabled: finalWeight > 0,
      weight:  finalWeight,
      allocation: 0,
      reason: isSuitable
        ? `Suitable for ${regime}${lossStreak >= cfg.losingStreakThreshold ? ` (−30% streak)` : ""}`
        : `Low priority: ${regime} regime`,
      suitable: base.suitable,
    };
  });

  // Compute allocations
  const enabled     = weighted.filter((s) => s.enabled && s.weight > 0);
  const totalWeight = enabled.reduce((s, e) => s + e.weight, 0);
  if (!totalWeight) return weighted;

  const volScaler = volRatio > 1.3 ? 0.7 : volRatio < 0.7 ? 0.85 : 1.0;

  return weighted.map((s) => {
    if (!s.enabled || s.weight === 0) return { ...s, allocation: 0 };
    const rawPct   = (s.weight / totalWeight) * 100;
    const capped   = Math.min(cfg.maxSingleAllocPct, rawPct);
    const adjPct   = capped * volScaler;
    return { ...s, allocation: Math.round(adjPct * 10) / 10 };
  });
}

// ─── Intelligence rules ───────────────────────────────────────────────────────

function evaluateRules(
  regime:     Regime,
  volRatio:   number,
  lossStreak: number,
  cfg:        OrchestratorConfig,
): IntelligenceRule[] {
  return [
    {
      id: "pause_scalping_high_vol",
      name: "Pause Scalping: Extreme Volatility",
      description: `Suspend scalping when vol ≥ ${cfg.volHighThreshold}× avg`,
      triggered: regime === "high_volatility",
      action: "Scalping weight → 0, allocation suspended",
      severity: "critical",
    },
    {
      id: "boost_swing_trend",
      name: "Increase Swing: Strong Trend",
      description: "Boost swing allocation +40% during trending regimes",
      triggered: regime === "trending",
      action: "Swing weight ×1.4, higher capital allocation",
      severity: "info",
    },
    {
      id: "reduce_on_losing_streak",
      name: "Reduce Exposure: Losing Streak",
      description: `Reduce all weights 30% after ${cfg.losingStreakThreshold}+ consecutive losses`,
      triggered: lossStreak >= cfg.losingStreakThreshold,
      action: `All weights ×0.7 (current streak: ${lossStreak})`,
      severity: lossStreak >= cfg.losingStreakThreshold * 2 ? "critical" : "warning",
    },
    {
      id: "boost_daytrading_breakout",
      name: "Prefer Day-Trading: Breakout",
      description: "Boost day-trading +50% during breakout conditions",
      triggered: regime === "breakout",
      action: "Day-trading weight ×1.5",
      severity: "info",
    },
    {
      id: "suspend_dca_high_vol",
      name: "Suspend DCA: High Volatility",
      description: "DCA suspended during high volatility — price instability risk",
      triggered: regime === "high_volatility",
      action: "DCA weight → 0, reallocated to suitable strategies",
      severity: "warning",
    },
    {
      id: "vol_scaled_sizing",
      name: "Volatility-Scaled Exposure",
      description: "Scale total exposure down when vol > 1.3× average",
      triggered: volRatio > 1.3,
      action: `Total capital exposure scaled to ${Math.round((volRatio > 1.3 ? 0.7 : 1.0) * 100)}%`,
      severity: "info",
    },
    {
      id: "favour_ranging_low_vol",
      name: "Favour Scalping/DCA: Low Volatility",
      description: "Boost scalping and DCA weight during low volatility regimes",
      triggered: regime === "low_volatility",
      action: "Scalping +30%, DCA +30% via regime fit bonus",
      severity: "info",
    },
  ];
}

// ─── Singleton class ──────────────────────────────────────────────────────────

class OrchestratorEngine {
  private cfg: OrchestratorConfig = { ...DEFAULT_CONFIG };
  private overrides = new Map<string, Partial<StrategyEntry>>();
  private logFn: ((level: string, msg: string) => void) | null = null;
  private recentLog: { ts: string; level: string; msg: string }[] = [];

  setLogFn(fn: (level: string, msg: string) => void): void {
    this.logFn = fn;
  }

  private emit(level: string, msg: string): void {
    const entry = { ts: new Date().toISOString(), level, msg };
    this.recentLog.unshift(entry);
    if (this.recentLog.length > 50) this.recentLog.length = 50;
    this.logFn?.(level, msg);
  }

  getConfig(): OrchestratorConfig { return { ...this.cfg }; }

  updateConfig(patch: Partial<OrchestratorConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    this.emit("info", `[Orchestrator] Config updated — autoEnabled=${this.cfg.autoEnabled}, volHigh=${this.cfg.volHighThreshold}`);
  }

  applyOverride(strategyId: string, patch: Partial<StrategyEntry>): void {
    const existing = this.overrides.get(strategyId) ?? {};
    this.overrides.set(strategyId, { ...existing, ...patch });
    this.emit(
      "info",
      `[Orchestrator] Override applied to "${strategyId}" — ${JSON.stringify(patch)}`,
    );
  }

  clearOverride(strategyId: string): void {
    this.overrides.delete(strategyId);
    this.emit("info", `[Orchestrator] Override cleared for "${strategyId}"`);
  }

  /**
   * Main compute — call from the route handler with live bot status.
   * botStatus: return value of bot.buildStatus()
   */
  compute(botStatus: any): OrchestratorStatus {
    const sig         = botStatus?.strategy ?? null;
    const lossStreak  = (botStatus?.advancedRisk?.consecutiveLosses as number) ?? 0;
    const activeId    = (botStatus?.activeStrategy as string) ?? "unknown";

    // 1. Detect regime
    const { regime, confidence, reason, volRatio } = detectRegime(sig, this.cfg);

    // 2. Compute strategy entries
    const strategies = computeStrategies(regime, volRatio, lossStreak, this.cfg, this.overrides);

    // 3. Evaluate intelligence rules
    const rules = evaluateRules(regime, volRatio, lossStreak, this.cfg);

    // 4. Market confidence
    let marketConf = confidence;
    if (regime === "high_volatility" || regime === "reversal") marketConf = Math.max(20, marketConf - 15);
    if (regime === "trending" || regime === "ranging")         marketConf = Math.min(99, marketConf + 5);
    marketConf = Math.round(marketConf);

    // 5. Emit regime + triggered rules to SSE
    const triggeredRules = rules.filter((r) => r.triggered);
    this.emit("info", `[Regime] ${regime.toUpperCase()} (${confidence}% confidence) — ${reason}`);
    for (const rule of triggeredRules) {
      this.emit(
        rule.severity === "critical" ? "warn" : "info",
        `[Intelligence] ${rule.name} → ${rule.action}`,
      );
    }

    // 6. Allocation summary log
    const enabledStrats = strategies.filter((s) => s.enabled);
    const totalAlloc    = enabledStrats.reduce((s, e) => s + e.allocation, 0);
    this.emit(
      "info",
      `[Allocation] ${enabledStrats.length} strategies active | ` +
      enabledStrats.map((s) => `${s.name} ${s.allocation.toFixed(0)}%`).join(", "),
    );

    return {
      regime,
      regimeConfidence: confidence,
      regimeReason:     reason,
      marketConfidence: marketConf,
      strategies,
      rules,
      totalAllocPct:    Math.round(totalAlloc * 10) / 10,
      activeStrategyId: activeId,
      lossStreak,
      volRatio:         Math.round(volRatio * 100) / 100,
      lastComputed:     new Date().toISOString(),
      log:              this.recentLog.slice(0, 20),
    };
  }
}

export const orchestrator = new OrchestratorEngine();
