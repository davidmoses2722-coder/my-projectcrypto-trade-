import { Router, type Request, type Response } from "express";
import * as bot from "../../lib/bot";
import * as store from "../../lib/store";
import {
  normaliseTrades,
  buildSnapshot,
  computeEquityCurve,
  computeStrategyBreakdown,
  computeSymbolBreakdown,
} from "../../lib/analytics";

const router = Router();

// ── GET /api/analytics ────────────────────────────────────────────────────────
/**
 * Full analytics snapshot: all metrics, equity curve, strategy breakdown,
 * symbol breakdown, rolling PnL, heatmap, and AI-ready export.
 */
router.get("/analytics", async (_req: Request, res: Response) => {
  try {
    const [dbTrades, memTrades] = await Promise.all([
      store.listTrades(500),
      Promise.resolve(bot.getTrades()),
    ]);
    const trades   = normaliseTrades(memTrades, dbTrades);
    const snapshot = buildSnapshot(trades);

    bot.pushLog(
      "info",
      `[Analytics] Snapshot computed — ${trades.length} trades | ` +
      `PnL $${snapshot.metrics.totalPnlUsd.toFixed(2)} | ` +
      `WR ${snapshot.metrics.winRate.toFixed(1)}% | ` +
      `Sharpe ${snapshot.metrics.sharpeRatio.toFixed(2)} | ` +
      `Max DD ${snapshot.metrics.maxDrawdownPct.toFixed(1)}%`,
    );

    res.json({ ok: true, ...snapshot });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/analytics/equity ─────────────────────────────────────────────────
/**
 * Equity curve only: cumulative PnL, daily equity, rolling PnL.
 * Lighter endpoint for widgets that only need equity data.
 */
router.get("/analytics/equity", async (_req: Request, res: Response) => {
  try {
    const [dbTrades, memTrades] = await Promise.all([
      store.listTrades(500),
      Promise.resolve(bot.getTrades()),
    ]);
    const trades    = normaliseTrades(memTrades, dbTrades);
    const equity    = computeEquityCurve(trades);
    const finalPnl  = equity.length ? equity[equity.length - 1].cumPnl : 0;

    bot.pushLog(
      "info",
      `[Equity] Curve refreshed — ${equity.length} points | cumPnL $${finalPnl.toFixed(2)}`,
    );

    res.json({ ok: true, equityCurve: equity, tradeCount: trades.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/analytics/strategies ────────────────────────────────────────────
/**
 * Strategy and symbol breakdowns: per-exit-reason and per-symbol metrics.
 */
router.get("/analytics/strategies", async (_req: Request, res: Response) => {
  try {
    const [dbTrades, memTrades] = await Promise.all([
      store.listTrades(500),
      Promise.resolve(bot.getTrades()),
    ]);
    const trades   = normaliseTrades(memTrades, dbTrades);
    const strategy = computeStrategyBreakdown(trades);
    const symbol   = computeSymbolBreakdown(trades);

    bot.pushLog(
      "info",
      `[Performance] Breakdown computed — ${strategy.length} exit reasons, ${symbol.length} symbols`,
    );

    res.json({ ok: true, strategyBreakdown: strategy, symbolBreakdown: symbol, tradeCount: trades.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
