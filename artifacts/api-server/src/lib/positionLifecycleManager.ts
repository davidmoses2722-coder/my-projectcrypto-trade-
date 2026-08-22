/**
 * positionLifecycleManager — Phase 11 Position Lifecycle & Execution Management.
 *
 * Runs alongside the existing positionMonitor and tradeMonitorService (does NOT replace them).
 * Those two remain the hard SL/TP enforcement layers.
 *
 * This service adds:
 *   • Dynamic trailing stop (ATR-based, breakeven at +1R, never backwards)
 *   • Profit protection tiers (25 / 50 / 75 / 90 %)
 *   • Time-based exit (per strategy type)
 *   • Momentum exit (RSI + retrace + volume + ATR contraction + EMA proxy)
 *   • Position health score (0–100)
 *   • Full per-trade timeline event log
 *   • Telegram notifications for all lifecycle events
 */

import { logger } from "./logger";
import { riskManager } from "./riskManager";
import * as exchangeService from "../services/exchangeService";
import * as telegramNotifier from "./telegramNotifier";
import * as store from "./store";
import { publishEvent } from "./eventBus";

// ─── Constants ────────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 2_000;
const TRAIL_ATR_MULTIPLIER = 2.0;
const MIN_HISTORY_MOMENTUM = 20;

/** Strategy-specific time limits before a time-exit is considered. */
const TIME_EXIT_MS: Record<string, number> = {
  scalping:                15 * 60_000,
  "conservative-scalping": 20 * 60_000,
  "conservative_scalping": 20 * 60_000,
  "day-trading":           8 * 3_600_000,
  "day_trading":           8 * 3_600_000,
  day:                     8 * 3_600_000,
  swing:                   24 * 3_600_000,
  "active-swing":          12 * 3_600_000,
  "active_swing":          12 * 3_600_000,
  dca:                     48 * 3_600_000,
  grid:                    72 * 3_600_000,
};
const DEFAULT_TIME_EXIT_MS = 12 * 3_600_000;

/**
 * Profit protection tiers.
 * When (currentPrice − entry) / (tp − entry) >= atProfitFrac
 * → move SL to entry + lockFrac × (tp − entry), protecting that slice.
 */
const PROFIT_TIERS = [
  { atProfitFrac: 0.90, lockFrac: 0.85, pct: 90 },
  { atProfitFrac: 0.75, lockFrac: 0.70, pct: 75 },
  { atProfitFrac: 0.50, lockFrac: 0.45, pct: 50 },
  { atProfitFrac: 0.25, lockFrac: 0.20, pct: 25 },
] as const;

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface TradeTimelineEvent {
  time:   string;
  event:  string;
  detail: string;
}

export interface PositionLifecycle {
  positionId:        string;   // stable id — matches portfolioRegistry position id (orderId); persisted as the DB key
  source:            "BOT" | "MANUAL";
  isPaper:           boolean;
  sizeUsdt:          number;
  originalQty:       number;   // qty at entry — used to compute remaining % after a partial close
  symbol:            string;
  entryPrice:        number;
  currentPrice:      number;
  highestPrice:      number;
  lowestPrice:       number;
  unrealizedPnlUsd:  number;
  unrealizedPnlPct:  number;
  openedAt:          number;           // ms epoch
  durationMs:        number;
  tpPrice:           number | null;    // current TP (may have been adjusted)
  slPrice:           number | null;    // current SL (trailed)
  initialSlPrice:    number | null;    // original SL, never changes
  initialTpPrice:    number | null;    // original TP, never changes
  trailingActive:    boolean;   // true once trailing has actually engaged (moved the SL at least once)
  trailingEnabled:   boolean;   // user intent — single source of truth consulted by updateTrailingStop(); default true preserves prior always-on behaviour
  breakevenActive:   boolean;
  lockedProfitPct:   number;           // highest tier locked so far (0 / 25 / 50 / 75 / 90)
  lockedSlPrice:     number | null;    // SL price that locked profit
  rrMultiple:        number;           // current R:R multiple
  initialRisk:       number;           // entry − initialSL (1R in price)
  profitPctOfTP:     number;           // 0–1 progress from entry toward TP
  distToTpPct:       number | null;    // % distance from current to TP
  distToSlPct:       number | null;    // % distance from SL to current
  healthScore:       number;           // 0–100
  healthColor:       "green" | "yellow" | "red";
  momentumScore:     number;           // 0–100 sub-score
  atrEstimate:       number | null;
  volume:            number | null;
  entryVolume:       number | null;
  strategyType:      string;
  timeline:          TradeTimelineEvent[];
}

export type LifecycleCloseCallback = (
  symbol: string,
  reason: string,
  price:  number,
) => Promise<void>;

// ─── Internal per-position tracking ──────────────────────────────────────────

interface InternalState {
  lc:             PositionLifecycle;
  priceHistory:   number[];   // tick prices (max 200)
  volumeHistory:  number[];   // tick volumes (max 60)
  atrHistory:     number[];   // 24h high−low ranges (max 14)
}

// ─── RSI helper ───────────────────────────────────────────────────────────────

