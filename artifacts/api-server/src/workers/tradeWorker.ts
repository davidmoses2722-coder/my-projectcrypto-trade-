/**
 * tradeWorker.ts — BullMQ worker for trade execution.
 *
 * This is the ONLY place where trade orders are sent to the exchange.
 * No trading logic runs inside API route handlers.
 *
 * Architecture:
 *   1. Acquire Redis trade lock   (prevents duplicate trades per user+symbol)
 *   2. Kill switch check          (global emergency stop)
 *   3. Risk validation            (per-user RiskManager)
 *   4. Order execution            (real exchange OR paper simulation)
 *   5. Record trade in DB         (always, even on failure)
 *   6. Release Redis trade lock
 *
 * Failsafe rules:
 *   • ANY unhandled error → trade is BLOCKED, not retried.
 *   • attempts: 1 in queue options — no automatic order retries.
 *   • Exit orders always execute; only entry orders go through risk gate.
 *   • Paper trading (isPaper=true) simulates fills without touching exchange.
 *
 * Redis resilience:
 *   • Worker pauses when Redis disconnects and resumes on reconnect.
 *   • Worker errors are logged but never crash the process.
 */

import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "../lib/redis";
import { onConnected, onDisconnected } from "../services/redisHealthService";
import { acquireTradeLock, releaseTradeLock } from "../lib/tradeLock";
import { getUserRiskManager } from "../lib/userRiskRegistry";
import { validateTrade, checkKillSwitch, RiskError } from "../services/riskService";
import * as trade from "../services/tradeService";
import * as store from "../lib/store";
import { logger } from "../lib/logger";
import {
  TRADE_QUEUE_NAME,
  type TradeJobData,
  type TradeEntryJobData,
  type TradeExitJobData,
  type TradeJobResult,
  type TradeEntryResult,
  type TradeExitResult,
} from "../queues/tradeQueue";

// ─── Callbacks ────────────────────────────────────────────────────────────────

// Bot registers these so the worker can update bot in-memory state
// after a trade is executed. Avoids circular import by using a registry pattern.

type EntryCallback        = (result: TradeEntryResult) => void;
type ExitCallback         = (result: TradeExitResult)  => void;
type PartialExitCallback  = (result: TradeExitResult)  => void;

let _onEntryFilled:       EntryCallback        | null = null;
let _onExitFilled:        ExitCallback         | null = null;
let _onPartialExitFilled: PartialExitCallback  | null = null;

export function onEntryFilled(cb: EntryCallback): void              { _onEntryFilled       = cb; }
export function onExitFilled(cb: ExitCallback):  void              { _onExitFilled        = cb; }
export function onPartialExitFilled(cb: PartialExitCallback): void { _onPartialExitFilled = cb; }

// ─── Paper trading simulation ─────────────────────────────────────────────────

/**
 * Simulate an entry order without calling the exchange.
 * Returns a fake order with current price as fill price.
 */
