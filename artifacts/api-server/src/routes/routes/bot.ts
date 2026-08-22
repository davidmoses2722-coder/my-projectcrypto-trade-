import { Router, type IRouter, type Request, type Response } from "express";
import * as bot from "../../lib/bot";
import * as store from "../../lib/store";
import { portfolioRegistry }    from "../../lib/portfolioRegistry";
import { advancedRiskEngine }   from "../../lib/advancedRiskEngine";
import { invalidateKillSwitchCache } from "../../services/riskService";
import { STRATEGY_PARAMS } from "../../services/strategies/SwingStrategy";

const router: IRouter = Router();

// ── Bot status & control ───────────────────────────────────────────────────

router.get("/status", (_req, res) => {
  res.json({ ok: true, ...bot.buildStatus(), strategyParameters: STRATEGY_PARAMS });
});

router.get("/logs", (_req, res) => {
  res.json({ ok: true, logs: bot.getLogs() });
});

router.get("/trades", async (_req, res) => {
  const dbTrades = await store.listTrades(100);
  res.json({
    ok: true,
    trades: bot.getTrades(),
    history: dbTrades,
  });
});

router.get("/performance", async (_req, res) => {
  const days = await store.listPerformance(30);
  res.json({ ok: true, days });
});

router.post("/start", async (req: Request, res: Response) => {
  const r = await bot.start(req.body ?? {});
  if (r.ok) res.json({ ok: true, ...bot.buildStatus() });
  else res.status(400).json({ ok: false, error: r.error });
});

router.post("/stop", (_req, res) => {
  bot.stop("USER_STOP");
  res.json({ ok: true, ...bot.buildStatus() });
});

router.post("/reset-paper-balance", (_req, res) => {
  const r = bot.resetPaperBalance();
  if (r.ok) res.json({ ok: true, ...bot.buildStatus() });
  else res.status(400).json({ ok: false, error: r.error });
});

router.post("/config", (req: Request, res: Response) => {
  bot.setConfig(req.body ?? {});
  res.json({ ok: true, ...bot.buildStatus() });
});

// ── Risk Management ────────────────────────────────────────────────────────

/**
 * GET /api/risk
 * Returns the current risk manager state: halt status, daily PnL,
 * open positions, trade counts, and active config.
 */
router.get("/risk", (_req, res) => {
  const state = bot.getRiskState();
  res.json({ ok: true, risk: state });
});

// ── Portfolio ──────────────────────────────────────────────────────────────

/**
 * GET /api/portfolio
 * Full portfolio snapshot: all open positions with live unrealized PnL,
 * total USDT exposure, per-symbol and per-strategy allocation breakdown.
 */
router.get("/portfolio", (_req, res) => {
  res.json({ ok: true, portfolio: portfolioRegistry.getSnapshot() });
});

// ── Advanced risk engine ────────────────────────────────────────────────────

/**
 * GET /api/risk/status
 * Full advanced risk engine status: portfolio state, drawdown, PnL buckets,
 * loss streak, cooldown timer, volatility state, and active warnings.
 */
router.get("/risk/status", (_req, res) => {
  res.json({
    ok:          true,
    riskStatus:  advancedRiskEngine.getStatus(),
    portfolio:   portfolioRegistry.getSnapshot(),
  });
});

/**
 * POST /api/risk/advanced/config
 * Update advanced risk limits at runtime.
 * Accepted fields:
 *   maxDrawdownPct        — e.g. 0.20  (20% drawdown from equity peak)
 *   dailyLossLimitUsd     — e.g. -100
 *   weeklyLossLimitUsd    — e.g. -300
 *   monthlyLossLimitUsd   — e.g. -800
 *   consecutiveLossLimit  — e.g. 3
 *   cooldownAfterLossMs   — e.g. 300000 (5 min)
 *   volatilityKillSwitch  — true/false
 *   maxConcurrentLosses   — e.g. 2
 *   volatilityAtrMultiple — e.g. 3.0
 */
router.post("/risk/advanced/config", (req: Request, res: Response) => {
  advancedRiskEngine.updateConfig(req.body ?? {});
  res.json({ ok: true, riskStatus: advancedRiskEngine.getStatus() });
});

/**
 * POST /api/risk/advanced/clear-halt
 * Clear a HALTED state set by the advanced risk engine.
 * Does NOT reset PnL buckets — operator must resolve root cause first.
 */
router.post("/risk/advanced/clear-halt", (_req, res) => {
  advancedRiskEngine.clearHalt();
  res.json({ ok: true, riskStatus: advancedRiskEngine.getStatus() });
});

/**
 * POST /api/risk/advanced/clear-cooldown
 * Clear an active cooldown early (operator override).
 */
router.post("/risk/advanced/clear-cooldown", (_req, res) => {
  advancedRiskEngine.clearCooldown();
  res.json({ ok: true, riskStatus: advancedRiskEngine.getStatus() });
});

