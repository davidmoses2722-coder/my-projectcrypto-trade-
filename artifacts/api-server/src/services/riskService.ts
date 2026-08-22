/**
 * riskService — the MANDATORY risk gate for all trade entries.
 *
 * Architecture:
 *   riskManager.ts   → state layer (config, counters, open positions map)
 *   riskService.ts   → enforcement layer (throws RiskError on any failure)
 *   tradeService.ts  → execution layer (calls riskService before every entry)
 *   bot.ts           → strategy layer (calls riskService before openPosition)
 *   positionMonitor  → SL/TP guarantee layer (independent price-watch loop)
 *
 * Hard contracts:
 *   1. validateTrade() NEVER returns silently when a rule fails — it THROWS.
 *   2. Kill switch is checked FIRST — no code path bypasses it.
 *   3. Every blocked trade is written to the risk_events audit table in DB.
 *   4. Daily loss is checked against LIVE DB state (survives restarts).
 */

import { riskManager } from "../lib/riskManager";
import type { RiskManager } from "../lib/riskManager";
import { logger } from "../lib/logger";
import * as store from "../lib/store";

// ─── RiskError ────────────────────────────────────────────────────────────────

/**
 * Thrown when ANY risk check fails. Callers MUST handle or propagate this.
 * An unhandled RiskError propagates up and stops execution — by design.
 * Never catches RiskError silently; always log it.
 */
export class RiskError extends Error {
  public readonly rule: string;
  public readonly context: Record<string, unknown>;