function simulateEntry(data: TradeEntryJobData, slPrice: number, tpPrice: number, safeQty: number): TradeEntryResult {
  const fakeOrderId = `PAPER-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  logger.info(
    { symbol: data.symbol, userId: data.userId, price: data.currentPrice, qty: safeQty },
    "tradeWorker: PAPER TRADE entry simulated (no exchange call)",
  );
  return {
    type: "ENTRY_RESULT",
    source: data.source ?? "BOT",
    success: true,
    correlationId: data.correlationId,
    userId: data.userId,
    symbol: data.symbol,
    orderId: fakeOrderId,
    fillPrice: data.currentPrice,
    fillQty: safeQty,
    safeAmountUsdt: data.sizeUsdt,
    slPrice,
    tpPrice,
    riskAmountUsd: 0,
    isPaper: true,
    executedAt: Date.now(),
  };
}

/**
 * Simulate an exit order without calling the exchange.
 */
function simulateExit(data: TradeExitJobData): TradeExitResult {
  const actualQty = data.closeQty ?? data.qty;   // partial close uses closeQty
  const isPartial = data.closeQty != null && data.closeQty < data.qty;
  const fakeOrderId = `PAPER-EXIT-${Date.now()}`;
  const pnlUsd = (data.currentPrice - data.entryPrice) * actualQty;
  const pnlPct = (data.currentPrice - data.entryPrice) / data.entryPrice;
  logger.info(
    { symbol: data.symbol, userId: data.userId, price: data.currentPrice, actualQty, isPartial, pnlUsd },
    "tradeWorker: PAPER TRADE exit simulated (no exchange call)",
  );
  return {
    type: "EXIT_RESULT",
    source: data.source ?? "BOT",
    success: true,
    correlationId: data.correlationId,
    userId: data.userId,
    symbol: data.symbol,
    orderId: fakeOrderId,
    fillPrice: data.currentPrice,
    fillQty: actualQty,
    pnlUsd,
    pnlPct: pnlPct * 100,
    reason: data.reason,
    isPaper: true,
    isPartial,
    executedAt: Date.now(),
  };
}

// ─── Entry processor ──────────────────────────────────────────────────────────

async function processEntry(job: Job<TradeEntryJobData>): Promise<TradeEntryResult> {
  const data = job.data;
  const { userId, symbol, correlationId } = data;
  const source = data.source ?? "BOT";

  // ── Step 1: Acquire trade lock (per user+symbol, Redis) ───────────────────
  const lockAcquired = await acquireTradeLock(userId, symbol);
  if (!lockAcquired) {
    logger.warn({ userId, symbol }, "tradeWorker: trade lock held — duplicate ENTRY blocked");
    return {
      type: "ENTRY_RESULT",
      source: data.source,
      success: false,
      correlationId,
      userId,
      symbol,
      orderId: "",
      fillPrice: 0,
      fillQty: 0,
      safeAmountUsdt: 0,
      slPrice: 0,
      tpPrice: 0,
      riskAmountUsd: 0,
      isPaper: data.isPaper,
      executedAt: Date.now(),
      blocked: true,
      error: `Trade lock held for ${symbol} (user ${userId}) — duplicate blocked`,
    };
  }

  try {
    // ── Step 2: Kill switch (global emergency stop) ────────────────────────
    try {
      await checkKillSwitch();
    } catch (e) {
      if (e instanceof RiskError) {
        logger.warn({ userId, symbol, rule: e.rule }, "tradeWorker: KILL SWITCH active — entry blocked");
        return {
          type: "ENTRY_RESULT",
          source: data.source,
          success: false,
          correlationId,
          userId,
          symbol,
          orderId: "",
          fillPrice: 0,
          fillQty: 0,
          safeAmountUsdt: 0,
          slPrice: 0,
          tpPrice: 0,
          riskAmountUsd: 0,
          isPaper: data.isPaper,
          executedAt: Date.now(),
          blocked: true,
          error: e.message,
        };
      }
      throw e;
    }

    // ── Step 3: Per-user risk validation ──────────────────────────────────
    let validated: Awaited<ReturnType<typeof validateTrade>>;
    const userRm = await getUserRiskManager(userId, source);
    try {
      // Use per-user risk manager so User A's state doesn't affect User B
      // Temporarily swap the module-level singleton if needed for validateTrade
      // validateTrade uses the global riskManager internally; we override via
      // the per-user instance's check() result to gate the trade.
      const riskResult = userRm.check({
        symbol,
        side: "buy",
        requestedAmountUsdt: data.sizeUsdt,
        currentPrice: data.currentPrice,
        balanceFreeUsdt: Math.max(0, data.balanceFreeUsdt ?? data.sizeUsdt * 10),
        slPrice: data.currentPrice * (1 - data.stopLossPct),
        tpPrice: data.currentPrice * (1 + data.takeProfitPct),
      });

      if (!riskResult.allowed) {
        logger.warn({ userId, symbol, reason: riskResult.reason }, "tradeWorker: per-user risk blocked entry");
        return {
          type: "ENTRY_RESULT",
          source: data.source,
          success: false,
          correlationId,
          userId,
          symbol,
          orderId: "",
          fillPrice: 0,
          fillQty: 0,
          safeAmountUsdt: 0,
          slPrice: 0,
          tpPrice: 0,
          riskAmountUsd: 0,
          isPaper: data.isPaper,
          executedAt: Date.now(),
          blocked: true,
          error: riskResult.reason,
        };
      }

      // Full validation (kill switch + all rules) via global riskService
      validated = await validateTrade({
        symbol,
        side: "buy",
        requestedAmountUsdt: data.sizeUsdt,
        currentPrice: data.currentPrice,
        balanceFreeUsdt: data.balanceFreeUsdt ?? data.sizeUsdt * 10,
        stopLossPct: data.stopLossPct,
        takeProfitPct: data.takeProfitPct,
        riskManager: userRm,
      });
    } catch (e) {
      if (e instanceof RiskError) {
        logger.warn({ userId, symbol, rule: e.rule, msg: e.message }, "tradeWorker: risk validation failed — entry blocked");
        return {
          type: "ENTRY_RESULT",
          source: data.source,
          success: false,
          correlationId,
          userId,
          symbol,
          orderId: "",
          fillPrice: 0,
          fillQty: 0,
          safeAmountUsdt: 0,
          slPrice: 0,
          tpPrice: 0,
          riskAmountUsd: 0,
          isPaper: data.isPaper,
          executedAt: Date.now(),
          blocked: true,
          error: e.message,
        };
      }
      // Unknown error — FAILSAFE: block the trade
      logger.error({ err: e, userId, symbol }, "tradeWorker: unknown error during risk validation — entry BLOCKED (failsafe)");
      return {
        type: "ENTRY_RESULT",
        source: data.source,
        success: false,
        correlationId,
        userId,
        symbol,
        orderId: "",
        fillPrice: 0,
        fillQty: 0,
        safeAmountUsdt: 0,
        slPrice: 0,
        tpPrice: 0,
        riskAmountUsd: 0,
        isPaper: data.isPaper,
        executedAt: Date.now(),
        blocked: true,
        error: `Failsafe: unknown error during risk check — ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // ── Step 4: Execute or simulate ───────────────────────────────────────
    let result: TradeEntryResult;

    if (data.isPaper) {
      // PAPER TRADING: simulate without calling exchange
      result = simulateEntry(data, validated.slPrice, validated.tpPrice, validated.safeQty);
      result.safeAmountUsdt = validated.safeAmountUsdt;
      result.riskAmountUsd  = validated.riskAmountUsd;
    } else {
      // LIVE TRADING: call exchange
      const orderResult = await trade.placeMarketOrder(data.creds, {
        symbol,
        side: "buy",
        amount: validated.safeQty,
        isExit: false,
        riskContext: {
          balanceFreeUsdt: data.sizeUsdt / (data.creds.paper ? 1 : 1),
          currentPrice: data.currentPrice,
          stopLossPct: data.stopLossPct,
          takeProfitPct: data.takeProfitPct,
        },
          riskManager: userRm,
      });

      if (!orderResult.success) {
        logger.error(
          { userId, symbol, error: orderResult.error, blocked: orderResult.blocked },
          "tradeWorker: exchange rejected entry order",
        );
        return {
          type: "ENTRY_RESULT",
          source,
          success: false,
          correlationId,
          userId,
          symbol,
          orderId: "",
          fillPrice: 0,
          fillQty: 0,
          safeAmountUsdt: validated.safeAmountUsdt,
          slPrice: validated.slPrice,
          tpPrice: validated.tpPrice,
          riskAmountUsd: validated.riskAmountUsd,
          isPaper: false,
          executedAt: Date.now(),
          blocked: orderResult.blocked,
          error: orderResult.error,
        };
      }

      const fillPrice = orderResult.price ?? data.currentPrice;
      const fillQty   = orderResult.amount ?? validated.safeQty;
      // Re-anchor SL/TP to actual fill price (handles slippage)
      const actualSl = fillPrice * (1 - data.stopLossPct);
      const actualTp = fillPrice * (1 + data.takeProfitPct);

      result = {
        type: "ENTRY_RESULT",
        source,
        success: true,
        correlationId,
        userId,
        symbol,
        orderId: orderResult.orderId ?? "",
        fillPrice,
        fillQty,
        safeAmountUsdt: validated.safeAmountUsdt,
        slPrice: actualSl,
        tpPrice: actualTp,
        riskAmountUsd: validated.riskAmountUsd,
        isPaper: false,
        executedAt: Date.now(),
      };
    }

    // ── Step 5: Record in per-user risk manager ────────────────────────────
    if (result.success) {
      userRm.recordEntry(
        symbol, "buy",
        result.fillPrice, result.fillQty,
        result.fillPrice * result.fillQty,
        result.slPrice, result.tpPrice,
      );

      // ── Persist to DB ─────────────────────────────────────────────────
      void store.persistTrade({
        symbol,
        side: "BUY",
        kind: "ENTRY",
        qty: result.fillQty,
        price: result.fillPrice,
        notionalUsd: result.fillPrice * result.fillQty,
        isPaper: result.isPaper,
        exchangeOrderId: result.orderId,
      });

      logger.info(
        { userId, symbol, fillPrice: result.fillPrice, fillQty: result.fillQty, isPaper: result.isPaper },
        "tradeWorker: ENTRY executed successfully",
      );

      // Notify bot to update in-memory state
      _onEntryFilled?.(result);
    }

    return result;

  } finally {
    // Always release the lock — even on error
    await releaseTradeLock(userId, symbol);
  }
}

