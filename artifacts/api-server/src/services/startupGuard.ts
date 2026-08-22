/**
 * startupGuard.ts — Pre-flight safety gate for live trading.
 *
 * Verifies five prerequisites before live mode is permitted:
 *   1. Database connected       — trades must be persisted; keys must load
 *   2. Redis connected          — BullMQ queue requires Redis
 *   3. Encryption ready         — stored API keys must be decryptable
 *   4. Exchange auth accessible — DB + encryption both available (actual credential
 *                                  validation happens in bot.start() via testAuth)
 *   5. Queue available          — BullMQ trade queue not paused
 *
 * If any check fails:
 *   - Sets  process.env["LIVE_TRADING_BLOCKED"] = "1"
 *   - Sets  process.env["LIVE_TRADING_BLOCKED_REASONS"] = "<reasons>"
 *   - Logs  "⚠ Live trading blocked"  banner
 *
 * On success:
 *   - Clears the env flags
 *   - Logs  "✓ Trading safe"  banner
 *
 * Communicate via process.env flags so bot.start() can read the result without
 * creating a circular module dependency (startupGuard → bot → startupGuard).
 */

import { getStatus as getDbStatus }    from "./databaseHealthService";
import { getStatus as getRedisStatus } from "./redisHealthService";
import { isQueuePaused }               from "../queues/tradeQueue";
import { logger }                      from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckItem {
  name:   string;
  ok:     boolean;
  detail: string;
}

export interface GuardResult {
  liveTradingAllowed: boolean;
  checks:             CheckItem[];
  blockedReasons:     string[];
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _result: GuardResult | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the last guard run confirmed all prerequisites are met.
 * Defaults to true if the guard has not yet run (provisional — bot.start()
 * will trigger a fresh run for live-mode requests when needed).
 */
export function isLiveTradingAllowed(): boolean {
  return _result === null ? true : _result.liveTradingAllowed;
}

/** Return the full result of the last guard run, or null if not run yet. */
export function getGuardResult(): GuardResult | null {
  return _result;
}

/**
 * Run all prerequisite checks, update the cached result, set env flags, and
 * print the trading-safe / live-trading-blocked banner.
 *
 * Always resolves — never throws.
 */
export async function runStartupGuard(): Promise<GuardResult> {
  const checks: CheckItem[]    = [];
  const blockedReasons: string[] = [];

  // ── 1. Database ──────────────────────────────────────────────────────────────
  const db    = getDbStatus();
  const dbOk  = db.connected;
  checks.push({
    name:   "database",
    ok:     dbOk,
    detail: dbOk
      ? `connected (${db.latencyMs ?? "?"}ms)`
      : (db.error ?? "unreachable — set DATABASE_URL"),
  });
  if (!dbOk) blockedReasons.push("database unavailable");

  // ── 2. Redis ─────────────────────────────────────────────────────────────────
  const redis   = getRedisStatus();
  const redisOk = redis.connected;
  checks.push({
    name:   "redis",
    ok:     redisOk,
    detail: redisOk
      ? `connected (${redis.latencyMs ?? "?"}ms)`
      : (redis.error ?? "unreachable — set REDIS_URL"),
  });
  if (!redisOk) blockedReasons.push("redis unavailable");

  // ── 3. Encryption ─────────────────────────────────────────────────────────────
  const encDisabled = process.env["LIVE_TRADING_DISABLED"] === "1";
  const encKeySet   = Boolean(process.env["ENCRYPTION_KEY"]);
  const encOk       = encKeySet && !encDisabled;
  checks.push({
    name:   "encryption",
    ok:     encOk,
    detail: encOk
      ? "AES-256-CBC key loaded"
      : "ENCRYPTION_KEY missing or invalid — generate: openssl rand -base64 32",
  });
  if (!encOk) blockedReasons.push("encryption key not configured");

  // ── 4. Exchange auth accessibility ────────────────────────────────────────────
  // Exchange API keys are stored AES-encrypted in the database.  They can only
  // be loaded when both DB and encryption are healthy.  The actual credential
  // test (testAuth) happens inside bot.start() after keys are decrypted.
  const exchOk = dbOk && encOk;
  const exchAlreadyBlocked =
    blockedReasons.includes("database unavailable") ||
    blockedReasons.includes("encryption key not configured");
  checks.push({
    name:   "exchange auth",
    ok:     exchOk,
    detail: exchOk
      ? "encrypted API keys accessible from DB"
      : "exchange credentials inaccessible (DB or encryption unavailable)",
  });
  if (!exchOk && !exchAlreadyBlocked) {
    blockedReasons.push("exchange credentials inaccessible");
  }

  // ── 5. Queue ─────────────────────────────────────────────────────────────────
  const queuePaused = isQueuePaused();
  const queueOk     = redisOk && !queuePaused;
  checks.push({
    name:   "queue",
    ok:     queueOk,
    detail: queueOk
      ? "BullMQ trade queue ready"
      : queuePaused
        ? "trade queue paused (Redis unavailable)"
        : "trade queue unavailable (Redis not connected)",
  });
  if (!queueOk && !blockedReasons.includes("redis unavailable")) {
    blockedReasons.push("trade queue unavailable");
  }

  // ── Result ────────────────────────────────────────────────────────────────────
  const liveTradingAllowed = blockedReasons.length === 0;
  _result = { liveTradingAllowed, checks, blockedReasons };

  // Communicate result via environment flags so bot.start() can read it without
  // importing this module (which would create a circular dependency).
  if (!liveTradingAllowed) {
    process.env["LIVE_TRADING_BLOCKED"]         = "1";
    process.env["LIVE_TRADING_BLOCKED_REASONS"] = blockedReasons.join("; ");
  } else {
    delete process.env["LIVE_TRADING_BLOCKED"];
    delete process.env["LIVE_TRADING_BLOCKED_REASONS"];
  }

  // ── Banner ────────────────────────────────────────────────────────────────────
  const SEP = "─────────────────────────────────────────────────";
  logger.info(SEP);
  if (liveTradingAllowed) {
    logger.info("  ✓ Trading safe");
  } else {
    logger.warn({ blockedReasons }, "  ⚠ Live trading blocked");
  }
  for (const c of checks) {
    const icon = c.ok ? "✓" : "⚠";
    if (c.ok) {
      logger.info(`  ${icon} ${c.name.padEnd(18)}: ${c.detail}`);
    } else {
      logger.warn(`  ${icon} ${c.name.padEnd(18)}: ${c.detail}`);
    }
  }
  logger.info(SEP);

  return _result;
}
