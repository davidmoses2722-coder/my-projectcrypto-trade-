import { logger } from "./logger";
import * as store from "./store";
import type { TradeSource } from "../queues/tradeQueue";

/**
 * Risk Manager — server-side trade safety layer.
 *
 * Enforces:
 *  1. Position size limit (% of free balance)
 *  2. Max risk per trade (% of balance risked at SL)
 *  3. Daily loss protection (hard halt when PnL drops below limit)
 *  4. Max open positions (duplicate-position guard)
 *  5. Trade cooldown (anti-overtrading)
 *  6. Daily trade cap (anti-overtrading)
 *  7. Minimum balance floor
 *
 * Usage:
 *   const result = riskManager.check({ symbol, side, requestedAmountUsdt, currentPrice, balanceFreeUsdt, slPrice });
 *   if (!result.allowed) return; // blocked
 *   // place order with result.safeAmountUsdt
 *   riskManager.recordEntry(symbol, side, entryPrice, qty, notionalUsd, slPrice, tpPrice);
 *   // on close:
 *   riskManager.recordExit(symbol, pnlUsd);
 */

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RiskConfig {
  maxPositionSizePct: number;   // 0.10 = 10% of free balance max per trade
  maxRiskPerTradePct: number;   // 0.01 = risk at most 1% of balance on SL hit
  maxDailyLossUsd: number;      // e.g. -50 — halt if daily PnL drops below
  maxOpenPositions: number;     // 1 = single concurrent position
  minBalanceUsd: number;        // don't trade if free balance < this
  tradeCooldownMs: number;      // min ms between trade entries
  maxTradesPerDay: number;      // daily trade cap
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionSizePct: 0.10,
  maxRiskPerTradePct: 0.01,
  maxDailyLossUsd: -50,
  maxOpenPositions: 2,   // up to 2 simultaneous positions (1 per symbol enforced separately)
  minBalanceUsd: 10,
  tradeCooldownMs: 30_000,
  maxTradesPerDay: 20,
};

// ─── Internal state ───────────────────────────────────────────────────────────

interface DailyBucket {
  date: string;
  pnlUsd: number;
  tradeCount: number;
}

export interface OpenPosition {
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  qty: number;
  notionalUsd: number;
  tpPrice: number | null;
  slPrice: number | null;
  openedAt: number;
}

// ─── Public I/O types ─────────────────────────────────────────────────────────

export interface RiskCheckInput {
  symbol: string;
  side: "buy" | "sell";
  requestedAmountUsdt: number;
  currentPrice: number;
  balanceFreeUsdt: number;
  slPrice?: number;
  tpPrice?: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  safeAmountUsdt: number;
  riskAmountUsd: number;
  warnings: string[];
}

export interface RiskState {
  isHalted: boolean;
  haltReason: string | null;
  dailyPnlUsd: number;
  dailyTradeCount: number;
  openPositionCount: number;
  openSymbols: string[];
  lastTradeAt: number;
  msSinceLast: number;
  config: RiskConfig;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── RiskManager class ────────────────────────────────────────────────────────

/**
 * Per-user RiskManager.
 *
 * Each user gets an independent instance (see userRiskRegistry.ts).
 * This ensures User A's daily loss, halt, and open positions never
 * interfere with User B's trading.
 *
 * Pass userId for logging context; 0 means the legacy global singleton.
 */
export class RiskManager {
  private cfg: RiskConfig = { ...DEFAULT_RISK_CONFIG };
  private day: DailyBucket = { date: todayUtc(), pnlUsd: 0, tradeCount: 0 };
  private positions = new Map<string, OpenPosition>();
  private lastTradeAt = 0;
  private haltReason: string | null = null;
  readonly userId: number;
  readonly source: TradeSource;
  private readonly persistsDailyState: boolean;

  constructor(userId = 0, source: TradeSource = "BOT") {
    this.userId = userId;
    this.source = source;
    this.persistsDailyState = source === "BOT";
  }

