/**
 * tradeMonitorService.ts — Final safety layer for SL/TP enforcement.
 *
 * WHY THIS EXISTS (and how it differs from positionMonitor):
 *   • positionMonitor.ts fires a callback → bot.ts → enqueueTradeExit()
 *     It depends on the bot being running and its callback being registered.
 *   • tradeMonitorService runs completely independently. It enqueues exit
 *     jobs DIRECTLY into BullMQ, bypassing the bot entirely.
 *   • Even if the bot is stopped, crashed, or the main loop is stalled,
 *     this service continues to protect every open position.
 *   • It is the final line of defense: if the exchange-side SL/TP fails
 *     AND positionMonitor misses a tick, this service WILL close the position.
 *
 * Architecture:
 *   1. Runs on its own setInterval (default every 3 s, configurable 2–5 s)
 *   2. Reads ALL open positions from the global riskManager
 *   3. Fetches current price for each symbol independently
 *   4. If price <= SL or price >= TP → enqueue TRADE_EXIT job (priority 1)
 *   5. Tracks in-flight exits with a Set to prevent duplicate jobs
 *   6. Logs every forced close with full context
 *   7. Never throws — all errors are caught and logged
 *
 * Integration:
 *   • app.ts calls tradeMonitorService.start() on boot
 *   • bot.ts calls registerMonitorContext() when an entry fills, so the
 *     service knows which creds/userId to use for exit jobs
 *   • app.ts calls tradeMonitorService.stop() on shutdown
 */

import { logger }             from "../lib/logger";
import { riskManager }        from "../lib/riskManager";
import type { OpenPosition }  from "../lib/riskManager";
import * as store             from "../lib/store";
import { enqueueTradeExit }   from "../queues/tradeQueue";
import type { ExchangeCreds } from "../services/tradeService";
import * as exchangeService from "./exchangeService";

// ─── Monitor context ──────────────────────────────────────────────────────────

/**
 * Context registered by bot.ts when a position opens.
 * Contains everything needed to enqueue an exit job independently.
 */
export interface MonitorContext {
  userId:  number;
  creds:   ExchangeCreds;
  isPaper: boolean;
}

// Registry: symbol → context for that position
// Updated on every entry fill; cleared on every exit fill.
const _contexts = new Map<string, MonitorContext>();

/**
 * Register creds/userId for a symbol so the monitor can close it.
 * Call this immediately after a TRADE_ENTRY fills.
 */
export function registerMonitorContext(symbol: string, ctx: MonitorContext): void {
  _contexts.set(symbol.toUpperCase(), ctx);
  logger.debug({ symbol, userId: ctx.userId }, "tradeMonitor: context registered");
}

/**
 * Clear the monitor context for a symbol after it's been closed.
 * Call this after a TRADE_EXIT fills.
 */
export function clearMonitorContext(symbol: string): void {
  _contexts.delete(symbol.toUpperCase());
  logger.debug({ symbol }, "tradeMonitor: context cleared");
}

// ─── Price fetching ───────────────────────────────────────────────────────────

/**
 * Fetch current mid price for a symbol.
 * Uses Gate.io market data (WebSocket cache with REST fallback).
 * Returns null on any error so the monitor can safely skip.
 */
async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const ticker = await exchangeService.getTicker(symbol);
    if (ticker == null || ticker.last <= 0) return null;
    return ticker.last;
  } catch (e) {
    logger.warn({ err: e, symbol }, "tradeMonitor: price fetch failed — skipping symbol this tick");
    return null;
  }
}

// ─── TradeMonitorService ──────────────────────────────────────────────────────

class TradeMonitorService {
  private intervalMs:  number;
  private timer:       ReturnType<typeof setInterval> | null = null;
  private inProgress:  Set<string> = new Set();   // symbols currently being closed
  private tickCount:   number = 0;
  private forcedCount: number = 0;                // total forced closes since start