// ─── Exit processor ───────────────────────────────────────────────────────────

async function processExit(job: Job<TradeExitJobData>): Promise<TradeExitResult> {
  const data = job.data;
  const { userId, symbol, correlationId } = data;
  const source = data.source ?? "BOT";

  // ── Distributed exit lock — mirrors the entry lock to prevent duplicate exits
  // when positionMonitor and tradeMonitorService both detect SL/TP simultaneously.
  const lockAcquired = await acquireTradeLock(userId, symbol);
  if (!lockAcquired) {
    logger.warn(
      { userId, symbol, correlationId, reason: data.reason },
      "tradeWorker: EXIT trade lock held — duplicate exit blocked (another exit job is already in flight)",
    );
    // Return a no-op result with zero PnL so the caller can log it but state
    // is NOT updated (the winning job handles state via _onExitFilled).
    return {
      type: "EXIT_RESULT",
      source,
      success: false,
      correlationId,
      userId,
      symbol,
      orderId: "",
      fillPrice: data.currentPrice,
      fillQty: data.qty,
      pnlUsd: 0,
      pnlPct: 0,
      reason: data.reason,
      isPaper: data.isPaper,
      executedAt: Date.now(),
      error: `Exit trade lock held for ${symbol} (user ${userId}) — duplicate blocked`,
    };
  }

  // ── Step 1: Failsafe — block if ANY error occurs ───────────────────────────
  try {
    // ── Step 2: Execute or simulate ─────────────────────────────────────────
    let result: TradeExitResult;

    const actualCloseQty = data.closeQty ?? data.qty;
    const isPartial      = data.closeQty != null && data.closeQty < data.qty;

    if (data.isPaper) {
      result = simulateExit(data);
    } else {
      // LIVE exit — always execute, bypasses risk gate
      const orderResult = await trade.placeMarketOrder(data.creds, {
        symbol,
        side: "sell",
        amount: actualCloseQty,   // partial-close uses closeQty, full-close uses qty
        isExit: true,  // skip risk validation — exits MUST always execute
      });

      if (!orderResult.success) {
        logger.error(
          { userId, symbol, error: orderResult.error },
          "tradeWorker: exchange rejected EXIT order — this is a critical failure!",
        );
        // For exit failures, we still update internal state to prevent phantom positions
        // The position is marked as "close attempted" to avoid zombie positions
        const pnlUsd = (data.currentPrice - data.entryPrice) * actualCloseQty;
        result = {
          type: "EXIT_RESULT",
          source,
          success: false,
          correlationId,
          userId,
          symbol,
          orderId: "",
          fillPrice: data.currentPrice,
          fillQty: actualCloseQty,
          pnlUsd,
          pnlPct: ((data.currentPrice - data.entryPrice) / data.entryPrice) * 100,
          reason: data.reason,
          isPaper: false,
          isPartial,
          executedAt: Date.now(),
          error: orderResult.error,
        };
      } else {
        const fillPrice = orderResult.price ?? data.currentPrice;
        const fillQty   = orderResult.amount ?? actualCloseQty;
        const pnlUsd    = (fillPrice - data.entryPrice) * fillQty;
        const pnlPct    = (fillPrice - data.entryPrice) / data.entryPrice;
        result = {
          type: "EXIT_RESULT",
          source,
          success: true,
          correlationId,
          userId,
          symbol,
          orderId: orderResult.orderId ?? "",
          fillPrice,
          fillQty,
          pnlUsd,
          pnlPct: pnlPct * 100,
          reason: data.reason,
          isPaper: false,
          isPartial,
          executedAt: Date.now(),
        };
      }
    }

    // ── Step 3: Record exit in per-user risk manager ───────────────────────
    const userRm = await getUserRiskManager(userId, source);
    userRm.recordExit(symbol, result.pnlUsd);

    // ── Step 4: Persist to DB ──────────────────────────────────────────────
    void store.persistTrade({
      symbol,
      side: "SELL",
      kind: "EXIT",
      qty: result.fillQty,
      price: result.fillPrice,
      notionalUsd: result.fillPrice * result.fillQty,
      pnlUsd: result.pnlUsd,
      pnlPct: result.pnlPct,
      reason: result.reason,
      isPaper: result.isPaper,
      exchangeOrderId: result.orderId,
    });
    void store.bumpPerformance(symbol, result.pnlUsd, result.pnlUsd >= 0);

    logger.info(
      {
        userId,
        symbol,
        fillPrice: result.fillPrice,
        pnlUsd: result.pnlUsd,
        reason: result.reason,
        isPaper: result.isPaper,
      },
      "tradeWorker: EXIT executed",
    );

    // Notify bot to update in-memory state
    // Partial exits go to the partial callback; full exits go to the full callback.
    if (result.isPartial) {
      _onPartialExitFilled?.(result);
    } else {
      _onExitFilled?.(result);
    }

    return result;

  } catch (e) {
    // FAILSAFE: any unhandled error during exit — log and still update state
    logger.error(
      { err: e, userId, symbol, reason: data.reason },
      "tradeWorker: CRITICAL — unhandled error during EXIT processing (failsafe activated)",
    );
    const actualCloseQtyFallback = data.closeQty ?? data.qty;
    const isPartialFallback      = data.closeQty != null && data.closeQty < data.qty;
    const errorResult: TradeExitResult = {
      type: "EXIT_RESULT",
      source,
      success: false,
      correlationId,
      userId,
      symbol,
      orderId: "",
      fillPrice: data.currentPrice,
      fillQty: actualCloseQtyFallback,
      pnlUsd: (data.currentPrice - data.entryPrice) * actualCloseQtyFallback,
      pnlPct: ((data.currentPrice - data.entryPrice) / data.entryPrice) * 100,
      reason: data.reason,
      isPaper: data.isPaper,
      isPartial: isPartialFallback,
      executedAt: Date.now(),
      error: e instanceof Error ? e.message : String(e),
    };
    // Route to correct callback (prevents zombie positions)
    if (isPartialFallback) {
      _onPartialExitFilled?.(errorResult);
    } else {
      _onExitFilled?.(errorResult);
    }
    return errorResult;
  } finally {
    await releaseTradeLock(userId, symbol);
  }
}