  private syncDay(): void {
    const today = todayUtc();
    if (this.day.date !== today) {
      this.day = { date: today, pnlUsd: 0, tradeCount: 0 };
      this.haltReason = null;
      logger.info("RiskManager: new trading day — daily counters reset");
    }
  }

  // ── Config ────────────────────────────────────────────────────────────────

  updateConfig(patch: Partial<RiskConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    logger.info({ cfg: this.cfg }, "RiskManager: config updated");
  }

  getConfig(): RiskConfig {
    return { ...this.cfg };
  }

  // ── Core pre-trade check ─────────────────────────────────────────────────

  check(input: RiskCheckInput): RiskCheckResult {
    this.syncDay();
    const warnings: string[] = [];
    const { cfg, day } = this;

    // ── Rule 1: Hard halt (manual or daily loss) ─────────────────────────
    if (this.haltReason) {
      return blocked(`Trading halted: ${this.haltReason}`, warnings);
    }

    // ── Rule 2: Daily loss limit ─────────────────────────────────────────
    if (day.pnlUsd <= cfg.maxDailyLossUsd) {
      const reason = `daily loss limit hit ($${day.pnlUsd.toFixed(2)} ≤ $${cfg.maxDailyLossUsd})`;
      this.haltReason = reason;
      logger.warn({ reason }, "RiskManager: halt triggered by daily loss limit");
      return blocked(`Trading halted: ${reason}`, warnings);
    }

    // ── Rule 3: Minimum free balance ─────────────────────────────────────
    if (input.balanceFreeUsdt < cfg.minBalanceUsd) {
      return blocked(
        `Insufficient free balance: $${input.balanceFreeUsdt.toFixed(2)} < minimum $${cfg.minBalanceUsd}`,
        warnings,
      );
    }

    // ── Rule 4: Duplicate position guard ─────────────────────────────────
    if (this.positions.has(input.symbol)) {
      return blocked(`Duplicate trade blocked: ${input.symbol} already has an open position`, warnings);
    }

    // ── Rule 5: Max concurrent positions ─────────────────────────────────
    if (this.positions.size >= cfg.maxOpenPositions) {
      return blocked(
        `Max open positions reached (${this.positions.size}/${cfg.maxOpenPositions})`,
        warnings,
      );
    }

    // ── Rule 6: Trade cooldown ────────────────────────────────────────────
    const msSinceLast = Date.now() - this.lastTradeAt;
    if (this.lastTradeAt > 0 && msSinceLast < cfg.tradeCooldownMs) {
      const waitSec = Math.ceil((cfg.tradeCooldownMs - msSinceLast) / 1000);
      return blocked(`Trade cooldown active — wait ${waitSec}s before next entry`, warnings);
    }

    // ── Rule 7: Daily trade cap ───────────────────────────────────────────
    if (day.tradeCount >= cfg.maxTradesPerDay) {
      return blocked(`Daily trade cap reached (${day.tradeCount}/${cfg.maxTradesPerDay})`, warnings);
    }

    // ── Position sizing ────────────────────────────────────────────────────

    // Cap 1: % of free balance
    const maxByBalancePct = input.balanceFreeUsdt * cfg.maxPositionSizePct;

    // Cap 2: max $ risk if SL is known
    let maxByRisk: number;
    if (input.slPrice != null && input.slPrice > 0 && input.currentPrice > 0) {
      const riskFrac = Math.abs(input.currentPrice - input.slPrice) / input.currentPrice;
      if (riskFrac > 0) {
        const dollarRiskBudget = input.balanceFreeUsdt * cfg.maxRiskPerTradePct;
        maxByRisk = dollarRiskBudget / riskFrac;
      } else {
        maxByRisk = maxByBalancePct;
      }
    } else {
      // No SL price supplied — fall back to pure % of balance cap (more conservative)
      maxByRisk = input.balanceFreeUsdt * cfg.maxRiskPerTradePct * 100; // treat as if SL is 1%
      warnings.push("No stop-loss price supplied; using balance-% cap only (risk = unquantified)");
    }

    // Cap 3: hard limit — never exceed 95% of free balance in any single trade
    const maxAbsolute = input.balanceFreeUsdt * 0.95;

    const safeAmountUsdt = Math.min(
      input.requestedAmountUsdt,
      maxByBalancePct,
      maxByRisk,
      maxAbsolute,
    );

    if (safeAmountUsdt <= 0) {
      return blocked("Risk constraints reduce position size to zero — trade blocked", warnings);
    }

    if (safeAmountUsdt < input.requestedAmountUsdt - 0.01) {
      warnings.push(
        `Position size reduced from $${input.requestedAmountUsdt.toFixed(2)} to $${safeAmountUsdt.toFixed(2)} by risk rules`,
      );
    }

    // Estimated dollar risk at SL
    const riskAmountUsd =
      input.slPrice != null && input.slPrice > 0
        ? safeAmountUsdt * Math.abs(input.currentPrice - input.slPrice) / input.currentPrice
        : safeAmountUsdt * 0.01;

    return { allowed: true, safeAmountUsdt, riskAmountUsd, warnings };
  }

