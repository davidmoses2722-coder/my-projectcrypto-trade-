/**
 * userRiskRegistry.ts — per-user RiskManager isolation.
 *
 * Problem: the global `riskManager` singleton means User A's daily loss,
 * open positions, and halt state bleed into User B's trading.
 *
 * Solution: each user gets their own RiskManager instance keyed by userId.
 * The registry is in-process (Map), hydrated from DB on first access.
 *
 * Guarantees:
 *   • User A's daily loss never halts User B
 *   • User A's open positions never block User B from trading the same symbol
 *   • Each user's halt state is independent
 *   • DB persistence (risk_daily_pnl) is per-user via the existing userId FK
 */

import { RiskManager, DEFAULT_RISK_CONFIG } from "./riskManager";
import type { RiskConfig } from "./riskManager";
import type { TradeSource } from "../queues/tradeQueue";
import { logger } from "./logger";

// ─── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<string, RiskManager>();

function registryKey(userId: number, source: TradeSource): string {
  return `${userId}:${source}`;
}

/**
 * Returns (or creates) the RiskManager for a specific user.
 * Hydrates from DB on first access so halt state survives restarts.
 */
export async function getUserRiskManager(userId: number, source: TradeSource = "BOT"): Promise<RiskManager> {
  const key = registryKey(userId, source);
  let rm = registry.get(key);
  if (!rm) {
    rm = new RiskManager(userId, source);
    registry.set(key, rm);
    logger.info({ userId, source }, "userRiskRegistry: created new RiskManager for user/source");
    // Only the bot manager restores the persisted automated daily bucket.
    await rm.hydrateFromDb();
  }
  return rm;
}

/**
 * Synchronous get — returns undefined if not yet initialised.
 * Use this in hot paths where async is not acceptable.
 * Always call getUserRiskManager() at startup to pre-warm.
 */
export function getUserRiskManagerSync(userId: number, source: TradeSource = "BOT"): RiskManager | undefined {
  return registry.get(registryKey(userId, source));
}

/**
 * Update risk config for a specific user's RiskManager.
 */
export function updateUserRiskConfig(userId: number, patch: Partial<RiskConfig>, source: TradeSource = "BOT"): void {
  const rm = registry.get(registryKey(userId, source));
  if (rm) {
    rm.updateConfig(patch);
    logger.info({ userId, source, patch }, "userRiskRegistry: risk config updated for user/source");
  }
}

/**
 * Pre-warm all users from DB. Call once at server startup.
 * Currently a no-op unless you have a list of active users;
 * real hydration happens lazily in getUserRiskManager().
 */
export async function warmupRegistry(userIds: number[]): Promise<void> {
  for (const uid of userIds) {
    await getUserRiskManager(uid);
  }
  logger.info({ count: userIds.length }, "userRiskRegistry: warmup complete");
}

/**
 * Get the global (legacy) RiskManager — used by the single-user bot singleton.
 * As the system migrates to multi-user, prefer getUserRiskManager(userId).
 */
export const SYSTEM_USER_ID = 0;

export async function getSystemRiskManager(): Promise<RiskManager> {
  return getUserRiskManager(SYSTEM_USER_ID);
}

// ─── Re-export RiskManager defaults for convenience ──────────────────────────

export { DEFAULT_RISK_CONFIG };
export type { RiskConfig };
