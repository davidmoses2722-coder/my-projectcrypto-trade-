/**
 * capitalProtectionService.ts — Phase 8.1 Capital Protection Layer
 *
 * Highest-priority safety layer. Monitors equity drawdown and triggers
 * progressive trading halts:
 *   -10%  → pause trading
 *   -15%  → disable live trading (paper only)
 *   -20%  → full emergency shutdown
 *
 * Also enforces daily / weekly / monthly account stops.
 * ADVISORY + STATE — emits events but does NOT directly cancel orders.
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProtectionLevel = "none" | "pause" | "disable_live" | "emergency_shutdown";

export interface CapitalProtectionConfig {
  peakEquity:              number;    // highest equity seen ($)
  equityTrailingStop10:    boolean;   // trigger at -10%
  equityTrailingStop15:    boolean;   // trigger at -15%
  equityTrailingStop20:    boolean;   // trigger at -20%
  dailyLossLimitPct:       number;    // default 5%
  weeklyLossLimitPct:      number;    // default 10%
  monthlyLossLimitPct:     number;    // default 20%
  emergencyKillSwitch:     boolean;   // manual override
}

export interface ProtectionStatus {
  level:              ProtectionLevel;
  equityDropPct:      number;      // current drop from peak
  currentEquity:      number;
  peakEquity:         number;
  dailyLossPct:       number;
  weeklyLossPct:      number;
  monthlyLossPct:     number;
  tradingAllowed:     boolean;
  liveAllowed:        boolean;
  reason:             string;
  alerts:             string[];
  lastChecked:        string;
  dailyStartEquity:   number;
  weeklyStartEquity:  number;
  monthlyStartEquity: number;
}

const DEFAULT_CONFIG: CapitalProtectionConfig = {
  peakEquity:           0,
  equityTrailingStop10: true,
  equityTrailingStop15: true,
  equityTrailingStop20: true,
  dailyLossLimitPct:    5,
  weeklyLossLimitPct:   10,
  monthlyLossLimitPct:  20,
  emergencyKillSwitch:  false,
};

// ─── Service class ────────────────────────────────────────────────────────────

class CapitalProtectionService {
  private cfg:                 CapitalProtectionConfig = { ...DEFAULT_CONFIG };
  private dailyStartEquity:    number = 0;
  private weeklyStartEquity:   number = 0;
  private monthlyStartEquity:  number = 0;
  private lastDayStr:          string = "";
  private lastWeekStr:         string = "";
  private lastMonthStr:        string = "";
  private currentLevel:        ProtectionLevel = "none";
  private alerts:              string[] = [];

  configure(patch: Partial<CapitalProtectionConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    logger.info({ cfg: this.cfg }, "CapitalProtection: config updated");
  }

  getConfig(): CapitalProtectionConfig { return { ...this.cfg }; }

  triggerEmergency(): void {
    this.cfg.emergencyKillSwitch = true;
    this.currentLevel = "emergency_shutdown";
    const msg = "EMERGENCY KILL SWITCH ACTIVATED — all trading halted";
    this.alerts.unshift(msg);
    logger.warn({ level: this.currentLevel }, `CapitalProtection: ${msg}`);
  }

  resetEmergency(): void {
    this.cfg.emergencyKillSwitch = false;
    if (this.currentLevel === "emergency_shutdown") this.currentLevel = "none";
    logger.info("CapitalProtection: emergency kill switch reset");
  }

  /** Call every time equity changes (after trade close or balance refresh) */
  evaluate(currentEquity: number): ProtectionStatus {
    const now       = new Date();
    const dayStr    = now.toISOString().slice(0, 10);
    const weekStr   = `${now.getFullYear()}-W${Math.ceil(now.getDate() / 7)}`;
    const monthStr  = now.toISOString().slice(0, 7);

    // Reset period windows
    if (dayStr !== this.lastDayStr)     { this.dailyStartEquity = currentEquity;   this.lastDayStr = dayStr; }
    if (weekStr !== this.lastWeekStr)   { this.weeklyStartEquity = currentEquity;  this.lastWeekStr = weekStr; }
    if (monthStr !== this.lastMonthStr) { this.monthlyStartEquity = currentEquity; this.lastMonthStr = monthStr; }

    // Init on first call
    if (this.dailyStartEquity === 0)   this.dailyStartEquity = currentEquity;
    if (this.weeklyStartEquity === 0)  this.weeklyStartEquity = currentEquity;
    if (this.monthlyStartEquity === 0) this.monthlyStartEquity = currentEquity;

    // Update peak
    if (currentEquity > this.cfg.peakEquity) {
      this.cfg.peakEquity = currentEquity;
    }
    const peakEquity = this.cfg.peakEquity || currentEquity;

    // Drawdown from peak
    const equityDropPct = peakEquity > 0
      ? ((peakEquity - currentEquity) / peakEquity) * 100
      : 0;

    // Period losses
    const dailyLossPct   = this.dailyStartEquity > 0
      ? Math.max(0, ((this.dailyStartEquity - currentEquity) / this.dailyStartEquity) * 100) : 0;
    const weeklyLossPct  = this.weeklyStartEquity > 0
      ? Math.max(0, ((this.weeklyStartEquity - currentEquity) / this.weeklyStartEquity) * 100) : 0;
    const monthlyLossPct = this.monthlyStartEquity > 0
      ? Math.max(0, ((this.monthlyStartEquity - currentEquity) / this.monthlyStartEquity) * 100) : 0;

    // Determine protection level
    const alerts: string[] = [];
    let level: ProtectionLevel = "none";
    let reason = "All protection checks passed";

    if (this.cfg.emergencyKillSwitch) {
      level  = "emergency_shutdown";
      reason = "Emergency kill switch is active";
      alerts.push("⛔ EMERGENCY KILL SWITCH — all trading halted");
    } else if (equityDropPct >= 20 && this.cfg.equityTrailingStop20) {
      level  = "emergency_shutdown";
      reason = `Equity dropped ${equityDropPct.toFixed(1)}% from peak — full shutdown triggered`;
      alerts.push(`⛔ FULL SHUTDOWN: equity −${equityDropPct.toFixed(1)}% from peak`);
    } else if (monthlyLossPct >= this.cfg.monthlyLossLimitPct) {
      level  = "emergency_shutdown";
      reason = `Monthly loss limit hit (${monthlyLossPct.toFixed(1)}% > ${this.cfg.monthlyLossLimitPct}%)`;
      alerts.push(`⛔ MONTHLY STOP: −${monthlyLossPct.toFixed(1)}%`);
    } else if (equityDropPct >= 15 && this.cfg.equityTrailingStop15) {
      level  = "disable_live";
      reason = `Equity dropped ${equityDropPct.toFixed(1)}% from peak — live trading disabled`;
      alerts.push(`⚠️ LIVE DISABLED: equity −${equityDropPct.toFixed(1)}% from peak`);
    } else if (weeklyLossPct >= this.cfg.weeklyLossLimitPct) {
      level  = "disable_live";
      reason = `Weekly loss limit hit (${weeklyLossPct.toFixed(1)}% > ${this.cfg.weeklyLossLimitPct}%)`;
      alerts.push(`⚠️ WEEKLY STOP: −${weeklyLossPct.toFixed(1)}%`);
    } else if (equityDropPct >= 10 && this.cfg.equityTrailingStop10) {
      level  = "pause";
      reason = `Equity dropped ${equityDropPct.toFixed(1)}% from peak — trading paused`;
      alerts.push(`⏸️ PAUSED: equity −${equityDropPct.toFixed(1)}% from peak`);
    } else if (dailyLossPct >= this.cfg.dailyLossLimitPct) {
      level  = "pause";
      reason = `Daily loss limit hit (${dailyLossPct.toFixed(1)}% > ${this.cfg.dailyLossLimitPct}%)`;
      alerts.push(`⏸️ DAILY STOP: −${dailyLossPct.toFixed(1)}%`);
    }

    // Warn zone alerts (below threshold but approaching)
    if (level === "none") {
      if (equityDropPct >= 7) alerts.push(`⚠️ Equity drop warning: −${equityDropPct.toFixed(1)}%`);
      if (dailyLossPct >= this.cfg.dailyLossLimitPct * 0.75)
        alerts.push(`⚠️ Daily loss approaching limit: −${dailyLossPct.toFixed(1)}%`);
    }

    if (level !== this.currentLevel) {
      logger.warn({ from: this.currentLevel, to: level, equityDropPct }, "CapitalProtection: level changed");
      this.currentLevel = level;
    }

    this.alerts = alerts;

    return {
      level,
      equityDropPct:      Math.round(equityDropPct * 100) / 100,
      currentEquity:      Math.round(currentEquity * 100) / 100,
      peakEquity:         Math.round(peakEquity * 100) / 100,
      dailyLossPct:       Math.round(dailyLossPct * 100) / 100,
      weeklyLossPct:      Math.round(weeklyLossPct * 100) / 100,
      monthlyLossPct:     Math.round(monthlyLossPct * 100) / 100,
      tradingAllowed:     level === "none",
      liveAllowed:        level === "none",
      reason,
      alerts,
      lastChecked:        new Date().toISOString(),
      dailyStartEquity:   Math.round(this.dailyStartEquity * 100) / 100,
      weeklyStartEquity:  Math.round(this.weeklyStartEquity * 100) / 100,
      monthlyStartEquity: Math.round(this.monthlyStartEquity * 100) / 100,
    };
  }

  getStatus(): ProtectionStatus {
    return this.evaluate(this.cfg.peakEquity > 0 ? this.cfg.peakEquity : 0);
  }

  getCurrentLevel(): ProtectionLevel { return this.currentLevel; }
}

export const capitalProtectionService = new CapitalProtectionService();