// ─── Worker singleton ─────────────────────────────────────────────────────────

let _worker: Worker<TradeJobData, TradeJobResult> | null = null;

export function startTradeWorker(): Worker<TradeJobData, TradeJobResult> {
  if (_worker) return _worker;

  _worker = new Worker<TradeJobData, TradeJobResult>(
    TRADE_QUEUE_NAME,
    async (job: Job<TradeJobData>): Promise<TradeJobResult> => {
      const { type } = job.data;
      logger.info({ jobId: job.id, type, userId: job.data.userId, symbol: job.data.symbol }, "tradeWorker: processing job");

      // ── FAILSAFE: catch ALL errors at the outermost level ─────────────────
      try {
        if (type === "TRADE_ENTRY") {
          return await processEntry(job as Job<TradeEntryJobData>);
        } else if (type === "TRADE_EXIT") {
          return await processExit(job as Job<TradeExitJobData>);
        } else {
          logger.error({ jobId: job.id, type }, "tradeWorker: unknown job type — discarded");
          throw new Error(`Unknown trade job type: ${type as string}`);
        }
      } catch (e) {
        // This catch is the absolute last line of defence.
        // Log it and mark the job as failed — do NOT retry.
        logger.error({ err: e, jobId: job.id }, "tradeWorker: UNHANDLED error (failsafe boundary) — job failed, no retry");
        throw e; // BullMQ marks job as failed
      }
    },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: createRedisConnection() as any,  // ioredis version shimmed for bullmq compat
      concurrency: 5,  // process up to 5 trade jobs concurrently (across users)
      autorun: true,
    },
  );

  _worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, type: result.type, success: result.success, userId: result.userId },
      "tradeWorker: job completed",
    );
  });

  _worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, err: err.message, jobData: job?.data },
      "tradeWorker: job FAILED",
    );
  });

  _worker.on("error", (err) => {
    logger.error({ err }, "tradeWorker: worker error (Redis may be unavailable)");
  });

  // ── Pause/resume worker on Redis disconnect/reconnect ───────────────────
  // Worker.pause() returns Promise<void> — use void+catch, never swallow errors.
  // Worker.resume() is synchronous (returns void) — call directly, no .then().
  onDisconnected((errMsg: string) => {
    logger.warn({ errMsg }, "tradeWorker: Redis disconnected — pausing worker");
    if (_worker) {
      void _worker.pause().catch((e: unknown) => {
        logger.warn({ err: e }, "tradeWorker: pause() threw — worker may already be closed");
      });
    }
  });

  onConnected(() => {
    logger.info("tradeWorker: Redis reconnected — resuming worker");
    if (_worker) {
      _worker.resume();
    }
  });

  logger.info("tradeWorker: started and listening for trade jobs");
  return _worker;
}

export async function stopTradeWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
    logger.info("tradeWorker: stopped");
  }
}
