/**
 * advancedRiskEngine — portfolio-level risk management layer.
 *
 * Sits above the per-trade RiskManager and enforces portfolio-wide protections:
 *
 *   • Max drawdown from equity peak (halts trading)
 *   • Daily / weekly / monthly loss limits (halt)
 *   • Consecutive loss streak → temporary cooldown
 *   • Max concurrent losing positions → WARNING → HALTED
 *   • Volatility kill-switch via ATR spike detection
 *
 * Portfolio states:
 *   ACTIVE   — normal trading
 *   WARNING  — risk metrics approaching limits (trading continues)
 *   COOLDOWN — temporary pause after loss streak (auto-resumes)
 *   HALTED   — hard stop (manual clearHalt() required)
 *
 * Integration in bot.ts:
 *   • setLogFn(pushLog)           — once at module level
 *   • updateBalance(bal)          — after each balance fetch
 *   • trackVolatility(atr, price) — every tick after strategy signal
 *   • checkConcurrentLosses(n)    — every tick after portfolioRegistry update
 *   • recordTradePnl(pnl)         — in handleExitFilled
 *   • canTrade()                  — inside every entry guard
 */

import { notify } from "./telegramNotifier";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PortfolioState = "ACTIVE" | "WARNING" | "COOLDOWN" | "HALTED";

export interface AdvancedRiskConfig {
  maxDrawdownPct:        number;   // 0.20 = halt at 20% drawdown from peak
  dailyLossLimitUsd:     number;   // e.g. -100  (negative = loss)
  weeklyLossLimitUsd:    number;   // e.g. -300
  monthlyLossLimitUsd:   number;   // e.g. -800
  consecutiveLossLimit:  number;   // 3 = enter cooldown after 3 straight losses
  cooldownAfterLossMs:   number;   // 300_000 = 5-minute cooldown
  volatilityKillSwitch:  boolean;  // true = block entries on ATR spike
  maxConcurrentLosses:   number;   // halt if this many open positions are in loss
  volatilityAtrMultiple: number;   // 3.0 = spike if ATR > 3× rolling avg ATR
}

export interface AdvancedRiskStatus {
  state:               PortfolioState;
  drawdownPct:         number;          // 0–1 (e.g. 0.05 = 5% drawdown)
  peakBalance:         number;
  currentBalance:      number;
  dailyPnlUsd:         number;
  weeklyPnlUsd:        number;
  monthlyPnlUsd:       number;
  consecutiveLosses:   number;
  cooldownUntil:       number | null;   // Unix ms, or null
  cooldownRemainingMs: number;
  volatilityBlocked:   boolean;
  volatilityReason:    string | null;
  haltReason:          string | null;
  warnings:            string[];
  config:              AdvancedRiskConfig;
}

// ─── Drawdown tier thresholds ─────────────────────────────────────────────────
//
//  5%  → COOLDOWN — pause new entries, warn operator
// 10%  → HALTED   — disable live trading (paper mode still allowed)
// 15%  → EMERGENCY HALT — all trading stopped, Telegram alert fired
//
// These tiers fire in sequence. Once HALTED, manual clearHalt() is required.

