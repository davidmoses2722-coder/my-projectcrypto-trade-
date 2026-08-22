/**
 * redisHealthService.ts — Redis connection health monitoring.
 *
 * Provides:
 *   checkConnection()  — ping Redis and record latency/status
 *   reconnect()        — force a reconnect attempt
 *   getStatus()        — return current cached status
 *   onConnected()      — register a callback fired when Redis comes up
 *   onDisconnected()   — register a callback fired when Redis goes down
 *
 * Used by app.ts (startup banner) and tradeQueue/tradeWorker (pause/resume).
 */

import { EventEmitter } from "events";
import { getRedisClient } from "../lib/redis";
import { logger } from "../lib/logger";

// ─── Status shape ─────────────────────────────────────────────────────────────

export interface RedisHealthStatus {
  connected: boolean;
  latencyMs: number | null;
  lastCheckAt: number;
  reconnectAttempts: number;
  error: string | null;
}

// ─── Internal state ───────────────────────────────────────────────────────────

const emitter = new EventEmitter();
emitter.setMaxListeners(20); // queue + worker + health monitor + app

let _status: RedisHealthStatus = {
  connected: false,
  latencyMs: null,
  lastCheckAt: 0,
  reconnectAttempts: 0,
  error: null,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/** Return a shallow copy of the current status (non-blocking). */
export function getStatus(): RedisHealthStatus {
  return { ..._status };
}

/**
 * Ping Redis and update cached status.
 * Always resolves — never throws.
 * Uses a 2-second timeout so it never hangs when Redis is unavailable.
 */
export async function checkConnection(): Promise<RedisHealthStatus> {
  try {
    const client = getRedisClient();

    // Fast non-blocking status check — avoids hanging when IORedis is buffering
    const st = client.status;
    if (st !== "ready" && st !== "connect") {
      throw new Error(`Redis not ready (status: ${st})`);
    }

    const t0 = Date.now();
    // Race against a 2-second timeout in case the client is transitioning
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ping timeout after 2000ms")), 2_000),
      ),
    ]);
    const latencyMs = Date.now() - t0;

    const wasDown = !_status.connected;
    _status = {
      connected: true,
      latencyMs,
      lastCheckAt: Date.now(),
      reconnectAttempts: _status.reconnectAttempts,
      error: null,
    };
    if (wasDown) {
      logger.info({ latencyMs }, "redisHealth: Redis is now connected");
      emitter.emit("connected");
    }
  } catch (e) {
    const wasUp = _status.connected;
    const error = e instanceof Error ? e.message : String(e);
    _status = {
      connected: false,
      latencyMs: null,
      lastCheckAt: Date.now(),
      reconnectAttempts: _status.reconnectAttempts,
      error,
    };
    if (wasUp) {
      logger.warn({ error }, "redisHealth: Redis connection lost");
      emitter.emit("disconnected", error);
    }
  }
  return getStatus();
}

/**
 * Force a reconnect attempt and return whether it succeeded.
 * Increments the reconnect counter.
 */
export async function reconnect(): Promise<boolean> {
  _status.reconnectAttempts++;
  logger.info({ attempt: _status.reconnectAttempts }, "redisHealth: attempting reconnect");
  const result = await checkConnection();
  if (result.connected) {
    logger.info({ latencyMs: result.latencyMs }, "redisHealth: reconnect succeeded");
    return true;
  }
  logger.warn(
    { error: result.error, attempt: result.reconnectAttempts },
    "redisHealth: reconnect failed — will retry automatically via IORedis",
  );
  return false;
}

/**
 * Register a callback that fires when Redis transitions from down → up.
 * Safe to call multiple times; each call adds a listener.
 */
export function onConnected(cb: () => void): void {
  emitter.on("connected", cb);
}

/**
 * Register a callback that fires when Redis transitions from up → down.
 */
export function onDisconnected(cb: (error: string) => void): void {
  emitter.on("disconnected", cb);
}

/**
 * Wire the IORedis client events into this health service so status stays
 * current without polling.  Call once at startup from app.ts.
 */
export function attachToRedisClient(): void {
  try {
    const client = getRedisClient();

    client.on("ready", () => {
      const wasDown = !_status.connected;
      _status = { ..._status, connected: true, latencyMs: null, error: null, lastCheckAt: Date.now() };
      if (wasDown) emitter.emit("connected");
    });

    client.on("error", (err: Error) => {
      const wasUp = _status.connected;
      _status = { ..._status, connected: false, error: err.message, lastCheckAt: Date.now() };
      if (wasUp) emitter.emit("disconnected", err.message);
    });

    client.on("close", () => {
      const wasUp = _status.connected;
      _status = { ..._status, connected: false, lastCheckAt: Date.now() };
      if (wasUp) emitter.emit("disconnected", "connection closed");
    });

    client.on("reconnecting", () => {
      _status.reconnectAttempts++;
    });
  } catch (e) {
    logger.warn({ err: e }, "redisHealth: could not attach to Redis client events");
  }
}

/**
 * Start periodic background health checks.
 * @param intervalMs  How often to poll (default 30 s).
 */
export function startHealthPolling(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    void checkConnection();
  }, intervalMs);
}
