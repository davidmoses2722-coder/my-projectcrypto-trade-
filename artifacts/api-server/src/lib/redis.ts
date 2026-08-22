/**
 * redis.ts — IORedis singleton connection.
 *
 * Provides a shared Redis client and graceful shutdown.
 * All BullMQ queues and trade locks use this connection.
 *
 * Redis is started by the API server startup script alongside the Node process.
 * If Redis is unavailable, the app logs a warning and trade queuing degrades
 * to the in-process fallback, but all critical risk/DB safeguards remain active.
 */

import Redis from "ioredis";
import { logger } from "./logger";

/**
 * Parse the REDIS_URL env var.
 *
 * Upstash's console provides two copy formats:
 *   • "ioredis"   → `rediss://default:TOKEN@host:6379`            (plain URL, TLS in scheme)
 *   • "redis-cli" → `redis-cli --tls -u redis://default:TOKEN@host:6379`  (CLI string, TLS via flag)
 *
 * We extract the URL and track whether --tls was present so we can force TLS
 * even when the scheme is redis:// instead of rediss://.
 */
function parseRedisUrl(raw: string): { url: string; forceTls: boolean } {
  const trimmed = raw.trim();
  const hasTlsFlag = /--tls/.test(trimmed);
  const match = trimmed.match(/rediss?:\/\/\S+/);
  if (match) {
    const url = match[0];
    // Force TLS if --tls flag was present OR scheme is already rediss://
    return { url, forceTls: hasTlsFlag || url.startsWith("rediss://") };
  }
  return { url: trimmed, forceTls: false };
}

const RAW_REDIS_URL = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
const { url: REDIS_URL, forceTls: REDIS_TLS } = parseRedisUrl(RAW_REDIS_URL);
const MAX_RETRIES = 20;

/** TLS options for Upstash and other managed Redis providers. */
function tlsOptions(): { tls?: { rejectUnauthorized: boolean } } {
  if (REDIS_TLS) {
    return { tls: { rejectUnauthorized: false } };
  }
  return {};
}

let _client: Redis | null = null;
let _connected = false;

/**
 * Returns the shared Redis client. Creates it on first call.
 * The client auto-reconnects; callers should not cache the boolean but check
 * isRedisReady() each time they need to gate on connectivity.
 */
export function getRedisClient(): Redis {
  if (_client) return _client;

  _client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    ...tlsOptions(),
    retryStrategy(times) {
      if (times > MAX_RETRIES) {
        logger.error({ times }, "Redis: max retry attempts reached — giving up");
        return null;
      }
      const delay = Math.min(times * 150, 3_000);
      logger.warn({ times, delay }, "Redis: reconnecting…");
      return delay;
    },
    reconnectOnError(err) {
      const targetErr = "READONLY";
      return err.message.includes(targetErr);
    },
  });

  _client.on("connect", () => {
    logger.info("Redis: connected");
    _connected = true;
  });

  _client.on("ready", () => {
    logger.info("Redis: ready");
    _connected = true;
  });

  _client.on("error", (err) => {
    logger.error({ err }, "Redis: error");
    _connected = false;
  });

  _client.on("close", () => {
    logger.warn("Redis: connection closed");
    _connected = false;
  });

  _client.on("reconnecting", () => {
    logger.warn("Redis: reconnecting after disconnect");
  });

  return _client;
}

/**
 * Creates a SEPARATE connection for BullMQ workers/queues.
 * BullMQ requires dedicated connections for pub/sub internals.
 * Each call returns a fresh connection — caller owns its lifecycle.
 */
export function createRedisConnection(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...tlsOptions(),
    retryStrategy(times) {
      if (times > MAX_RETRIES) return null;
      return Math.min(times * 150, 3_000);
    },
  });
}

export function isRedisReady(): boolean {
  return _connected && _client !== null && _client.status === "ready";
}

/**
 * Gracefully close the shared Redis connection.
 * Call this during process shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (_client) {
    await _client.quit().catch(() => _client?.disconnect());
    _client = null;
    _connected = false;
    logger.info("Redis: connection closed gracefully");
  }
}
