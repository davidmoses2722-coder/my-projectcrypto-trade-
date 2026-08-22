import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { getRedisClient } from "./lib/redis";
import { startTradeWorker, stopTradeWorker } from "./workers/tradeWorker";
import { closeTradeQueue } from "./queues/tradeQueue";
import { startTradeMonitor, stopTradeMonitor } from "./services/tradeMonitorService";
import { hydrateFromDb, restoreOpenPositionsFromDb } from "./lib/bot";
import { tradeJournal } from "./lib/tradeJournal";
import {
  attachToRedisClient,
  checkConnection as checkRedis,
  startHealthPolling as startRedisPolling,
} from "./services/redisHealthService";
import {
  checkConnection as checkDb,
  verifyTables,
  startDbHealthPolling,
} from "./services/databaseHealthService";

const app: Express = express();

// Trust Replit's reverse proxy so express-rate-limit can read the real client IP
app.set("trust proxy", 1);

// Security headers (before all other middleware)
app.use(helmet({
  contentSecurityPolicy: false,  // disabled — API-only server, no HTML served
  crossOriginEmbedderPolicy: false,
}));

// Global rate limiter: 5000 req / 15 min per IP.
// The dashboard's own status/trades polling alone is ~2 req/3s (~600/15min)
// per open tab, and there are a dozen+ panels polling on their own intervals
// on top of that — the old 500/15min ceiling was lower than normal single-tab
// usage and made even login/register look "too many requests" since the
// global limiter runs in front of every /api route, auth included.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests — please try again later." },
});
app.use(globalLimiter);

// Auth limiter: 100 attempts / 5 min per IP (brute-force protection).
// Kept separate and tighter than the global limiter, but no longer the
// bottleneck now that the global ceiling is high enough for normal polling.
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many authentication attempts." },
});
app.use("/api/auth", authLimiter);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS: reflect origin in dev (FRONTEND_URL not set), restrict to specific origin in prod
app.use(cors({
  origin: process.env.FRONTEND_URL ?? true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ─── Serve the React dashboard (built frontend) ─────────────────────────────
// The frontend build output lives at ../pro-crypto-bot/dist/public relative to
// the dist/ directory where this bundled server runs.
const __runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__runtimeDir, "../../pro-crypto-bot/dist/public");
app.use(express.static(frontendDir));

// Dedicated download route for project zip
app.get("/elite-trade.zip", (_req, res) => {
  const zipPath = path.join(frontendDir, "elite-trade.zip");
  res.setHeader("Content-Disposition", 'attachment; filename="elite-trade.zip"');
  res.setHeader("Content-Type", "application/zip");
  res.sendFile(zipPath);
});

app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

// ─── Database initialisation ──────────────────────────────────────────────────

/**
 * Initialise and verify the database:
 *   1. Ping the pool to confirm connectivity
 *   2. If connected, query information_schema to verify all required tables
 *   3. Start 60-second background polling for ongoing health tracking
 *
 * Non-fatal — server boots in limited mode if DB is unavailable.
 */
async function initDatabase(): Promise<boolean> {
  const status = await checkDb();

  if (status.connected) {
    logger.info({ latencyMs: status.latencyMs }, "✓ Database connected");
    const { ok, missing } = await verifyTables();
    if (!ok) {
      logger.warn(
        { missing },
        "⚠ Database: schema incomplete — run: pnpm --filter @workspace/db run push",
      );
    }
  } else {
    logger.warn(
      { error: status.error },
      "⚠ Database unavailable — running with limited functionality; writes will fail gracefully",
    );
  }

  startDbHealthPolling(60_000);
  return status.connected;
}

// ─── Redis initialisation ─────────────────────────────────────────────────────

/**
 * Initialise Redis:
 *   1. Start IORedis client (auto-reconnects internally)
 *   2. Wire health-service listeners to the client events
 *   3. Attempt an initial ping to determine current status
 *   4. Start background health polling (30 s interval)
 */
async function initRedis(): Promise<boolean> {
  try {
    getRedisClient();         // creates the singleton, starts connecting
    attachToRedisClient();    // wire health-service events to the IORedis client
  } catch (e) {
    logger.warn({ err: e }, "Startup: could not create Redis client");
    return false;
  }

  // Give the connection a moment to establish before checking
  await new Promise<void>((r) => setTimeout(r, 600));
  const status = await checkRedis();

  if (status.connected) {
    logger.info({ latencyMs: status.latencyMs }, "✓ Redis connected");
  } else {
    logger.warn(
      { error: status.error },
      "⚠ Redis unavailable — queue/worker will start in limited mode and resume automatically when Redis becomes reachable",
    );
  }

  startRedisPolling(30_000);
  return status.connected;
}

// ─── Startup initialization ───────────────────────────────────────────────────

async function init(): Promise<void> {
  // 1. Verify database (non-fatal if unavailable)
  await initDatabase();

  // 2. Initialise Redis (non-fatal if unavailable)
  await initRedis();

  // 3. Start the trade worker (pauses itself when Redis is unavailable)
  try {
    startTradeWorker();
    logger.info("Startup: trade worker started");
  } catch (e) {
    logger.warn({ err: e }, "Startup: trade worker could not start (Redis may be unavailable) — continuing without it");
  }

  // 4. Start the trade monitor
  try {
    startTradeMonitor();
    logger.info("Startup: trade monitor started");
  } catch (e) {
    logger.warn({ err: e }, "Startup: trade monitor failed to start — continuing");
  }

  // 5. Hydrate bot state from DB
  try {
    await hydrateFromDb();
    logger.info("Startup: bot state hydrated from DB");
  } catch (e) {
    logger.warn({ err: e }, "Startup: hydrateFromDb failed — starting with fresh state");
  }

  // 5b. Restore any open position(s) that existed before this restart
  // (P0 Fix #6 — position persistence + reconciliation)
  try {
    const restoreResult = await restoreOpenPositionsFromDb();
    if (restoreResult.restoredCount > 0) {
      logger.info(restoreResult, "Startup: position restoration summary");
    }
  } catch (e) {
    logger.warn({ err: e }, "Startup: restoreOpenPositionsFromDb failed — continuing with no restored positions");
  }

  // 5c. Restore trade journal entries so history survives a restart
  try {
    await tradeJournal.hydrate();
  } catch (e) {
    logger.warn({ err: e }, "Startup: tradeJournal.hydrate failed — continuing with empty journal");
  }
}

// Run init (fire-and-forget — server starts immediately)
void init();

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received — closing gracefully");
  try {
    stopTradeMonitor();
    await stopTradeWorker();
    await closeTradeQueue();
    logger.info("Shutdown: trade infrastructure closed");
  } catch (e) {
    logger.error({ err: e }, "Shutdown: error closing trade infrastructure");
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));

export default app;