  /**
   * Restore a position that was already open before a restart — does NOT
   * increment tradeCount/lastTradeAt (this isn't a new trade, just recovering
   * state we already had). Used by bot.ts's boot-time restoration.
   */
  restorePosition(pos: OpenPosition): void {
    this.positions.set(pos.symbol, { ...pos });
    logger.info({ symbol: pos.symbol, openPositions: this.positions.size }, "RiskManager: position restored from persistence");
  }

  // ── Post-fill recording ───────────────────────────────────────────────────

  recordEntry(
    symbol: string,
    side: "buy" | "sell",
    entryPrice: number,
    qty: number,
    notionalUsd: number,
    slPrice?: number,
    tpPrice?: number,
  ): void {
    this.syncDay();
    this.positions.set(symbol, {
      symbol, side, entryPrice, qty, notionalUsd,
      slPrice: slPrice ?? null,
      tpPrice: tpPrice ?? null,
      openedAt: Date.now(),
    });
    this.day.tradeCount++;
    this.lastTradeAt = Date.now();
    logger.info({ symbol, side, notionalUsd, openPositions: this.positions.size }, "RiskManager: entry recorded");
  }

  recordExit(symbol: string, pnlUsd: number): void {
    this.syncDay();
    const wasOpen = this.positions.delete(symbol);
    if (wasOpen) {
      this.day.pnlUsd += pnlUsd;
      this.day.tradeCount = Math.max(this.day.tradeCount, this.day.tradeCount); // already bumped in recordEntry
      logger.info({ symbol, pnlUsd, dailyPnl: this.day.pnlUsd }, "RiskManager: exit recorded");
      if (this.day.pnlUsd <= this.cfg.maxDailyLossUsd && !this.haltReason) {
        this.haltReason = `daily loss limit hit ($${this.day.pnlUsd.toFixed(2)} ≤ $${this.cfg.maxDailyLossUsd})`;
        logger.warn({ haltReason: this.haltReason }, "RiskManager: halt triggered after exit");
        void store.logRiskEvent({
          eventType: "DAILY_LIMIT",
          symbol,
          reason: this.haltReason,
          pnlUsd: this.day.pnlUsd,
          meta: { maxDailyLossUsd: this.cfg.maxDailyLossUsd },
        });
      }
      // Only automated strategy risk is persisted in the bot's daily bucket.
      // Manual execution has an independent in-memory risk state and must
      // never change the bot's persisted daily counter or halt state.
      if (this.persistsDailyState) {
        void store.upsertTodayPnl({
          pnlUsd: this.day.pnlUsd,
          tradeCount: this.day.tradeCount,
          isHalted: this.haltReason !== null,
          haltReason: this.haltReason,
        });
      }
    }
  }

  // Keep daily PnL in sync with the bot's own tracker
  syncDailyPnl(pnlUsd: number): void {
    this.syncDay();
    this.day.pnlUsd = pnlUsd;
  }

