import { Router, type IRouter, type Request, type Response } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import marketRouter from "./market";
import botRouter from "./bot";
import exchangeRouter from "./exchange";
import exchangesRouter from "./exchanges";
import telegramRouter from "./telegram";
import telegramWebhookRouter from "./telegramWebhook";
import analyticsRouter from "./analytics";
import orchestratorRouter from "./orchestrator";
import scannerRouter from "./scanner";
import positionSizingRouter from "./position-sizing";
import backtestRouter from "./backtest";
import strategyRankingRouter from "./strategy-ranking";
import walkForwardRouter from "./walk-forward";
import optimizerRouter from "./optimizer";
import capitalProtectionRouter from "./capital-protection";
import correlationRiskRouter from "./correlation-risk";
import executionAnalyticsRouter from "./execution-analytics";
import tradeJournalRouter from "./trade-journal";
import tradeReviewRouter from "./trade-review";
import portfolioManagerRouter from "./portfolio-manager";
import regimeIntelligenceRouter from "./regime-intelligence";
import livePerformanceRouter from "./live-performance";
import benchmarkRouter from "./benchmark";
import activeSwingRouter from "./activeSwing";
import conservativeScalpingRouter from "./conservativeScalping";
import opportunitiesRouter from "./opportunities";
import validationRouter from "./validation";
import positionsRouter from "./positions";
import manualTradingRouter from "./manual-trading";
import futuresRouter from "./futures";
import ordersRouter from "./orders";
import strategyProfilesRouter from "./strategy-profiles";
import copyTradingRouter from "./copy-trading";
import systemHealthRouter from "./systemHealth";
import atrRouter            from "./atr";
import tradingParamsRouter  from "./trading-params";
import { requireAuth } from "../../middleware/authMiddleware";
import { subscribeToLogs, getLogs, subscribeToPositionEvents } from "../../lib/bot";
import { subscribeEvents } from "../../lib/eventBus";

const router: IRouter = Router();

// ── Public ──────────────────────────────────────────────────────────────────
router.use(healthRouter);
router.use(authRouter);
router.use(marketRouter);
router.use(telegramWebhookRouter);
router.use(systemHealthRouter);
router.use(atrRouter);   // Phase 12.1: ATR health + log endpoints (no auth)

// ── Public: SSE log stream (EventSource cannot send custom auth headers) ─────
router.get("/bot/logs/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send existing backlog immediately so the console pre-fills
  const backlog = getLogs();
  res.write(`data: ${JSON.stringify({ type: "init", logs: backlog })}\n\n`);

  // Subscribe to every new pushLog entry
  const unsub = subscribeToLogs((entry) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: "log", entry })}\n\n`);
  });

  // Subscribe to position open/close events for immediate dashboard sync
  const unsubPos = subscribeToPositionEvents((event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: `position:${event.type}`, symbol: event.symbol })}\n\n`);
  });

  // Subscribe to config / risk updates (Phase 13 — runtime configuration authority)
  const unsubEvents = subscribeEvents((event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: event.type, payload: event.payload, ts: event.ts })}\n\n`);
  });

  // Keepalive ping every 20 s to prevent proxy/load-balancer timeouts
  const keepalive = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 20_000);

  req.on("close", () => {
    unsub();
    unsubPos();
    unsubEvents();
    clearInterval(keepalive);
  });
});

// ── Protected (JWT required) ────────────────────────────────────────────────
router.use(requireAuth);
router.use(botRouter);
router.use(exchangeRouter);
router.use(exchangesRouter);
router.use(telegramRouter);
router.use(analyticsRouter);
router.use(orchestratorRouter);
router.use(scannerRouter);
router.use(positionSizingRouter);
router.use(backtestRouter);
router.use(strategyRankingRouter);
router.use(walkForwardRouter);
router.use(optimizerRouter);
router.use(capitalProtectionRouter);
router.use(correlationRiskRouter);
router.use(executionAnalyticsRouter);
router.use(tradeJournalRouter);
router.use(tradeReviewRouter);
router.use(portfolioManagerRouter);
router.use(regimeIntelligenceRouter);
router.use(livePerformanceRouter);
router.use(benchmarkRouter);
router.use(activeSwingRouter);
router.use(conservativeScalpingRouter);
router.use(opportunitiesRouter);
router.use(validationRouter);
router.use(positionsRouter);
router.use(manualTradingRouter);
router.use(futuresRouter);
router.use(ordersRouter);
router.use(strategyProfilesRouter);
router.use(copyTradingRouter);
router.use(tradingParamsRouter);   // Phase 13: Configuration Authority

export default router;