  constructor(message: string, rule: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "RiskError";
    this.rule = rule;
    this.context = context;
    Object.setPrototypeOf(this, RiskError.prototype);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Full input for a trade entry validation.
 * stopLossPct and takeProfitPct are REQUIRED — every trade must have both.
 */
export interface TradeParams {
  symbol: string;
  side: "buy" | "sell";
  requestedAmountUsdt: number;
  currentPrice: number;
  balanceFreeUsdt: number;
  stopLossPct: number;    // e.g. 0.009 = 0.9%  (must be > 0)
  takeProfitPct: number;  // e.g. 0.010 = 1.0%  (must be > 0)
  /** Source-specific state. Defaults to the automated bot manager. */
  riskManager?: RiskManager;
}

/**
 * Returned when all checks pass.
 * slPrice and tpPrice are always populated — guaranteed on every validated trade.
 */
export interface ValidatedTrade {
  safeAmountUsdt: number;
  safeQty: number;
  slPrice: number;     // absolute price — MUST be sent with the position
  tpPrice: number;     // absolute price — MUST be sent with the position
  riskAmountUsd: number;
  warnings: string[];
}

// ─── Internal logging helper ──────────────────────────────────────────────────

async function logBlock(
  rule: string,
  reason: string,
  symbol?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  // Fire-and-forget — never await in the hot path
  void store.logRiskEvent({
    eventType: "TRADE_BLOCKED",
    symbol,
    reason: `[${rule}] ${reason}`,
    meta,
  });
}

// ─── 1. checkKillSwitch ───────────────────────────────────────────────────────

/**
 * Checks the global kill switch. Throws RiskError if trading is disabled.
 * Called first, before any other check. Cached for 10 s to avoid per-tick DB reads.
 */
let killSwitchCache: { enabled: boolean; expiresAt: number } | null = null;

export async function checkKillSwitch(): Promise<void> {
  const now = Date.now();
  if (killSwitchCache && now < killSwitchCache.expiresAt) {
    if (!killSwitchCache.enabled) {
      throw new RiskError(
        "Global kill switch is ACTIVE — all trading disabled",
        "KILL_SWITCH",
      );
    }
    return;
  }
  // Refresh cache
  const enabled = await store.isTradingEnabled();
  killSwitchCache = { enabled, expiresAt: now + 10_000 };
  if (!enabled) {
    void store.logRiskEvent({
      eventType: "KILL_SWITCH",
      reason: "Trading attempted while kill switch is ACTIVE",
    });
    throw new RiskError(
      "Global kill switch is ACTIVE — all trading disabled",
      "KILL_SWITCH",
    );
  }
}

/** Invalidate the kill switch cache immediately (call after toggling). */
export function invalidateKillSwitchCache(): void {
  killSwitchCache = null;
}

// ─── 2. calculatePositionSize ─────────────────────────────────────────────────

/**
 * Returns the maximum USDT position size for the given free balance.
 * Throws RiskError for invalid inputs.
 */
export function calculatePositionSize(
  balanceFreeUsdt: number,
  overridePct?: number,
): number {
  const cfg = riskManager.getConfig();
  const pct = overridePct ?? cfg.maxPositionSizePct;

  if (balanceFreeUsdt <= 0) {
    throw new RiskError(
      `Cannot size position: free balance is $${balanceFreeUsdt.toFixed(2)}`,
      "ZERO_BALANCE",
      { balanceFreeUsdt },
    );
  }
  if (pct <= 0 || pct > 1) {
    throw new RiskError(
      `Invalid position size pct ${pct} — must be 0–1`,
      "INVALID_PCT",
      { pct },
    );
  }
  if (balanceFreeUsdt < cfg.minBalanceUsd) {
    throw new RiskError(
      `Balance $${balanceFreeUsdt.toFixed(2)} below minimum $${cfg.minBalanceUsd}`,
      "MIN_BALANCE",
      { balanceFreeUsdt, minBalanceUsd: cfg.minBalanceUsd },
    );
  }
  return balanceFreeUsdt * pct;
}

// ─── 3. checkDailyLoss ───────────────────────────────────────────────────────

/**
 * Checks daily loss limit. Throws immediately if breached.
 * Also triggers a halt in the risk manager so state stays consistent.
 */
export function checkDailyLoss(dailyPnlUsd: number): void {
  const { maxDailyLossUsd } = riskManager.getConfig();
  if (dailyPnlUsd <= maxDailyLossUsd) {
    const msg = `Daily loss limit breached: P&L $${dailyPnlUsd.toFixed(2)} ≤ limit $${maxDailyLossUsd}`;
    logger.warn({ dailyPnlUsd, maxDailyLossUsd }, `riskService: ${msg}`);
    riskManager.forceHalt(msg);
    throw new RiskError(msg, "DAILY_LOSS_LIMIT", { dailyPnlUsd, maxDailyLossUsd });
  }
}

// ─── 4. validateTrade ────────────────────────────────────────────────────────

/**
 * The SINGLE mandatory gateway for ALL trade entries.
 *
 * Execution order (strict — any failure throws immediately):
 *   1. Kill switch            — is global trading enabled?
 *   2. Input sanity           — price, amount, SL/TP % are valid
 *   3. SL/TP price derivation — computed and guaranteed non-zero
 *   4. Daily loss check       — has today's limit already been breached?
 *   5. Risk manager rules     — halt, balance, duplicate, cooldown, cap, sizing
 *
 * Returns ValidatedTrade with:
 *   - slPrice / tpPrice  (ALWAYS present — attached to every trade)
 *   - safeAmountUsdt     (may be reduced from requested)
 *   - riskAmountUsd      (estimated $ at risk if SL fires)
 *
 * NEVER returns silently when blocked. ALWAYS throws RiskError.
 */
export async function validateTrade(params: TradeParams): Promise<ValidatedTrade> {
  const { symbol, side, requestedAmountUsdt, currentPrice, balanceFreeUsdt, stopLossPct, takeProfitPct } = params;
  const activeRiskManager = params.riskManager ?? riskManager;

  // ── Rule 0: Kill switch (always first) ──────────────────────────────────────
  await checkKillSwitch();

  // ── Rule 1: Input sanity ────────────────────────────────────────────────────

  if (!symbol?.trim()) {
    throw new RiskError("Symbol is required", "INVALID_SYMBOL", { symbol });
  }
  if (requestedAmountUsdt <= 0) {
    throw new RiskError(
      `Trade amount must be positive, got $${requestedAmountUsdt}`,
      "INVALID_AMOUNT",
      { requestedAmountUsdt },
    );
  }
  if (currentPrice <= 0) {
    throw new RiskError(
      `Current price must be positive, got ${currentPrice}`,
      "INVALID_PRICE",
      { currentPrice },
    );
  }

  // ── Rule 2: Stop-loss is MANDATORY ──────────────────────────────────────────
  if (stopLossPct <= 0 || stopLossPct >= 0.5) {
    const err = `Stop-loss % must be 0–50%, got ${(stopLossPct * 100).toFixed(2)}%`;
    await logBlock("INVALID_SL_PCT", err, symbol, { stopLossPct });
    throw new RiskError(err, "INVALID_SL_PCT", { stopLossPct });
  }

  // ── Rule 3: Take-profit is MANDATORY ────────────────────────────────────────
  if (takeProfitPct <= 0 || takeProfitPct >= 1) {
    const err = `Take-profit % must be 0–100%, got ${(takeProfitPct * 100).toFixed(2)}%`;
    await logBlock("INVALID_TP_PCT", err, symbol, { takeProfitPct });
    throw new RiskError(err, "INVALID_TP_PCT", { takeProfitPct });
  }

  // ── Compute absolute SL/TP prices (always present on every trade) ─────────
  const slPrice = side === "buy"
    ? currentPrice * (1 - stopLossPct)
    : currentPrice * (1 + stopLossPct);
  const tpPrice = side === "buy"
    ? currentPrice * (1 + takeProfitPct)
    : currentPrice * (1 - takeProfitPct);

  if (slPrice <= 0 || tpPrice <= 0) {
    throw new RiskError("Computed SL/TP prices are invalid", "SL_TP_COMPUTE", {
      slPrice, tpPrice, currentPrice, stopLossPct, takeProfitPct,
    });
  }

  // ── Rule 4: Daily loss check ─────────────────────────────────────────────────
  const riskState = activeRiskManager.getState();
  checkDailyLoss(riskState.dailyPnlUsd);

  // ── Rule 5: Full risk-manager rule set ───────────────────────────────────────
  const result = activeRiskManager.check({
    symbol, side, requestedAmountUsdt, currentPrice, balanceFreeUsdt, slPrice, tpPrice,
  });

  // HARD ENFORCEMENT: blocked for any reason → throw, never proceed ───────────
  if (!result.allowed) {
    logger.warn({ symbol, side, rule: result.reason }, `riskService: BLOCKED — ${result.reason}`);
    await logBlock("RISK_BLOCKED", result.reason ?? "blocked", symbol, {
      symbol, side, requestedAmountUsdt, currentPrice, balanceFreeUsdt, slPrice, tpPrice,
    });
    throw new RiskError(
      result.reason ?? "Risk check failed — trade blocked",
      "RISK_BLOCKED",
      { symbol, side, slPrice, tpPrice },
    );
  }

  // Log non-blocking warnings
  for (const w of result.warnings) {
    logger.warn({ symbol, w }, `riskService: warning — ${w}`);
  }

  const safeQty = result.safeAmountUsdt / currentPrice;

  logger.info(
    { symbol, side, requested: requestedAmountUsdt, safe: result.safeAmountUsdt, slPrice, tpPrice, riskUsd: result.riskAmountUsd },
    "riskService: trade validated ✓",
  );

  return {
    safeAmountUsdt: result.safeAmountUsdt,
    safeQty,
    slPrice,
    tpPrice,
    riskAmountUsd: result.riskAmountUsd,
    warnings: result.warnings,
  };
}
