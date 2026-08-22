import app from "./app";
import { logger } from "./lib/logger";
import { validateEncryptionKey } from "./lib/crypto";
import { getRedisClient } from "./lib/redis";
import { checkConnection as checkRedis } from "./services/redisHealthService";
import {
  checkConnection as checkDb,
  verifyTables,
  verifyUsersColumns,
  verifyAuthFunctionality,
} from "./services/databaseHealthService";
import { runStartupGuard } from "./services/startupGuard";
import { setConfig } from "./lib/bot";
import { gateioWs } from "./lib/gateioWs";
import { registerWebhook } from "./lib/telegramWebhook";

// ─── Encryption subsystem ─────────────────────────────────────────────────────

let encryptionReady = false;

try {
  validateEncryptionKey();
  encryptionReady = true;
} catch (e) {
  logger.warn(
    { err: e },
    "ENCRYPTION_KEY not set or invalid — API key encryption disabled. Live trading automatically disabled.",
  );
  // Expose flag so route handlers can gate live-trading paths
  process.env["LIVE_TRADING_DISABLED"] = "1";
}

// ─── Startup validation display ───────────────────────────────────────────────

async function printStartupStatus(): Promise<void> {
  // Give services a moment to attempt their connections
  await new Promise<void>((r) => setTimeout(r, 800));

  // ── Database ────────────────────────────────────────────────────────────────
  const dbStatus = await checkDb();

  let dbConnLine: string;
  let usersTableLine: string;
  let authVerifyLine: string;

  if (!process.env["DATABASE_URL"]) {
    dbConnLine     = "⚠ Database connected    : NOT configured — set DATABASE_URL";
    usersTableLine = "⚠ Users table verified  : skipped (no database)";
    authVerifyLine = "⚠ Authentication verified: skipped (no database)";
  } else if (dbStatus.connected) {
    dbConnLine = `✓ Database connected    : yes (${dbStatus.latencyMs ?? "?"}ms)`;

    const { ok: tablesOk, missing: missingTables } = await verifyTables();
    const usersPresent = !missingTables.includes("users");

    if (!tablesOk) {
      usersTableLine = usersPresent
        ? `⚠ Users table verified  : present (other missing: ${missingTables.filter((t) => t !== "users").join(", ")})`
        : `⚠ Users table verified  : MISSING — run: pnpm --filter @workspace/db run push`;
      authVerifyLine = usersPresent
        ? "⚠ Authentication verified: schema incomplete — run migrations"
        : "⚠ Authentication verified: users table missing — run migrations";
    } else {
      const { ok: colsOk, missing: missingCols } = await verifyUsersColumns();
      if (!colsOk) {
        usersTableLine = `⚠ Users table verified  : missing columns: ${missingCols.join(", ")}`;
        authVerifyLine = "⚠ Authentication verified: schema out of date — run: pnpm --filter @workspace/db run push";
      } else {
        usersTableLine = "✓ Users table verified  : all required columns present";
        const { ok: authOk } = await verifyAuthFunctionality();
        authVerifyLine = authOk
          ? "✓ Authentication verified: register / login / lookup paths ready"
          : "⚠ Authentication verified: query path failed — check DB logs";
      }
    }
  } else {
    dbConnLine     = "⚠ Database connected    : unavailable — running with limited functionality";
    usersTableLine = "⚠ Users table verified  : skipped (database unreachable)";
    authVerifyLine = "⚠ Authentication verified: skipped (database unreachable)";
  }

  // ── Redis ───────────────────────────────────────────────────────────────────
  const redisStatus = await checkRedis();
  const redisLine = redisStatus.connected
    ? `✓ Redis      : connected (${redisStatus.latencyMs ?? "?"}ms)`
    : `⚠ Redis      : unavailable — queue features disabled (set REDIS_URL for full support)`;

  // ── Exchange ────────────────────────────────────────────────────────────────
  const gateioKey = process.env["GATEIO_API_KEY"];
  const exchangeStatus = gateioKey
    ? "Gate.io (env key loaded)"
    : "Gate.io (no env key — configure via UI)";

  // ── Trading / Encryption ────────────────────────────────────────────────────
  const liveTradingDisabled = process.env["LIVE_TRADING_DISABLED"] === "1";
  const tradingMode = liveTradingDisabled
    ? "PAPER only (live disabled — missing ENCRYPTION_KEY)"
    : "Paper / Live (per bot config)";
  const encStatus = encryptionReady
    ? "ready"
    : "DISABLED — set ENCRYPTION_KEY (openssl rand -base64 32)";

  logger.info("─────────────────────────────────────────────────");
  logger.info("  Pro Crypto Bot — Startup Status");
  logger.info("─────────────────────────────────────────────────");
  logger.info(`  ${dbConnLine}`);
  logger.info(`  ${usersTableLine}`);
  logger.info(`  ${authVerifyLine}`);
  logger.info(`  ${redisLine}`);
  logger.info(`  ✓ Exchange   : ${exchangeStatus}`);
  logger.info(`  ✓ Trading    : ${tradingMode}`);
  logger.info(`  ✓ Encryption : ${encStatus}`);
  logger.info("─────────────────────────────────────────────────");

  // ── Trading safety gate ──────────────────────────────────────────────────────
  // Runs AFTER all subsystem checks so getStatus() returns current values.
  const guard = await runStartupGuard();
  if (!guard.liveTradingAllowed) {
    setConfig({ testMode: true });
    logger.warn(
      { blockedReasons: guard.blockedReasons },
      "Startup guard: paper mode enforced — live trading blocked until prerequisites are resolved",
    );
  }

  // ── Gate.io WebSocket market feed ─────────────────────────────────────────────
  // Connect with a bounded timeout so a slow WS handshake never stalls startup.
  logger.info("─────────────────────────────────────────────────");
  try {
    await Promise.race([
      gateioWs.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("connect timeout")), 8_000),
      ),
    ]);
    logger.info("  ✓ WebSocket connected   : Gate.io live market feed active");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    logger.warn(`  ⚠ WebSocket unavailable — REST fallback active (${reason})`);
  }
  logger.info("─────────────────────────────────────────────────");
}

// ─── Server startup ───────────────────────────────────────────────────────────

const rawPort = process.env["PORT"] ?? "3001";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Initialise Redis client so it starts connecting before app.ts init() runs
try { getRedisClient(); } catch { /* logged inside redis.ts */ }

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  void printStartupStatus();
  void registerWebhook();
});