function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  const start = prices.length - period;
  for (let i = start; i < prices.length; i++) {
    const diff = (prices[i] ?? 0) - (prices[i - 1] ?? 0);
    if (diff > 0) gains += diff; else losses += -diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

// ─── Duration formatter ───────────────────────────────────────────────────────

function fmtDur(ms: number): string {
  const s = ms / 1000;
  if (s < 60)    return `${Math.floor(s)}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

// ─── PositionLifecycleManager ─────────────────────────────────────────────────

class PositionLifecycleManager {
  private states     = new Map<string, InternalState>();
  private timer:     ReturnType<typeof setInterval> | null = null;
  private onClose:   LifecycleCloseCallback | null = null;
  private closing    = new Set<string>();   // symbols with an exit in flight

  // ── Public API ─────────────────────────────────────────────────────────────

  start(onClose: LifecycleCloseCallback): void {
    if (this.timer) return;
    this.onClose = onClose;
    this.timer = setInterval(() => { void this.tick(); }, TICK_INTERVAL_MS);
    logger.info({ intervalMs: TICK_INTERVAL_MS }, "positionLifecycle: started");
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info("positionLifecycle: stopped");
  }

  isRunning(): boolean { return this.timer !== null; }

  /**
   * Register a new position when the entry fills.
   * @param symbol       Normalised symbol (e.g. "BTCUSDT")
   * @param entryPrice   Fill price
   * @param slPrice      Initial stop-loss price (null if none)
   * @param tpPrice      Initial take-profit price (null if none)
   * @param strategyType Active strategy ID (e.g. "active-swing")
   * @param atr          Optional ATR at entry from strategy signal
   * @param volume       Optional 24h quote volume at entry
   */
  register(
    symbol:       string,
    entryPrice:   number,
    slPrice:      number | null,
    tpPrice:      number | null,
    strategyType: string,
    atr?:         number,
    volume?:      number,
    opts?: {
      positionId?: string;
      source?:     "BOT" | "MANUAL";
      isPaper?:    boolean;
      sizeUsdt?:   number;
      qty?:        number;
    },
  ): void {
    const sym = symbol.toUpperCase();
    const initialRisk = slPrice != null ? Math.max(0, entryPrice - slPrice) : 0;
    const lc: PositionLifecycle = {
      positionId:       opts?.positionId ?? sym,
      source:           opts?.source ?? "BOT",
      isPaper:          opts?.isPaper ?? true,
      sizeUsdt:         opts?.sizeUsdt ?? 0,
      originalQty:      opts?.qty ?? 0,
      symbol:           sym,
      entryPrice,
      currentPrice:     entryPrice,
      highestPrice:     entryPrice,
      lowestPrice:      entryPrice,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      openedAt:         Date.now(),
      durationMs:       0,
      tpPrice,
      slPrice,
      initialSlPrice:   slPrice,
      initialTpPrice:   tpPrice,
      trailingActive:   false,
      trailingEnabled:  true,
      breakevenActive:  false,
      lockedProfitPct:  0,
      lockedSlPrice:    null,
      rrMultiple:       0,
      initialRisk,
      profitPctOfTP:    0,
      distToTpPct:      null,
      distToSlPct:      null,
      healthScore:      70,
      healthColor:      "green",
      momentumScore:    70,
      atrEstimate:      atr ?? null,
      volume:           volume ?? null,
      entryVolume:      volume ?? null,
      strategyType,
      timeline:         [],
    };
    this.addTimeline(lc, "OPENED", `Entry @ $${entryPrice.toFixed(6)} | SL $${slPrice?.toFixed(6) ?? "—"} | TP $${tpPrice?.toFixed(6) ?? "—"}`);
    this.states.set(sym, {
      lc,
      priceHistory:  [entryPrice],
      volumeHistory: volume != null ? [volume] : [],
      atrHistory:    atr != null ? [atr] : [],
    });
    logger.info({ sym, entryPrice, slPrice, tpPrice, strategyType }, "positionLifecycle: registered");
    void this.persist(lc);
  }

  /**
   * Restore a position's full lifecycle state after a restart, from a row
   * already read out of the positions table. Unlike register(), this
   * preserves the original openedAt/trailing/breakeven/profit-lock state
   * instead of resetting it, and does not re-persist (the row already exists).
   */
  restore(row: {
    positionId: string; symbol: string; source: "BOT" | "MANUAL"; isPaper: boolean;
    sizeUsdt: number; originalQty: number; entryPrice: number; currentSlPrice: number | null;
    currentTpPrice: number | null; initialSlPrice: number | null; initialTpPrice: number | null;
    strategyType: string; trailingActive: boolean; breakevenActive: boolean;
    lockedProfitPct: number; openedAt: number;
  }): void {
    const sym = row.symbol.toUpperCase();
    const initialRisk = row.initialSlPrice != null ? Math.max(0, row.entryPrice - row.initialSlPrice) : 0;
    const lc: PositionLifecycle = {
      positionId:       row.positionId,
      source:           row.source,
      isPaper:          row.isPaper,
      sizeUsdt:         row.sizeUsdt,
      originalQty:      row.originalQty,
      symbol:           sym,
      entryPrice:       row.entryPrice,
      currentPrice:     row.entryPrice,
      highestPrice:     row.entryPrice,
      lowestPrice:      row.entryPrice,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      openedAt:         row.openedAt,
      durationMs:       Date.now() - row.openedAt,
      tpPrice:          row.currentTpPrice,
      slPrice:          row.currentSlPrice,
      initialSlPrice:   row.initialSlPrice,
      initialTpPrice:   row.initialTpPrice,
      trailingActive:   row.trailingActive,
      trailingEnabled:  true,
      breakevenActive:  row.breakevenActive,
      lockedProfitPct:  row.lockedProfitPct,
      lockedSlPrice:    row.lockedProfitPct > 0 ? row.currentSlPrice : null,
      rrMultiple:       0,
      initialRisk,
      profitPctOfTP:    0,
      distToTpPct:      null,
      distToSlPct:      null,
      healthScore:      70,
      healthColor:      "green",
      momentumScore:    70,
      atrEstimate:      null,
      volume:           null,
      entryVolume:      null,
      strategyType:     row.strategyType,
      timeline:         [],
    };
    this.addTimeline(lc, "RESTORED", `Restored after restart — SL $${lc.slPrice?.toFixed(6) ?? "—"} | TP $${lc.tpPrice?.toFixed(6) ?? "—"}`);
    this.states.set(sym, {
      lc,
      priceHistory:  [row.entryPrice],
      volumeHistory: [],
      atrHistory:    [],
    });
    logger.info({ sym, positionId: row.positionId }, "positionLifecycle: restored from persistence");
  }

  deregister(symbol: string): void {
    const sym = symbol.toUpperCase();
    this.states.delete(sym);
    this.closing.delete(sym);
    logger.info({ sym }, "positionLifecycle: deregistered");
  }

  /**
   * Write the current lifecycle state to the positions table.
   * Called after every change that should survive a restart (SL/TP moves,
   * trailing/breakeven/profit-lock flags, quantity after a partial close).
   * Final closure (status="closed" + realizedPnlUsd) is written separately
   * by bot.ts once the exit fill's real P&L is known — this call only ever
   * upserts the still-open state.
   */
  private async persist(lc: PositionLifecycle): Promise<void> {
    try {
      await store.upsertPosition({
        positionId:        lc.positionId,
        symbol:            lc.symbol,
        side:              "long",
        source:            lc.source,
        strategy:          lc.strategyType,
        entryPrice:        lc.entryPrice,
        currentPrice:      lc.currentPrice,
        quantity:          riskManager.getOpenPosition(lc.symbol)?.qty ?? lc.originalQty,
        originalQuantity:  lc.originalQty,
        sizeUsdt:          lc.sizeUsdt,
        stopLoss:          lc.slPrice,
        takeProfit:        lc.tpPrice,
        initialStopLoss:   lc.initialSlPrice,
        initialTakeProfit: lc.initialTpPrice,
        unrealizedPnlUsd:  lc.unrealizedPnlUsd,
        trailingActive:    lc.trailingActive,
        breakevenActive:   lc.breakevenActive,
        lockedProfitPct:   lc.lockedProfitPct,
        isPaper:           lc.isPaper,
        status:            "open",
      });
    } catch (e) {
      logger.error({ err: e, positionId: lc.positionId }, "positionLifecycle: persist failed (non-fatal)");
    }
  }

  private emitUpdate(sym: string, action: string, extra?: Record<string, unknown>): void {
    publishEvent({
      type: "position:update",
      payload: { action, symbol: sym, ...extra },
      ts: new Date().toISOString(),
    });
  }

  getAll(): PositionLifecycle[] {
    return Array.from(this.states.values()).map(s => ({
      ...s.lc,
      timeline: [...s.lc.timeline],
    }));
  }

  get(symbol: string): PositionLifecycle | undefined {
    const s = this.states.get(symbol.toUpperCase());
    return s ? { ...s.lc, timeline: [...s.lc.timeline] } : undefined;
  }

  // ── Manual position actions (real implementations) ─────────────────────────
  // These back the /api/positions/:symbol/{breakeven,trailing,lock-profit,
  // close-partial} routes. Each verifies the position actually exists and
  // returns { ok:false, error } on any failure — never a fake { ok:true }.

  /** Move SL to entry immediately (does not wait for the automatic +1R trigger). */
  async activateBreakeven(symbol: string): Promise<{ ok: boolean; error?: string; newStopLoss?: number }> {
    const sym = symbol.toUpperCase();
    const st = this.states.get(sym);
    if (!st) return { ok: false, error: "Position not found" };
    const lc = st.lc;
    if (lc.entryPrice <= 0) return { ok: false, error: "Position has no valid entry price" };
    if (lc.breakevenActive) return { ok: false, error: "Breakeven is already active for this position" };

    const newSl = lc.entryPrice;
    const currentSl = lc.slPrice ?? lc.initialSlPrice;
    if (currentSl != null && newSl <= currentSl) {
      return { ok: false, error: "Breakeven would not improve the current stop-loss" };
    }
    const updated = riskManager.updatePositionStop(sym, newSl);
    if (!updated) return { ok: false, error: "Stop-loss update was rejected (would move backwards or no open position)" };

    lc.slPrice = newSl;
    lc.breakevenActive = true;
    this.addTimeline(lc, "BREAKEVEN_ACTIVATED", `Manual breakeven — SL → $${newSl.toFixed(6)}`);
    logger.info({ sym, newSl }, "positionLifecycle: manual BREAKEVEN activated");
    telegramNotifier.notify("BREAKEVEN_ACTIVATED", {
      symbol: sym, entryPrice: lc.entryPrice, currentPrice: lc.currentPrice, newSl,
      profitUsd: lc.unrealizedPnlUsd, profitPct: lc.unrealizedPnlPct, durationMs: lc.durationMs,
      isPaper: lc.isPaper, manual: true,
    });
    this.emitUpdate(sym, "breakeven", { newSl, automatic: false });
    await this.persist(lc);
    return { ok: true, newStopLoss: newSl };
  }

  /**
   * Enable trailing protection for this specific position.
   * Sets trailingEnabled=true, which is the single flag updateTrailingStop()
   * consults — this does not spin up a second/duplicate monitor, it just
   * un-gates the existing per-tick ATR trailing logic for this position.
   */
  async activateTrailing(symbol: string): Promise<{ ok: boolean; error?: string }> {
    const sym = symbol.toUpperCase();
    const st = this.states.get(sym);
    if (!st) return { ok: false, error: "Position not found" };
    st.lc.trailingEnabled = true;
    this.addTimeline(st.lc, "TRAILING_ENABLED", "Trailing enabled by user");
    logger.info({ sym }, "positionLifecycle: trailing manually enabled");
    telegramNotifier.notify("TRAILING_ACTIVATED", {
      symbol: sym, entryPrice: st.lc.entryPrice, currentPrice: st.lc.currentPrice,
      newSl: st.lc.slPrice ?? st.lc.initialSlPrice, atr: st.lc.atrEstimate ?? 0,
      profitUsd: st.lc.unrealizedPnlUsd, profitPct: st.lc.unrealizedPnlPct, durationMs: st.lc.durationMs,
      isPaper: st.lc.isPaper, manual: true,
    });
    this.emitUpdate(sym, "trailing_on", { automatic: false });
    await this.persist(st.lc);
    return { ok: true };
  }

  /** Disable trailing for this position. Never lowers the SL already in place — just stops future raises. */
  async deactivateTrailing(symbol: string): Promise<{ ok: boolean; error?: string }> {
    const sym = symbol.toUpperCase();
    const st = this.states.get(sym);
    if (!st) return { ok: false, error: "Position not found" };
    st.lc.trailingEnabled = false;
    this.addTimeline(st.lc, "TRAILING_DISABLED", "Trailing disabled by user — existing SL unchanged");
    logger.info({ sym }, "positionLifecycle: trailing manually disabled");
    this.emitUpdate(sym, "trailing_off", { automatic: false });
    await this.persist(st.lc);
    return { ok: true };
  }

  /** Lock in the highest profit tier currently reached, reusing the exact automatic tiered algorithm. */
  async lockProfit(symbol: string): Promise<{ ok: boolean; error?: string; newStopLoss?: number; tierPct?: number }> {
    const sym = symbol.toUpperCase();
    const st = this.states.get(sym);
    if (!st) return { ok: false, error: "Position not found" };
    const lc = st.lc;
    const tier = this.computeProfitLockTier(lc, lc.currentPrice);
    if (!tier) {
      return {
        ok: false,
        error: lc.lockedProfitPct > 0
          ? `No further profit tier reached beyond the ${lc.lockedProfitPct}% already locked`
          : "Price has not reached the first profit-lock tier (25% toward TP) yet",
      };
    }
    const updated = riskManager.updatePositionStop(sym, tier.newLockedSl);
    if (!updated) return { ok: false, error: "Stop-loss update was rejected (would move backwards or no open position)" };

    lc.slPrice = tier.newLockedSl;
    lc.lockedProfitPct = tier.tierPct;
    lc.lockedSlPrice = tier.newLockedSl;
    const qty = riskManager.getOpenPosition(sym)?.qty ?? 0;
    const lockedUsd = (tier.newLockedSl - lc.entryPrice) * qty;
    this.addTimeline(lc, "PROFIT_LOCKED", `Manual lock — ${tier.tierPct}% tier — SL → $${tier.newLockedSl.toFixed(6)}`);
    logger.info({ sym, tierPct: tier.tierPct, newSl: tier.newLockedSl }, "positionLifecycle: manual profit lock");
    telegramNotifier.notify("PROFIT_LOCKED", {
      symbol: sym, entryPrice: lc.entryPrice, currentPrice: lc.currentPrice,
      tierPct: tier.tierPct, newSl: tier.newLockedSl, lockedUsd,
      profitUsd: lc.unrealizedPnlUsd, profitPct: lc.unrealizedPnlPct, durationMs: lc.durationMs,
      isPaper: lc.isPaper, manual: true,
    });
    this.emitUpdate(sym, "lock_profit", { newSl: tier.newLockedSl, tierPct: tier.tierPct, automatic: false });
    await this.persist(lc);
    return { ok: true, newStopLoss: tier.newLockedSl, tierPct: tier.tierPct };
  }

  /**
   * Modify the TP and SL prices for an active position.
   * Persists the change and notifies the risk manager.
   */
  async modifyTpSl(
    symbol:   string,
    tpPrice:  number,
    slPrice:  number,
  ): Promise<{ ok: boolean; error?: string }> {
    const sym = symbol.toUpperCase();
    const st  = this.states.get(sym);
    if (!st) return { ok: false, error: "Position not found" };
    const lc  = st.lc;

    if (slPrice <= 0 || tpPrice <= 0) return { ok: false, error: "TP and SL must be positive prices" };
    if (lc.entryPrice > 0) {
      if (slPrice >= lc.entryPrice) return { ok: false, error: `SL ($${slPrice.toFixed(6)}) must be below entry price ($${lc.entryPrice.toFixed(6)})` };
      if (tpPrice <= lc.entryPrice) return { ok: false, error: `TP ($${tpPrice.toFixed(6)}) must be above entry price ($${lc.entryPrice.toFixed(6)})` };
    }

    const oldTp = lc.tpPrice ?? lc.initialTpPrice;
    const oldSl = lc.slPrice ?? lc.initialSlPrice;

    lc.tpPrice = tpPrice;
    lc.slPrice = slPrice;

    // Update risk manager SL tracking
    riskManager.updatePositionStop(sym, slPrice);

    this.addTimeline(
      lc,
      "TP_SL_MODIFIED",
      `Manual TP/SL update: SL $${oldSl?.toFixed(6)} → $${slPrice.toFixed(6)}, TP $${oldTp?.toFixed(6)} → $${tpPrice.toFixed(6)}`,
    );
    logger.info({ sym, tpPrice, slPrice }, "positionLifecycle: manual TP/SL modified");
    this.emitUpdate(sym, "tpsl_modified", { tpPrice, slPrice });
    await this.persist(lc);
    return { ok: true };
  }

  /**
   * Update the tracked position quantity after a partial close.
   * Called by bot.handlePartialExitFilled to keep lifecycle state consistent.
   */
  updateQty(symbol: string, newQty: number): void {
    const sym = symbol.toUpperCase();
    const st  = this.states.get(sym);
    if (!st) return;
    st.lc.originalQty = newQty;   // originalQty is what persist() reads for the DB record
    this.addTimeline(st.lc, "QTY_REDUCED", `Partial close — new qty: ${newQty.toFixed(6)}`);
    this.emitUpdate(sym, "qty_updated", { newQty });
    void this.persist(st.lc);
  }

  /**
   * Partial close is routed through bot.triggerManualPartialClose which
   * uses the real BullMQ execution pipeline (tradeWorker with closeQty).
   * This stub is kept for any direct callers that haven't been updated.
   */
  async closePartial(_symbol: string, _pct: number): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: "Use POST /api/positions/:symbol/close-partial (routes via bot.triggerManualPartialClose)" };
  }

  // ── Internal tick ──────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    const syms = Array.from(this.states.keys());
    if (syms.length === 0) return;
    await Promise.allSettled(syms.map(sym => this.updatePosition(sym)));
  }

  private async updatePosition(sym: string): Promise<void> {
    const st = this.states.get(sym);
    if (!st) return;

    // Fetch current ticker
    let ticker: Awaited<ReturnType<typeof exchangeService.getTicker>>;
    try {
      ticker = await exchangeService.getTicker(sym);
    } catch {
      return;
    }
    if (!ticker || ticker.last <= 0) return;

    const price     = ticker.last;
    const volume    = ticker.volume ?? null;
    // 24h range as a proxy for daily ATR
    const rangeEst  = ticker.high > 0 && ticker.low > 0
      ? ticker.high - ticker.low
      : null;

    const lc  = st.lc;
    const now = Date.now();

    // Update histories
    st.priceHistory.push(price);
    if (st.priceHistory.length > 200) st.priceHistory.shift();

    if (volume != null) {
      st.volumeHistory.push(volume);
      if (st.volumeHistory.length > 60) st.volumeHistory.shift();
    }
    if (rangeEst != null && rangeEst > 0) {
      st.atrHistory.push(rangeEst);
      if (st.atrHistory.length > 14) st.atrHistory.shift();
    }

    // Rolling ATR estimate from recent high-low ranges
    if (st.atrHistory.length >= 3) {
      lc.atrEstimate = st.atrHistory.reduce((a, b) => a + b, 0) / st.atrHistory.length;
    }

    // Core field updates
    lc.currentPrice  = price;
    lc.highestPrice  = Math.max(lc.highestPrice, price);
    lc.lowestPrice   = Math.min(lc.lowestPrice,  price);
    lc.durationMs    = now - lc.openedAt;
    lc.volume        = volume;

    // PnL
    const openPos = riskManager.getOpenPosition(sym);
    const qty     = openPos?.qty ?? 0;
    lc.unrealizedPnlUsd = (price - lc.entryPrice) * qty;
    lc.unrealizedPnlPct = lc.entryPrice > 0
      ? ((price - lc.entryPrice) / lc.entryPrice) * 100
      : 0;

    // Distances
    if (lc.tpPrice != null && price > 0) {
      lc.distToTpPct = ((lc.tpPrice - price) / price) * 100;
    }
    if (lc.slPrice != null && price > 0) {
      lc.distToSlPct = ((price - lc.slPrice) / price) * 100;
    }

    // R:R multiple
    if (lc.initialRisk > 0) {
      lc.rrMultiple = (price - lc.entryPrice) / lc.initialRisk;
    }

    // Profit as fraction of full TP range
    const tpRange = lc.initialTpPrice != null ? lc.initialTpPrice - lc.entryPrice : 0;
    lc.profitPctOfTP = tpRange > 0
      ? Math.min(1, Math.max(0, (price - lc.entryPrice) / tpRange))
      : 0;

    // ── Apply lifecycle logic (skip if close already in flight) ──────────────
    if (!this.closing.has(sym)) {
      this.updateTrailingStop(lc, sym, price);
      this.checkProfitProtection(lc, sym, price, qty);
    }

    // ── Health score ──────────────────────────────────────────────────────────
    const { score, momentumScore } = this.computeHealthScore(lc, st);
    lc.healthScore   = score;
    lc.momentumScore = momentumScore;
    lc.healthColor   = score >= 60 ? "green" : score >= 35 ? "yellow" : "red";

    // ── Exit checks (skip if already closing) ─────────────────────────────────
    if (!this.closing.has(sym)) {
      this.checkTimeExit(lc, sym, price);
    }
    if (!this.closing.has(sym) && st.priceHistory.length >= MIN_HISTORY_MOMENTUM) {
      this.checkMomentumExit(lc, sym, price, st);
    }
  }

  // ── Trailing Stop ──────────────────────────────────────────────────────────

  private updateTrailingStop(lc: PositionLifecycle, sym: string, price: number): void {
    const { entryPrice, initialSlPrice, initialRisk } = lc;
    if (initialSlPrice == null || initialRisk <= 0) return;

    // Only trail when price is above entry (in profit)
    if (price <= entryPrice) return;

    // ── 1. Breakeven: move SL to entry after reaching +1R ──────────────────
    if (!lc.breakevenActive && price >= entryPrice + initialRisk) {
      // New SL = entry (breakeven)
      const newSl = entryPrice;
      const updated = riskManager.updatePositionStop(sym, newSl);
      if (updated) {
        lc.slPrice        = newSl;
        lc.breakevenActive = true;
        this.addTimeline(lc, "BREAKEVEN_ACTIVATED",
          `SL → breakeven $${newSl.toFixed(6)} (1R = $${initialRisk.toFixed(6)} reached)`);
        logger.info({ sym, price, entry: entryPrice, newSl }, "positionLifecycle: BREAKEVEN activated");
        telegramNotifier.notify("BREAKEVEN_ACTIVATED", {
          symbol:     sym,
          entryPrice,
          currentPrice: price,
          newSl,
          profitUsd:  lc.unrealizedPnlUsd,
          profitPct:  lc.unrealizedPnlPct,
          durationMs: lc.durationMs,
          isPaper:    lc.isPaper,
        });
        this.emitUpdate(sym, "breakeven", { newSl, automatic: true });
        void this.persist(lc);
      }
    }

    // ── 2. ATR trailing stop ────────────────────────────────────────────────
    // trailingEnabled is the single source of truth for whether trailing should
    // run at all — set by the manual activateTrailing()/deactivateTrailing()
    // actions. Defaults to true (preserves the original always-on behaviour)
    // until a user explicitly disables it for this position.
    const atr = lc.trailingEnabled ? lc.atrEstimate : null;
    if (atr != null && atr > 0) {
      const trailSl     = price - atr * TRAIL_ATR_MULTIPLIER;
      const currentSl   = lc.slPrice ?? initialSlPrice;
      // Never move stop backwards; only improve (raise) it
      if (trailSl > currentSl && trailSl > initialSlPrice) {
        const updated = riskManager.updatePositionStop(sym, trailSl);
        if (updated) {
          const wasTrailing = lc.trailingActive;
          lc.slPrice        = trailSl;
          lc.trailingActive = true;
          if (!wasTrailing) {
            this.addTimeline(lc, "TRAILING_ACTIVATED",
              `ATR trailing active — SL → $${trailSl.toFixed(6)} (ATR=${atr.toFixed(4)})`);
            telegramNotifier.notify("TRAILING_ACTIVATED", {
              symbol:      sym,
              entryPrice,
              currentPrice: price,
              newSl:       trailSl,
              atr,
              profitUsd:   lc.unrealizedPnlUsd,
              profitPct:   lc.unrealizedPnlPct,
              durationMs:  lc.durationMs,
              isPaper:     lc.isPaper,
            });
          }
          logger.debug({ sym, price, trailSl, atr }, "positionLifecycle: trailing stop updated");
          this.emitUpdate(sym, "trailing_on", { newSl: trailSl, automatic: true });
          void this.persist(lc);
        }
      }
    }
  }

  // ── Profit Protection ──────────────────────────────────────────────────────

  /**
   * Compute the highest profit-lock tier reached at the given price, if any
   * new tier is both reached AND would raise (never lower) the current SL.
   * Shared by the automatic per-tick check and the manual lockProfit() action
   * so there is exactly one profit-lock algorithm, not two.
   */
  private computeProfitLockTier(
    lc: PositionLifecycle,
    price: number,
  ): { newLockedSl: number; tierPct: number } | null {
    const { entryPrice, initialSlPrice, initialTpPrice } = lc;
    if (initialSlPrice == null || initialTpPrice == null) return null;
    const tpRange = initialTpPrice - entryPrice;
    if (tpRange <= 0) return null;

    const profitFrac = (price - entryPrice) / tpRange;

    for (const tier of PROFIT_TIERS) {
      if (profitFrac < tier.atProfitFrac) continue;
      if (lc.lockedProfitPct >= tier.pct) continue; // already at this tier or better

      const newLockedSl = entryPrice + tier.lockFrac * tpRange;
      const currentSl   = lc.slPrice ?? initialSlPrice;
      if (newLockedSl <= currentSl) continue; // would move SL backwards — skip

      return { newLockedSl, tierPct: tier.pct };
    }
    return null;
  }

  private checkProfitProtection(lc: PositionLifecycle, sym: string, price: number, qty: number): void {
    const tier = this.computeProfitLockTier(lc, price);
    if (!tier) return;
    const { newLockedSl, tierPct } = tier;
    const entryPrice = lc.entryPrice;

    {
      const updated = riskManager.updatePositionStop(sym, newLockedSl);
      if (updated) {
        lc.slPrice        = newLockedSl;
        lc.lockedProfitPct = tierPct;
        lc.lockedSlPrice  = newLockedSl;
        const lockedUsd   = (newLockedSl - entryPrice) * qty;
        this.addTimeline(lc, "PROFIT_LOCKED",
          `${tierPct}% tier reached — SL → $${newLockedSl.toFixed(6)} (locks ~$${lockedUsd.toFixed(2)})`);
        logger.info({ sym, price, tierPct, newLockedSl }, "positionLifecycle: profit protection locked");
        telegramNotifier.notify("PROFIT_LOCKED", {
          symbol:     sym,
          entryPrice,
          currentPrice: price,
          tierPct,
          newSl:      newLockedSl,
          lockedUsd,
          profitUsd:  lc.unrealizedPnlUsd,
          profitPct:  lc.unrealizedPnlPct,
          durationMs: lc.durationMs,
          isPaper:    lc.isPaper,
        });
        this.emitUpdate(sym, "lock_profit", { newSl: newLockedSl, tierPct, automatic: true });
        void this.persist(lc);
      }
    }
  }

  // ── Time Exit ─────────────────────────────────────────────────────────────

  private checkTimeExit(lc: PositionLifecycle, sym: string, price: number): void {
    const limitMs = TIME_EXIT_MS[lc.strategyType.toLowerCase()] ?? DEFAULT_TIME_EXIT_MS;
    if (lc.durationMs < limitMs) return;

    // Don't time-exit if we've already protected ≥50% of profit (position is safe)
    if (lc.lockedProfitPct >= 50) return;

    const detail = `[Time Exit] held ${fmtDur(lc.durationMs)} > ${fmtDur(limitMs)} limit for ${lc.strategyType}`;
    logger.warn({ sym, durationMs: lc.durationMs, limitMs }, detail);
    this.addTimeline(lc, "TIME_EXIT", detail);

    telegramNotifier.notify("TIME_EXIT", {
      symbol:      sym,
      entryPrice:  lc.entryPrice,
      currentPrice: price,
      durationMs:  lc.durationMs,
      limitMs,
      strategyType: lc.strategyType,
      profitUsd:   lc.unrealizedPnlUsd,
      profitPct:   lc.unrealizedPnlPct,
      isPaper:     lc.isPaper,
    });

    this.triggerClose(sym, "time_exit", price);
  }

  // ── Momentum Exit ─────────────────────────────────────────────────────────

  private checkMomentumExit(lc: PositionLifecycle, sym: string, price: number, st: InternalState): void {
    // Don't exit if heavily profit-protected
    if (lc.lockedProfitPct >= 75) return;

    const signals: string[] = [];

    // 1. RSI reversal — RSI below 38 for long positions (momentum gone)
    if (st.priceHistory.length >= 15) {
      const rsi = calcRSI(st.priceHistory);
      if (rsi < 38) signals.push(`RSI=${rsi.toFixed(1)} (momentum exhausted)`);
    }

    // 2. Price retrace — gave back >70% of gains from high
    if (lc.highestPrice > lc.entryPrice) {
      const totalGain  = lc.highestPrice - lc.entryPrice;
      const retrace    = lc.highestPrice - price;
      const retraceFrac = totalGain > 0 ? retrace / totalGain : 0;
      if (retraceFrac > 0.70) {
        signals.push(`70% retrace from high ($${lc.highestPrice.toFixed(4)})`);
      }
    }

    // 3. Volume collapse — current 24h volume < 30% of entry volume
    if (lc.entryVolume != null && lc.volume != null && lc.entryVolume > 0) {
      const volRatio = lc.volume / lc.entryVolume;
      if (volRatio < 0.30) {
        signals.push(`Volume collapsed (${(volRatio * 100).toFixed(0)}% of entry)`);
      }
    }

    // 4. ATR contraction — current ATR < 35% of early ATR
    if (st.atrHistory.length >= 6 && lc.atrEstimate != null) {
      const earlyAtr = st.atrHistory.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      if (earlyAtr > 0 && lc.atrEstimate < earlyAtr * 0.35) {
        signals.push(`ATR contracted (${(lc.atrEstimate / earlyAtr * 100).toFixed(0)}% of entry ATR)`);
      }
    }

    // 5. Short-term MA crosses below long-term MA (EMA crossover proxy)
    if (st.priceHistory.length >= 20) {
      const shortMA = st.priceHistory.slice(-8).reduce((a, b) => a + b, 0) / 8;
      const longMA  = st.priceHistory.slice(-20).reduce((a, b) => a + b, 0) / 20;
      if (shortMA < longMA * 0.9995) {
        signals.push(`EMA cross: short MA below long MA`);
      }
    }

    // Require ≥3 simultaneous signals to avoid false positives
    if (signals.length < 3) return;

    const reasonStr = signals.join("; ");
    const detail    = `[Momentum Exit] ${reasonStr}`;
    logger.warn({ sym, signals: signals.length, reasons: signals }, detail);
    this.addTimeline(lc, "MOMENTUM_EXIT", detail);

    telegramNotifier.notify("MOMENTUM_EXIT", {
      symbol:       sym,
      entryPrice:   lc.entryPrice,
      currentPrice: price,
      reasons:      reasonStr,
      signals:      signals.length,
      profitUsd:    lc.unrealizedPnlUsd,
      profitPct:    lc.unrealizedPnlPct,
      durationMs:   lc.durationMs,
      isPaper:      lc.isPaper,
    });

    this.triggerClose(sym, "momentum_exit", price);
  }

  // ── Health Score ──────────────────────────────────────────────────────────

  private computeHealthScore(lc: PositionLifecycle, st: InternalState): { score: number; momentumScore: number } {
    // Profit component (35 pts): clamp rrMultiple to [−2, 3]
    const rrClamped   = Math.max(-2, Math.min(3, lc.rrMultiple));
    const profitScore = Math.max(0, Math.min(35, 17.5 + rrClamped * 8.75));

    // Trend component (25 pts): price vs entry
    const trendGap  = lc.entryPrice > 0 ? (lc.currentPrice - lc.entryPrice) / lc.entryPrice : 0;
    const trendScore = Math.max(0, Math.min(25, 12.5 + trendGap * 500));

    // Time component (20 pts): degrades as position ages
    const limitMs   = TIME_EXIT_MS[lc.strategyType.toLowerCase()] ?? DEFAULT_TIME_EXIT_MS;
    const timeFrac  = Math.min(1, lc.durationMs / limitMs);
    const timeScore = 20 * (1 - timeFrac * 0.75);

    // Momentum component (20 pts): RSI-based
    let momentumScore = 50;
    if (st.priceHistory.length >= 14) {
      const rsi = calcRSI(st.priceHistory);
      momentumScore = rsi >= 50 && rsi <= 72 ? 100
        : rsi >= 40  && rsi < 50  ? 60
        : rsi >= 30  && rsi < 40  ? 25
        : rsi > 72               ? 70    // overbought but still bullish
        : 10;                              // <30: severely oversold
    }
    const momentumContrib = momentumScore * 0.20;

    const score = Math.round(Math.max(0, Math.min(100,
      profitScore + trendScore + timeScore + momentumContrib,
    )));
    return { score, momentumScore: Math.round(momentumScore) };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private addTimeline(lc: PositionLifecycle, event: string, detail: string): void {
    lc.timeline.push({ time: new Date().toISOString(), event, detail });
    if (lc.timeline.length > 50) lc.timeline.shift();
  }

  private triggerClose(sym: string, reason: string, price: number): void {
    if (this.closing.has(sym)) return;
    if (!this.onClose) {
      logger.warn({ sym, reason }, "positionLifecycle: onClose not registered — cannot trigger close");
      return;
    }
    this.closing.add(sym);
    this.onClose(sym, reason, price).catch(e => {
      logger.error({ err: e, sym, reason }, "positionLifecycle: close callback failed");
    }).finally(() => {
      // Release lock after 30 s in case the position wasn't cleared by deregister
      setTimeout(() => { this.closing.delete(sym); }, 30_000);
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const positionLifecycleManager = new PositionLifecycleManager();