/**
 * POST /api/risk/advanced/reset-daily-pnl
 * Reset daily/weekly/monthly PnL buckets (operator action).
 * Also clears a halt triggered by loss limits.
 */
router.post("/risk/advanced/reset-daily-pnl", (_req, res) => {
  advancedRiskEngine.resetDailyPnl();
  res.json({ ok: true, riskStatus: advancedRiskEngine.getStatus() });
});

/**
 * POST /api/risk/advanced/reset-loss-streak
 * Reset consecutive loss streak counter (operator action).
 * Also lifts an active cooldown if one is in progress.
 */
router.post("/risk/advanced/reset-loss-streak", (_req, res) => {
  advancedRiskEngine.resetLossStreak();
  res.json({ ok: true, riskStatus: advancedRiskEngine.getStatus() });
});

/**
 * POST /api/portfolio/config
 * Update portfolio limits at runtime.
 * Accepted fields:
 *   maxTotalExposureUsdt  — e.g. 500 (USDT cap across all open positions)
 *   maxOpenPositions      — e.g. 3   (max concurrent positions)
 *   maxPerSymbol          — e.g. 1   (max positions per trading pair)
 *   maxPerStrategy        — e.g. 1   (max positions per strategy engine)
 */
router.post("/portfolio/config", (req: Request, res: Response) => {
  const patch = req.body ?? {};
  portfolioRegistry.updateConfig(patch);
  res.json({ ok: true, portfolio: portfolioRegistry.getSnapshot() });
});

/**
 * POST /api/risk/config
 * Update risk parameters at runtime. Accepted fields:
 *   maxPositionSizePct  — e.g. 0.10  (10% of balance max)
 *   maxRiskPerTradePct  — e.g. 0.01  (1% of balance risked at SL)
 *   maxDailyLossUsd     — e.g. -50   (halt when daily PnL ≤ this)
 *   maxOpenPositions    — e.g. 1
 *   minBalanceUsd       — e.g. 10
 *   tradeCooldownMs     — e.g. 30000
 *   maxTradesPerDay     — e.g. 20
 */
router.post("/risk/config", (req: Request, res: Response) => {
  const patch = req.body ?? {};
  bot.setRiskConfig(patch);
  res.json({ ok: true, risk: bot.getRiskState() });
});

/**
 * POST /api/risk/halt
 * Immediately halt trading. Optionally pass { reason: "..." }.
 * The bot loop will stop and no new orders will be placed.
 */
router.post("/risk/halt", (req: Request, res: Response) => {
  const reason: string = req.body?.reason ?? "manual halt via API";
  bot.forceRiskHalt(reason);
  res.json({ ok: true, risk: bot.getRiskState() });
});

/**
 * POST /api/risk/resume
 * Clear a risk halt so trading can resume (bot must be re-started separately).
 * This does NOT automatically restart the bot loop.
 */
router.post("/risk/resume", (_req, res) => {
  bot.clearRiskHalt();
  res.json({ ok: true, risk: bot.getRiskState() });
});

/**
 * GET /api/risk/events
 * Returns the last N risk audit events from the DB (default 100).
 */
router.get("/risk/events", async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
  const events = await store.listRiskEvents(limit);
  res.json({ ok: true, events });
});

/**
 * GET /api/kill-switch
 * Returns the current global kill switch state.
 */
router.get("/kill-switch", async (_req, res) => {
  const enabled = await store.isTradingEnabled();
  const envOverride = process.env["TRADING_ENABLED"];
  const dbValue = await store.getSetting("trading_enabled");
  res.json({
    ok: true,
    tradingEnabled: enabled,
    envOverride: envOverride ?? null,
    dbValue: dbValue ?? null,
  });
});

/**
 * POST /api/kill-switch
 * Toggle the global kill switch.
 * Body: { enabled: boolean }
 *   enabled=false → KILL SWITCH ACTIVE (no trades will execute)
 *   enabled=true  → Kill switch lifted (normal operation)
 */
router.post("/kill-switch", async (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: unknown };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ ok: false, error: "Body must be { enabled: boolean }" });
    return;
  }
  await store.setSetting("trading_enabled", enabled ? "true" : "false");
  // Invalidate the in-process kill switch cache immediately
  invalidateKillSwitchCache();
  if (!enabled) {
    // Log the kill switch activation as a risk event
    void store.logRiskEvent({
      eventType: "KILL_SWITCH",
      reason: "Kill switch ACTIVATED by operator via API",
      meta: { enabled: false, source: "api" },
    });
    // Force-halt the bot so it stops opening new positions
    bot.forceRiskHalt("Global kill switch activated via API");
  } else {
    void store.logRiskEvent({
      eventType: "HALT_CLEARED",
      reason: "Kill switch LIFTED by operator via API",
      meta: { enabled: true, source: "api" },
    });
  }
  res.json({
    ok: true,
    tradingEnabled: enabled,
    message: enabled
      ? "Kill switch lifted — trading is now ENABLED"
      : "Kill switch ACTIVE — all new trades are BLOCKED",
  });
});

export default router;