export const DRAWDOWN_PAUSE_PCT      = 0.05;   //  5% — enter cooldown
export const DRAWDOWN_HALT_PCT       = 0.10;   // 10% — full halt
export const DRAWDOWN_EMERGENCY_PCT  = 0.15;   // 15% — emergency shutdown

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AdvancedRiskConfig = {
  maxDrawdownPct:        DRAWDOWN_EMERGENCY_PCT,  // 15% emergency halt
  dailyLossLimitUsd:     -100,
  weeklyLossLimitUsd:    -300,
  monthlyLossLimitUsd:   -800,
  consecutiveLossLimit:  3,                        // pause after 3 straight losses
  cooldownAfterLossMs:   300_000,                  // 5-minute cooldown
  volatilityKillSwitch:  true,
  maxConcurrentLosses:   2,
  volatilityAtrMultiple: 3.0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dayKey(): string  { return new Date().toISOString().slice(0, 10); }
function weekKey(): string {
  const d  = new Date();
  const ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const jan = Date.UTC(d.getUTCFullYear(), 0, 1);
  const wk  = Math.ceil(((ts - jan) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${wk}`;
}
function monthKey(): string { return new Date().toISOString().slice(0, 7); }

// ─── Rolling bucket ────────────────────────────────────────────────────────────

interface Bucket { key: string; pnlUsd: number; }

function freshIfStale(b: Bucket, key: string): Bucket {
  return b.key === key ? b : { key, pnlUsd: 0 };
}

// ─── AdvancedRiskEngine class ─────────────────────────────────────────────────

class AdvancedRiskEngine {
  private cfg: AdvancedRiskConfig = { ...DEFAULT_CONFIG };
  private logFn: ((level: string, msg: string) => void) | null = null;

  // Balance / drawdown
  private peakBalance    = 0;
  private currentBalance = 0;

  // Rolling PnL buckets
  private daily:   Bucket = { key: "", pnlUsd: 0 };
  private weekly:  Bucket = { key: "", pnlUsd: 0 };
  private monthly: Bucket = { key: "", pnlUsd: 0 };

  // Loss streak / cooldown
  private consecutiveLosses = 0;
  private cooldownUntil: number | null = null;

  // Volatility — rolling window of ATR-as-%-of-price (last 20 ticks).
  // Storing percentages (not raw dollar ATR) keeps comparisons unit-consistent
  // regardless of asset price level or candle-window depth at startup.
  private atrHistory: number[] = [];
  private volatilityBlocked = false;
  private volatilityReason: string | null = null;
  private lastVolatilityLog = 0;   // throttle repeated logs

  // Portfolio state
  private state:      PortfolioState = "ACTIVE";
  private haltReason: string | null  = null;
  private warnings:   string[]       = [];

  // ── Wiring ───────────────────────────────────────────────────────────────

  /** Wire the SSE log function from bot.ts so risk events appear in the stream. */
  setLogFn(fn: (level: string, msg: string) => void): void {
    this.logFn = fn;
  }

  private log(level: string, msg: string): void {
    this.logFn?.(level, msg);
  }

  // ── Config ───────────────────────────────────────────────────────────────

  updateConfig(patch: Partial<AdvancedRiskConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }

  getConfig(): AdvancedRiskConfig {
    return { ...this.cfg };
  }

  // ── Balance / drawdown ───────────────────────────────────────────────────

  /**
   * Update the current balance and recompute drawdown from peak.
   * Call after every balance fetch (start, and periodically during ticks).
   */
  updateBalance(balance: number): void {
    if (balance <= 0) return;
    this.currentBalance = balance;
    if (balance > this.peakBalance) {
      this.peakBalance = balance;
    }
    this.checkDrawdown();
  }

  private checkDrawdown(): void {
    if (this.peakBalance <= 0) return;
    const dd = (this.peakBalance - this.currentBalance) / this.peakBalance;

    // ── Tier 3: Emergency shutdown at 15% ────────────────────────────────────
    if (dd >= DRAWDOWN_EMERGENCY_PCT) {
      const msg = `EMERGENCY SHUTDOWN: drawdown ${(dd * 100).toFixed(1)}% ≥ ${(DRAWDOWN_EMERGENCY_PCT * 100).toFixed(0)}% — all trading disabled (peak $${this.peakBalance.toFixed(2)}, now $${this.currentBalance.toFixed(2)})`;
      this.halt(msg);
      notify("RISK_EMERGENCY", { drawdownPct: (dd * 100).toFixed(1), msg });
      return;
    }

    // ── Tier 2: Full halt at 10% — disables live trading ─────────────────────
    if (dd >= DRAWDOWN_HALT_PCT) {
      if (this.state !== "HALTED") {
        const msg = `Drawdown ${(dd * 100).toFixed(1)}% ≥ ${(DRAWDOWN_HALT_PCT * 100).toFixed(0)}% — live trading disabled (manual clearHalt required)`;
        this.halt(msg);
      }
      return;
    }

    // ── Tier 1: Pause at 5% — temporary cooldown ──────────────────────────────
    if (dd >= DRAWDOWN_PAUSE_PCT) {
      if (this.state === "ACTIVE") {
        this.enterCooldown(
          `Drawdown ${(dd * 100).toFixed(1)}% ≥ ${(DRAWDOWN_PAUSE_PCT * 100).toFixed(0)}% — pausing new entries`,
        );
      }
      return;
    }

    // ── Warning at 4% (approaching 5% pause threshold) ────────────────────────
    if (dd >= 0.04 && this.state === "ACTIVE") {
      this.addWarning(`Drawdown ${(dd * 100).toFixed(1)}% approaching ${(DRAWDOWN_PAUSE_PCT * 100).toFixed(0)}% pause threshold`);
    }
  }

  // ── Trade PnL recording ──────────────────────────────────────────────────

  /**
   * Record a completed trade's PnL.
   * Call from handleExitFilled immediately after the trade result is known.
   */
  recordTradePnl(pnlUsd: number): void {
    // Sync rolling buckets to current calendar day/week/month
    this.daily   = freshIfStale(this.daily,   dayKey());
    this.weekly  = freshIfStale(this.weekly,  weekKey());
    this.monthly = freshIfStale(this.monthly, monthKey());

    this.daily.pnlUsd   += pnlUsd;
    this.weekly.pnlUsd  += pnlUsd;
    this.monthly.pnlUsd += pnlUsd;

    // Streak tracking
    if (pnlUsd < 0) {
      this.consecutiveLosses++;
    } else if (pnlUsd > 0) {
      if (this.consecutiveLosses > 0) {
        this.log("info", `[Risk] Win after ${this.consecutiveLosses} consecutive loss(es) — streak reset`);
      }
      this.consecutiveLosses = 0;
    }
    // pnlUsd === 0: breakeven, don't reset or increment streak

    this.evaluate();
  }

  // ── Volatility tracking ───────────────────────────────────────────────────

  /**
   * Call every tick after the strategy engine computes its signal.
   *
   * Stores ATR as a PERCENTAGE of price so the rolling average is always
   * unit-consistent — raw dollar ATR cannot be averaged across ticks that
   * may have different candle depths or price levels (e.g. BTC ~$64 000
   * gives ATR ~412 in dollars but only ~0.64% of price; early startup ticks
   * with shallow candle windows would give much smaller dollar values, making
   * the rolling average unreliable and causing false spike detections).
   *
   * Comparison:  currentAtrPct > avgAtrPct × volatilityAtrMultiple
   */
  trackVolatility(atr: number, price: number): void {
    if (atr <= 0 || price <= 0) return;

    // Normalise to percentage of price — unit-consistent across all ticks
    const currentAtrPct = (atr / price) * 100;

    this.atrHistory.push(currentAtrPct);
    if (this.atrHistory.length > 20) this.atrHistory.shift();
    if (this.atrHistory.length < 5)  return;  // need at least 5 data points

    const historical  = this.atrHistory.slice(0, -1);  // exclude current tick
    const avgAtrPct   = historical.reduce((s, v) => s + v, 0) / historical.length;
    const thresholdPct = avgAtrPct * this.cfg.volatilityAtrMultiple;
    const spike        = avgAtrPct > 0 && currentAtrPct > thresholdPct;

    if (spike && this.cfg.volatilityKillSwitch) {
      if (!this.volatilityBlocked) {
        this.volatilityBlocked = true;
        this.volatilityReason  =
          `ATR ${currentAtrPct.toFixed(3)}% > ${this.cfg.volatilityAtrMultiple}× avg ${avgAtrPct.toFixed(3)}% (threshold ${thresholdPct.toFixed(3)}%) — price $${price.toFixed(2)}, raw ATR ${atr.toFixed(2)}`;
        this.log("warn", `[Volatility Block] ${this.volatilityReason}`);
        notify("RISK_VOL_BLOCKED", {
          currentAtrPct: currentAtrPct.toFixed(3),
          avgAtrPct:     avgAtrPct.toFixed(3),
          thresholdPct:  thresholdPct.toFixed(3),
          atrRaw:        atr.toFixed(2),
          price:         price.toFixed(2),
          multiplier:    this.cfg.volatilityAtrMultiple,
        });
      } else {
        // Still blocked — throttle repeated SSE logs (max once per 60 ticks)
        const now = Date.now();
        if (now - this.lastVolatilityLog > 60_000) {
          this.log("warn", `[Volatility Block] Still active — ${this.volatilityReason}`);
          this.lastVolatilityLog = now;
        }
      }
    } else if (this.volatilityBlocked) {
      // ATR has normalised — lift the block
      this.volatilityBlocked = false;
      this.volatilityReason  = null;
      this.log("info",
        `[Volatility Block] Lifted — ATR normalised: ${currentAtrPct.toFixed(3)}% ≤ ${this.cfg.volatilityAtrMultiple}× avg ${avgAtrPct.toFixed(3)}% (threshold ${thresholdPct.toFixed(3)}%)`
      );
      notify("RISK_VOL_CLEARED", { currentAtrPct: currentAtrPct.toFixed(3), avgAtrPct: avgAtrPct.toFixed(3) });
    }
  }

  // ── Concurrent losses ─────────────────────────────────────────────────────

  /**
   * Called every tick with the number of open positions currently in loss.
   * Triggers WARNING or HALT depending on the limit.
   */
  checkConcurrentLosses(lossPositionCount: number): void {
    if (
      lossPositionCount >= this.cfg.maxConcurrentLosses &&
      this.state !== "HALTED"
    ) {
      const msg = `${lossPositionCount} concurrent losing position(s) ≥ limit ${this.cfg.maxConcurrentLosses}`;
      if (this.state !== "WARNING") {
        this.addWarning(`[Risk Warning] ${msg}`);
        this.log("warn", `[Risk Warning] ${msg}`);
      }
    }
  }

  // ── Primary gate check ────────────────────────────────────────────────────

  /**
   * Call before every entry attempt. Returns { allowed: false, reason } if any
   * protection is active (halt, cooldown, volatility block).
   */
  canTrade(): { allowed: boolean; reason?: string } {
    // ── HALTED ──────────────────────────────────────────────────────────────
    if (this.state === "HALTED") {
      return { allowed: false, reason: `[Risk Halted] ${this.haltReason ?? "portfolio risk limit reached"}` };
    }

    // ── COOLDOWN ─────────────────────────────────────────────────────────────
    if (this.state === "COOLDOWN" && this.cooldownUntil !== null) {
      const remaining = this.cooldownUntil - Date.now();
      if (remaining > 0) {
        return {
          allowed: false,
          reason: `[Risk Cooldown] ${Math.ceil(remaining / 1000)}s remaining after ${this.cfg.consecutiveLossLimit} consecutive losses`,
        };
      }
      // Expired — lift cooldown
      this.cooldownUntil = null;
      this.consecutiveLosses = 0;
      this.state = this.warnings.length > 0 ? "WARNING" : "ACTIVE";
      this.log("info", "[Risk Cooldown] Cooldown expired — trading resumed");
    }

    // ── VOLATILITY BLOCK ─────────────────────────────────────────────────────
    if (this.volatilityBlocked) {
      return {
        allowed: false,
        reason: `[Volatility Block] ${this.volatilityReason ?? "ATR spike detected"}`,
      };
    }

    return { allowed: true };
  }

  // ── Internal state transitions ────────────────────────────────────────────

  private evaluate(): void {
    if (this.state === "HALTED") return;  // halted state is sticky

    const { cfg } = this;
    const newWarnings: string[] = [];

    // ── Daily loss limit ──────────────────────────────────────────────────
    if (this.daily.pnlUsd <= cfg.dailyLossLimitUsd) {
      this.halt(`Daily loss limit: $${this.daily.pnlUsd.toFixed(2)} ≤ $${cfg.dailyLossLimitUsd}`);
      return;
    }
    if (cfg.dailyLossLimitUsd < 0 && this.daily.pnlUsd < cfg.dailyLossLimitUsd * 0.7) {
      newWarnings.push(`Daily P&L $${this.daily.pnlUsd.toFixed(2)} approaching limit $${cfg.dailyLossLimitUsd}`);
    }

    // ── Weekly loss limit ─────────────────────────────────────────────────
    if (this.weekly.pnlUsd <= cfg.weeklyLossLimitUsd) {
      this.halt(`Weekly loss limit: $${this.weekly.pnlUsd.toFixed(2)} ≤ $${cfg.weeklyLossLimitUsd}`);
      return;
    }
    if (cfg.weeklyLossLimitUsd < 0 && this.weekly.pnlUsd < cfg.weeklyLossLimitUsd * 0.7) {
      newWarnings.push(`Weekly P&L $${this.weekly.pnlUsd.toFixed(2)} approaching limit $${cfg.weeklyLossLimitUsd}`);
    }

    // ── Monthly loss limit ────────────────────────────────────────────────
    if (this.monthly.pnlUsd <= cfg.monthlyLossLimitUsd) {
      this.halt(`Monthly loss limit: $${this.monthly.pnlUsd.toFixed(2)} ≤ $${cfg.monthlyLossLimitUsd}`);
      return;
    }
    if (cfg.monthlyLossLimitUsd < 0 && this.monthly.pnlUsd < cfg.monthlyLossLimitUsd * 0.7) {
      newWarnings.push(`Monthly P&L $${this.monthly.pnlUsd.toFixed(2)} approaching limit $${cfg.monthlyLossLimitUsd}`);
    }

    // ── Consecutive loss limit → cooldown ─────────────────────────────────
    if (
      this.consecutiveLosses >= cfg.consecutiveLossLimit &&
      this.state !== "COOLDOWN"
    ) {
      this.enterCooldown(
        `${this.consecutiveLosses} consecutive losses reached limit ${cfg.consecutiveLossLimit}`,
      );
      return;
    }
    if (this.consecutiveLosses >= Math.max(1, cfg.consecutiveLossLimit - 1)) {
      newWarnings.push(`${this.consecutiveLosses}/${cfg.consecutiveLossLimit} consecutive losses — approaching cooldown`);
    }

    this.warnings = newWarnings;
    if (this.state !== "COOLDOWN") {
      this.state = newWarnings.length > 0 ? "WARNING" : "ACTIVE";
      if (newWarnings.length > 0) {
        this.log("warn", `[Risk Warning] ${newWarnings.join(" | ")}`);
        notify("RISK_WARNING", { warnings: newWarnings.join(" | ") });
      }
    }
  }

  private halt(reason: string): void {
    if (this.state === "HALTED") return;
    this.state      = "HALTED";
    this.haltReason = reason;
    this.log("warn", `[Risk Halted] ${reason}`);
    notify("RISK_HALTED", { reason });
  }

  private enterCooldown(reason: string): void {
    this.state        = "COOLDOWN";
    this.cooldownUntil = Date.now() + this.cfg.cooldownAfterLossMs;
    const secs = Math.ceil(this.cfg.cooldownAfterLossMs / 1000);
    this.log("warn", `[Risk Cooldown] Entering ${secs}s cooldown — ${reason}`);
    notify("RISK_COOLDOWN", { reason, durationSec: secs });
  }

  private addWarning(msg: string): void {
    if (!this.warnings.includes(msg)) {
      this.warnings.push(msg);
      if (this.state === "ACTIVE") this.state = "WARNING";
    }
  }

  // ── Manual controls ───────────────────────────────────────────────────────

  /** Clear a HALTED state (operator action). Does not reset PnL buckets. */
  clearHalt(): void {
    if (this.state !== "HALTED") return;
    this.state      = "ACTIVE";
    this.haltReason = null;
    this.warnings   = [];
    this.log("info", "[Risk] Halt cleared by operator — trading may resume");
  }

  /** Clear an active cooldown early (operator action). */
  clearCooldown(): void {
    if (this.state !== "COOLDOWN") return;
    this.cooldownUntil     = null;
    this.consecutiveLosses = 0;
    this.state             = "ACTIVE";
    this.log("info", "[Risk Cooldown] Cooldown cleared by operator");
  }

  /** Reset daily/weekly/monthly PnL buckets (operator action). Also clears a loss-limit halt. */
  resetDailyPnl(): void {
    this.daily   = { key: "", pnlUsd: 0 };
    this.weekly  = { key: "", pnlUsd: 0 };
    this.monthly = { key: "", pnlUsd: 0 };
    if (
      this.state === "HALTED" &&
      this.haltReason &&
      (this.haltReason.includes("loss limit") ||
       this.haltReason.includes("Daily") ||
       this.haltReason.includes("Weekly") ||
       this.haltReason.includes("Monthly"))
    ) {
      this.state      = "ACTIVE";
      this.haltReason = null;
      this.warnings   = [];
    }
    this.log("info", "[Risk] PnL counters (daily/weekly/monthly) reset by operator");
  }

  /** Reset the consecutive loss streak counter (operator action). Also lifts an active cooldown. */
  resetLossStreak(): void {
    this.consecutiveLosses = 0;
    if (this.state === "COOLDOWN") {
      this.cooldownUntil = null;
      this.state         = this.warnings.length > 0 ? "WARNING" : "ACTIVE";
    }
    this.log("info", "[Risk] Consecutive loss streak reset by operator");
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  getStatus(): AdvancedRiskStatus {
    const remaining = this.cooldownUntil
      ? Math.max(0, this.cooldownUntil - Date.now())
      : 0;
    const drawdownPct = this.peakBalance > 0
      ? (this.peakBalance - this.currentBalance) / this.peakBalance
      : 0;

    return {
      state:               this.state,
      drawdownPct:         Math.max(0, drawdownPct),
      peakBalance:         this.peakBalance,
      currentBalance:      this.currentBalance,
      dailyPnlUsd:         this.daily.pnlUsd,
      weeklyPnlUsd:        this.weekly.pnlUsd,
      monthlyPnlUsd:       this.monthly.pnlUsd,
      consecutiveLosses:   this.consecutiveLosses,
      cooldownUntil:       this.cooldownUntil,
      cooldownRemainingMs: remaining,
      volatilityBlocked:   this.volatilityBlocked,
      volatilityReason:    this.volatilityReason,
      haltReason:          this.haltReason,
      warnings:            [...this.warnings],
      config:              { ...this.cfg },
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Process-level singleton wired into bot.ts. */
export const advancedRiskEngine = new AdvancedRiskEngine();
