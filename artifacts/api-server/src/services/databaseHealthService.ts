/**
 * databaseHealthService.ts — PostgreSQL connection health monitoring.
 *
 * Provides:
 *   checkConnection()      — ping the DB pool, record latency/status
 *   getStatus()            — return current cached status (non-blocking)
 *   verifyTables()         — confirm all required application tables exist
 *   isDbAvailable()        — quick boolean gate for write guards
 *   startDbHealthPolling() — background polling timer (default 60 s)
 *
 * Used by app.ts (startup banner) and index.ts (startup status display).
 * If the database is unavailable the service logs a warning but never throws —
 * the server continues in limited mode; store.ts catches all query errors.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

// ─── Status shape ─────────────────────────────────────────────────────────────

export interface DbHealthStatus {
  connected: boolean;
  latencyMs: number | null;
  lastCheckAt: number;
  tablesVerified: boolean;
  missingTables: string[];
  error: string | null;
}

// ─── Required tables ──────────────────────────────────────────────────────────

export const REQUIRED_TABLES = [
  "users",
  "api_keys",
  "trades",
  "performance_history",
  "risk_events",
  "bot_configurations",
] as const;

// Required columns on the users table (DB column names)
const REQUIRED_USERS_COLUMNS = [
  "id",
  "username",
  "email",
  "password_hash",
  "created_at",
] as const;

// ─── Internal state ───────────────────────────────────────────────────────────

let _status: DbHealthStatus = {
  connected: false,
  latencyMs: null,
  lastCheckAt: 0,
  tablesVerified: false,
  missingTables: [],
  error: null,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/** Return a shallow copy of the current cached status (non-blocking). */
export function getStatus(): DbHealthStatus {
  return { ..._status };
}

/** Return true if the last connection check succeeded. */
export function isDbAvailable(): boolean {
  return _status.connected;
}

/**
 * Execute `SELECT 1` against the pool to verify connectivity.
 * Always resolves — never throws.
 */
export async function checkConnection(): Promise<DbHealthStatus> {
  if (!process.env["DATABASE_URL"]) {
    _status = {
      connected: false,
      latencyMs: null,
      lastCheckAt: Date.now(),
      tablesVerified: false,
      missingTables: [...REQUIRED_TABLES],
      error: "DATABASE_URL is not set",
    };
    return getStatus();
  }

  try {
    const t0 = Date.now();
    await pool.query("SELECT 1");
    const latencyMs = Date.now() - t0;

    const wasDown = !_status.connected;
    _status = {
      ..._status,
      connected: true,
      latencyMs,
      lastCheckAt: Date.now(),
      error: null,
    };

    if (wasDown) {
      logger.info({ latencyMs }, "databaseHealth: database connection restored");
    }
  } catch (e) {
    const wasUp = _status.connected;
    const error = e instanceof Error ? e.message : String(e);

    _status = {
      ..._status,
      connected: false,
      latencyMs: null,
      lastCheckAt: Date.now(),
      tablesVerified: false,
      error,
    };

    if (wasUp) {
      logger.error({ error }, "databaseHealth: database connection lost — running with limited functionality");
    }
  }

  return getStatus();
}

/**
 * Query information_schema to confirm all required tables are present.
 * Should be called after checkConnection() succeeds.
 * Always resolves — never throws.
 */
export async function verifyTables(): Promise<{ ok: boolean; missing: string[] }> {
  try {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type   = 'BASE TABLE'`,
    );

    const existing = new Set(result.rows.map((r) => r.table_name));
    const missing = REQUIRED_TABLES.filter((t) => !existing.has(t));

    _status.tablesVerified = missing.length === 0;
    _status.missingTables  = missing;

    if (missing.length > 0) {
      logger.warn(
        { missing },
        "databaseHealth: missing tables — run: pnpm --filter @workspace/db run push",
      );
    } else {
      logger.info(
        { tables: REQUIRED_TABLES.length },
        "databaseHealth: all required tables verified",
      );
    }

    return { ok: missing.length === 0, missing };
  } catch (e) {
    logger.error({ err: e }, "databaseHealth: verifyTables query failed");
    _status.tablesVerified = false;
    _status.missingTables  = [...REQUIRED_TABLES];
    return { ok: false, missing: [...REQUIRED_TABLES] };
  }
}

/**
 * Verify that the users table exists and has all required columns.
 * Returns { ok, missing } where missing lists any absent column names.
 * Always resolves — never throws.
 */
export async function verifyUsersColumns(): Promise<{ ok: boolean; missing: string[] }> {
  try {
    const result = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'users'`,
    );

    const existing = new Set(result.rows.map((r) => r.column_name));
    const missing = REQUIRED_USERS_COLUMNS.filter((c) => !existing.has(c));

    if (missing.length > 0) {
      logger.warn(
        { missing },
        "databaseHealth: users table is missing required columns — run: pnpm --filter @workspace/db run push",
      );
    } else {
      logger.info("databaseHealth: users table columns verified (id, username, email, password_hash, created_at)");
    }

    return { ok: missing.length === 0, missing };
  } catch (e) {
    logger.error({ err: e }, "databaseHealth: verifyUsersColumns query failed");
    return { ok: false, missing: [...REQUIRED_USERS_COLUMNS] };
  }
}

/**
 * Perform a lightweight read against the users table to confirm authentication
 * queries are functional (SELECT with LIMIT 0 — touches no real rows).
 * Always resolves — never throws.
 */
export async function verifyAuthFunctionality(): Promise<{ ok: boolean; error: string | null }> {
  try {
    await pool.query("SELECT id, username, email, password_hash FROM users LIMIT 0");
    logger.info("databaseHealth: authentication query path verified");
    return { ok: true, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error({ err: e }, "databaseHealth: authentication query path failed");
    return { ok: false, error };
  }
}

/**
 * Start a periodic background health check.
 * @param intervalMs  Poll interval in milliseconds (default 60 s).
 */
export function startDbHealthPolling(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    void checkConnection();
  }, intervalMs);
}