  /**
   * Restore daily state from DB after server restart.
   * Call this once during startup before allowing any trades.
   */
  async hydrateFromDb(): Promise<void> {
    if (!this.persistsDailyState) {
      logger.info({ userId: this.userId, source: this.source }, "RiskManager: manual state starts independently");
      return;
    }
    try {
      const row = await store.loadTodayPnl();
      if (!row) {
        logger.info("RiskManager: no daily PnL row for today — starting fresh");
        return;
      }
      this.syncDay(); // ensure day bucket is for today
      this.day.pnlUsd = row.pnlUsd;
      this.day.tradeCount = row.tradeCount;
      if (row.isHalted && row.haltReason && !this.haltReason) {
        this.haltReason = row.haltReason;
        logger.warn(
          { haltReason: this.haltReason, dailyPnl: this.day.pnlUsd },
          "RiskManager: restored halted state from DB — trading remains blocked",
        );
      } else {
        logger.info(
          { dailyPnl: this.day.pnlUsd, tradeCount: this.day.tradeCount },
          "RiskManager: daily PnL restored from DB",
        );
      }
    } catch (e) {
      logger.error({ err: e }, "RiskManager.hydrateFromDb failed");
    }
  }

  // Manual halt / resume controls
  forceHalt(reason = "manual halt"): void {
    this.haltReason = reason;
    logger.warn({ reason }, "RiskManager: force-halted");
    if (!this.persistsDailyState) return;
    void store.logRiskEvent({ eventType: "MANUAL_HALT", reason });
    void store.upsertTodayPnl({
      pnlUsd: this.day.pnlUsd,
      tradeCount: this.day.tradeCount,
      isHalted: true,
      haltReason: reason,
    });
  }

  clearHalt(): void {
    this.haltReason = null;
    logger.info("RiskManager: halt cleared");
    if (!this.persistsDailyState) return;
    void store.logRiskEvent({ eventType: "HALT_CLEARED", reason: "halt cleared by operator" });
    void store.upsertTodayPnl({
      pnlUsd: this.day.pnlUsd,
      tradeCount: this.day.tradeCount,
      isHalted: false,
      haltReason: null,
    });
  }

  /**
   * Update the stop-loss price for an open position (trailing stop).
   * Enforces the "never move stop backwards" rule — only raises SL for longs.
   * Returns true if the update was applied, false if it was rejected.
   */
  updatePositionStop(symbol: string, newSlPrice: number): boolean {
    const pos = this.positions.get(symbol);
    if (!pos) return false;
    // Never move stop backwards (lower SL for a long position is forbidden)
    if (pos.slPrice !== null && newSlPrice <= pos.slPrice) return false;
    this.positions.set(symbol, { ...pos, slPrice: newSlPrice });
    logger.info({ symbol, oldSl: pos.slPrice, newSl: newSlPrice }, "RiskManager: trailing stop raised");
    return true;
  }

  hasOpenPosition(symbol: string): boolean {
    return this.positions.has(symbol);
  }

  getOpenPosition(symbol: string): OpenPosition | undefined {
    return this.positions.get(symbol);
  }

  /** Returns all currently tracked open positions (used by positionMonitor). */
  getAllOpenPositions(): OpenPosition[] {
    return Array.from(this.positions.values());
  }

  // ── State snapshot ────────────────────────────────────────────────────────

  getState(): RiskState {
    this.syncDay();
    return {
      isHalted: this.haltReason !== null,
      haltReason: this.haltReason,
      dailyPnlUsd: this.day.pnlUsd,
      dailyTradeCount: this.day.tradeCount,
      openPositionCount: this.positions.size,
      openSymbols: Array.from(this.positions.keys()),
      lastTradeAt: this.lastTradeAt,
      msSinceLast: this.lastTradeAt > 0 ? Date.now() - this.lastTradeAt : -1,
      config: { ...this.cfg },
    };
  }
}

// ─── Singleton export (legacy — prefer getUserRiskManager(userId)) ────────────

export const riskManager = new RiskManager(0);

// ─── Util ──────────────────────────────────────────────────────────────────────

function blocked(reason: string, warnings: string[]): RiskCheckResult {
  logger.warn({ reason }, "RiskManager: trade blocked");
  return { allowed: false, reason, safeAmountUsdt: 0, riskAmountUsd: 0, warnings };
}
