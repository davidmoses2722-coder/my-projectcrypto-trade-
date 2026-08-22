/**
 * tradeQueue.ts — BullMQ queue for all trade execution.
 *
 * Why a queue?
 *   • Trade logic is completely decoupled from HTTP request handlers.
 *   • Jobs persist in Redis — a server restart won't lose a pending order.
 *   • BullMQ's per-job concurrency controls prevent duplicate submissions.
 *   • Failed jobs are automatically retried with backoff.
 *   • Job history provides an audit trail of all trade attempts.
 *
 * Queue names:
 *   TRADE_QUEUE — all entry and exit orders
 *
 * Job types (discriminated by data.type):
 *   "TRADE_ENTRY" — open a new position
 *   "TRADE_EXIT"  — close an existing position
 *
 * Redis resilience:
 *   • Queue is paused when Redis disconnects and resumed on reconnect.
 *   • Queue errors are logged but never crash the process.
 */

import { Queue, type DefaultJobOptions } from "bullmq";
import { createRedisConnection } from "../lib/redis";
import { onConnected, onDisconnected } from "../services/redisHealthService";
import { logger } from "../lib/logger";
import type { ExchangeCreds } from "../services/tradeService";

// ─── Constants ────────────────────────────────────────────────────────────────

export const TRADE_QUEUE_NAME = "trade-execution";

// ─── Job payload types ────────────────────────────────────────────────────────

export type TradeSource = "BOT" | "MANUAL";

export interface TradeEntryJobData {
  type: "TRADE_ENTRY";
  source: TradeSource;
  userId: number;
  symbol: string;
  sizeUsdt: number;
  /** Free quote balance at signal time. Used for authoritative risk validation. */
  balanceFreeUsdt?: number;
  currentPrice: number;
  stopLossPct: number;
  takeProfitPct: number;
  isPaper: boolean;
  creds: ExchangeCreds;
  correlationId: string;
}

export interface TradeExitJobData {
  type: "TRADE_EXIT";
  source: TradeSource;
  userId: number;
  symbol: string;
  qty: number;
  /** When set (< qty), execute a partial close of this many units only. */
  closeQty?: number;
  currentPrice: number;
  reason: string;
  entryPrice: number;
  entryOrderId: string;
  openedAt: number;
  isPaper: boolean;
  creds: ExchangeCreds;
  correlationId: string;
}

export type TradeJobData = TradeEntryJobData | TradeExitJobData;

// ─── Job result types ─────────────────────────────────────────────────────────

export interface TradeEntryResult {
  type: "ENTRY_RESULT";
  source: TradeSource;
  success: boolean;
  correlationId: string;
  userId: number;
  symbol: string;
  orderId: string;
  fillPrice: number;
  fillQty: number;
  safeAmountUsdt: number;
  slPrice: number;
  tpPrice: number;
  riskAmountUsd: number;
  isPaper: boolean;
  executedAt: number;
  error?: string;
  blocked?: boolean;
}

export interface TradeExitResult {
  type: "EXIT_RESULT";
  source: TradeSource;
  success: boolean;
  correlationId: string;
  userId: number;
  symbol: string;
  orderId: string;
  fillPrice: number;
  fillQty: number;
  pnlUsd: number;
  pnlPct: number;
  reason: string;
  isPaper: boolean;
  executedAt: number;
  /** True when this was a partial close (closeQty < position qty). */
  isPartial?: boolean;
  error?: string;
}

export type TradeJobResult = TradeEntryResult | TradeExitResult;

// ─── Default job options ──────────────────────────────────────────────────────

/**
 * BullMQ rejects custom jobIds containing ":" (throws "Custom Id cannot
 * contain :"). Callers build correlationIds with colons (e.g.
 * tradeMonitorService's `monitor:${symbol}:${reason}:${Date.now()}`), so
 * sanitize here — the single place all trade jobIds are constructed —
 * rather than requiring every producer to know about this constraint.
 */
function sanitizeForJobId(id: string): string {
  return id.replace(/:/g, "-");
}

const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  removeOnComplete: {
    count: 500,     // keep last 500 completed jobs for audit
    age: 86_400,    // and for up to 24 hours
  },
  removeOnFail: {
    count: 200,     // keep last 200 failed jobs
    age: 7 * 86_400, // for up to 7 days
  },
  attempts: 1,     // CRITICAL: NO automatic retries for trade orders.
                   // A retry would create a duplicate trade.
                   // If an order fails, the worker catches the error and
                   // records it, but does NOT retry automatically.
};

// ─── Queue singleton ──────────────────────────────────────────────────────────

let _queue: Queue<TradeJobData, TradeJobResult> | null = null;
let _queuePaused = false;

export function getTradeQueue(): Queue<TradeJobData, TradeJobResult> {
  if (!_queue) {
    _queue = new Queue<TradeJobData, TradeJobResult>(TRADE_QUEUE_NAME, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: createRedisConnection() as any,  // ioredis version shimmed for bullmq compat
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });

    _queue!.on("error", (err) => {
      logger.error({ err: err.message }, "tradeQueue: queue error (Redis may be unavailable)");
    });

    // ── Pause queue on Redis disconnect, resume on reconnect ──────────────
    onDisconnected((_errMsg) => {
      if (_queue && !_queuePaused) {
        _queue.pause().then(() => {
          _queuePaused = true;
          logger.warn("tradeQueue: paused — Redis unavailable");
        }).catch(() => { /* ignore if already closed */ });
      }
    });

    onConnected(() => {
      if (_queue && _queuePaused) {
        _queue.resume().then(() => {
          _queuePaused = false;
          logger.info("tradeQueue: resumed — Redis reconnected");
        }).catch(() => { /* ignore */ });
      }
    });
  }
  return _queue!;
}

/**
 * Enqueue a trade entry job.
 * Returns the BullMQ Job object (for tracking, id, etc.)
 */
export async function enqueueTradeEntry(
  data: Omit<TradeEntryJobData, "type">,
) {
  const queue = getTradeQueue();
  const jobData: TradeEntryJobData = { type: "TRADE_ENTRY", ...data };

  return queue.add(
    `entry:${data.userId}:${data.symbol}:${data.correlationId}`,
    jobData,
    {
      ...DEFAULT_JOB_OPTIONS,
      // Deduplicate: if the same correlationId is already queued, skip it.
      jobId: `entry-${sanitizeForJobId(data.correlationId)}`,
    },
  );
}

/**
 * Enqueue a trade exit job.
 * Exits use highest priority — they must execute even when the queue is busy.
 */
export async function enqueueTradeExit(
  data: Omit<TradeExitJobData, "type">,
) {
  const queue = getTradeQueue();
  const jobData: TradeExitJobData = { type: "TRADE_EXIT", ...data };

  return queue.add(
    `exit:${data.userId}:${data.symbol}:${data.correlationId}`,
    jobData,
    {
      ...DEFAULT_JOB_OPTIONS,
      priority: 1,  // exits get priority over entries
      jobId: `exit-${sanitizeForJobId(data.correlationId)}`,
    },
  );
}

/**
 * Gracefully close the queue connection.
 */
export async function closeTradeQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
    _queuePaused = false;
  }
}

/** Whether the queue is currently paused due to Redis unavailability. */
export function isQueuePaused(): boolean {
  return _queuePaused;
}