  constructor(intervalMs = 3_000) {
    this.intervalMs = intervalMs;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.timer !== null) {
      logger.warn("tradeMonitor: already running — ignoring start()");
      return;
    }
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    logger.info(
      { intervalMs: this.intervalMs },
      "tradeMonitor: FINAL SAFETY LAYER started — monitoring all open positions",
    );
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info(
      { tickCount: this.tickCount, forcedCloses: this.forcedCount },
      "tradeMonitor: stopped",
    );
  }

  isRunning(): boolean { return this.timer !== null; }

  getStats(): { running: boolean; tickCount: number; forcedCloses: number; intervalMs: number } {
    return {
      running:      this.timer !== null,
      tickCount:    this.tickCount,
      forcedCloses: this.forcedCount,
      intervalMs:   this.intervalMs,
    };
  }

  // ── Internal loop ──────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    this.tickCount++;

    // Read all positions tracked by the global riskManager
    const openPositions = Array.from(riskManager.getAllOpenPositions());
    if (openPositions.length === 0) return;

    // Check each position independently and in parallel
    await Promise.allSettled(
      openPositions.map((pos) => this.checkPosition(pos)),
    );
  }

  private async checkPosition(pos: OpenPosition): Promise<void> {
    const symbol = pos.symbol.toUpperCase();

    // Skip if already being processed (exit job already enqueued)
    if (this.inProgress.has(symbol)) return;

    // Skip if no SL or TP set (can't enforce without thresholds)
    if (pos.slPrice == null && pos.tpPrice == null) {
      logger.warn({ symbol }, "tradeMonitor: position has no SL or TP — cannot enforce (register thresholds on entry)");
      return;
    }

    // Fetch current price
    const price = await fetchCurrentPrice(symbol);
    if (price == null || price <= 0) return;  // skip on price fetch failure

    // ── SL/TP evaluation ─────────────────────────────────────────────────────
    let trigger: "stop_loss" | "take_profit" | null = null;
    let triggerPrice: number | null = null;

    if (pos.slPrice != null && price <= pos.slPrice) {
      trigger      = "stop_loss";
      triggerPrice = pos.slPrice;
    } else if (pos.tpPrice != null && price >= pos.tpPrice) {
      trigger      = "take_profit";
      triggerPrice = pos.tpPrice;
    }

    if (!trigger || triggerPrice == null) return;  // no action needed

    // ── Force close ───────────────────────────────────────────────────────────
    this.inProgress.add(symbol);
    try {
      await this.forceClose(pos, symbol, price, trigger, triggerPrice);
    } finally {
      // Keep in inProgress until exit callback clears the context
      // (context clearing is the signal that the exit job was processed)
      // Release after 30 s in case the worker never processes (failsafe)
      setTimeout(() => {
        this.inProgress.delete(symbol);
      }, 30_000);
    }
  }

  private async forceClose(
    pos:          OpenPosition,
    symbol:       string,
    currentPrice: number,
    reason:       "stop_loss" | "take_profit",
    triggerPrice: number,
  ): Promise<void> {
    const logLevel = reason === "stop_loss" ? "warn" : "info";

    logger[logLevel](
      {
        symbol,
        reason,
        currentPrice,
        triggerPrice,
        entryPrice: pos.entryPrice,
        qty:        pos.qty,
        slPrice:    pos.slPrice,
        tpPrice:    pos.tpPrice,
        pnlEstimate: (currentPrice - pos.entryPrice) * pos.qty,
      },
      `tradeMonitor: ⚡ FORCED CLOSE — ${reason.toUpperCase()} triggered at ${currentPrice} (threshold=${triggerPrice})`,
    );

    // Persist a risk event to the DB so there's always an audit trail
    void store.logRiskEvent({
      eventType:  reason === "stop_loss" ? "SL_TRIGGERED" : "TP_TRIGGERED",
      symbol,
      reason:     `tradeMonitor forced close: ${reason} at price=${currentPrice} threshold=${triggerPrice}`,
      meta: {
        source:       "tradeMonitorService",
        currentPrice,
        triggerPrice,
        entryPrice:   pos.entryPrice,
        qty:          pos.qty,
        slPrice:      pos.slPrice,
        tpPrice:      pos.tpPrice,
        estimatedPnl: (currentPrice - pos.entryPrice) * pos.qty,
        tickCount:    this.tickCount,
      },
    }).catch((e: unknown) => {
      logger.error({ err: e, symbol }, "tradeMonitor: failed to write risk event (non-fatal)");
    });

    // Resolve monitor context (creds + userId) for this symbol
    const ctx = _contexts.get(symbol);
    if (!ctx) {
      // No context registered — can't enqueue without creds.
      // This can happen if the position was opened before the monitor started.
      logger.error(
        { symbol, reason },
        "tradeMonitor: no monitor context for symbol — cannot enqueue exit job. " +
        "Position must be closed manually or via positionMonitor callback.",
      );
      return;
    }

    // Build a unique correlationId tied to this forced-close event
    const correlationId = `monitor:${symbol}:${reason}:${Date.now()}`;

    try {
      await enqueueTradeExit({
        userId:       ctx.userId,
        source:       "BOT",
        symbol,
        qty:          pos.qty,
        currentPrice,
        reason,
        entryPrice:   pos.entryPrice,
        entryOrderId: "",  // orderId not stored on OpenPosition — worker doesn't need it for exits
        openedAt:     pos.openedAt,
        isPaper:      ctx.isPaper,
        creds:        ctx.creds,
        correlationId,
      });

      this.forcedCount++;

      logger.info(
        {
          symbol,
          reason,
          currentPrice,
          correlationId,
          userId: ctx.userId,
          isPaper: ctx.isPaper,
        },
        `tradeMonitor: EXIT JOB enqueued (forced close #${this.forcedCount})`,
      );
    } catch (e) {
      // Critical: failed to enqueue the exit job.
      // Log at error level with full details so it can be investigated.
      logger.error(
        {
          err:    e,
          symbol,
          reason,
          currentPrice,
          correlationId,
          userId: ctx.userId,
        },
        "tradeMonitor: CRITICAL — failed to enqueue forced exit job. " +
        "Position may not be closed. Manual intervention required.",
      );
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const tradeMonitor = new TradeMonitorService(3_000);

export function startTradeMonitor(): void  { tradeMonitor.start(); }
export function stopTradeMonitor():  void  { tradeMonitor.stop();  }
