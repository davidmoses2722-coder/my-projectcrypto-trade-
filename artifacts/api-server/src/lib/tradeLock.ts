/**
 * tradeLock.ts — Redis-based distributed trade lock.
 *
 * Prevents duplicate trade submissions for the same user+symbol pair.
 *
 * Unlike the in-memory pendingOrders Set in tradeService, this lock:
 *   • Survives process restarts (TTL-based expiry prevents phantom locks)
 *   • Works across multiple instances (distributed-safe via Redis SET NX)
 *   • Scoped per user so User A's lock never blocks User B
 *
 * Lock format:  trade_lock:{userId}:{SYMBOL}
 * TTL:          60 seconds (order must complete or we auto-release)
 */

import { getRedisClient, isRedisReady } from "./redis";
import { logger } from "./logger";

const LOCK_TTL_MS = 60_000;   // 60 s
const LOCK_PREFIX = "trade_lock";

function lockKey(userId: number | null, symbol: string): string {
  return `${LOCK_PREFIX}:${userId ?? 0}:${symbol.toUpperCase()}`;
}

/**
 * Attempt to acquire the trade lock for this user+symbol.
 *
 * Returns true  → lock acquired (caller may proceed)
 * Returns false → lock already held (duplicate trade blocked)
 *
 * Falls back to true (non-blocking) if Redis is unavailable —
 * the in-process pendingOrders Set in tradeService handles that case.
 */
export async function acquireTradeLock(
  userId: number | null,
  symbol: string,
): Promise<boolean> {
  if (!isRedisReady()) {
    logger.warn({ symbol, userId }, "tradeLock: Redis not ready — skipping distributed lock (in-process lock still active)");
    return true;  // degrade gracefully; tradeService's Set still guards
  }

  const client = getRedisClient();
  const key = lockKey(userId, symbol);
  const value = `locked:${Date.now()}`;

  // SET NX EX — atomic: set only if key doesn't exist, expire after TTL seconds
  const result = await client.set(key, value, "PX", LOCK_TTL_MS, "NX");

  if (result === null) {
    logger.warn({ key, userId, symbol }, "tradeLock: lock already held — duplicate trade blocked");
    return false;
  }

  logger.info({ key, userId, symbol }, "tradeLock: acquired");
  return true;
}

/**
 * Release the trade lock for this user+symbol.
 * Call this after the trade is fully settled (filled, failed, or cancelled).
 */
export async function releaseTradeLock(
  userId: number | null,
  symbol: string,
): Promise<void> {
  if (!isRedisReady()) return;

  const client = getRedisClient();
  const key = lockKey(userId, symbol);

  await client.del(key);
  logger.info({ key, userId, symbol }, "tradeLock: released");
}

/**
 * Check if a lock is currently held (for monitoring/status).
 */
export async function isTradeLocked(
  userId: number | null,
  symbol: string,
): Promise<boolean> {
  if (!isRedisReady()) return false;
  const client = getRedisClient();
  const exists = await client.exists(lockKey(userId, symbol));
  return exists === 1;
}
