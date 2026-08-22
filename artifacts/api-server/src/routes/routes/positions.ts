/**
 * positions.ts — Live position analytics + manual position control endpoints.
 *
 * GET  /api/positions/live                    — real-time lifecycle analytics
 * POST /api/positions/:symbol/take-profit     — manually take profit
 * POST /api/positions/:symbol/close           — manually close position
 * POST /api/positions/:symbol/close-partial   — close a % of position (NOT YET SUPPORTED — see below)
 * POST /api/positions/:symbol/breakeven       — move SL to breakeven
 * POST /api/positions/:symbol/trailing        — enable/disable trailing stop
 * POST /api/positions/:symbol/lock-profit     — lock profit at current level
 *
 * Phase A fix: every action below now calls a real positionLifecycleManager
 * method and returns {ok:false} with an appropriate status code when the
 * action genuinely cannot be performed. None of these routes return
 * {ok:true} unless the requested change actually happened.
 *
 * Protected: requireAuth applied in index.ts.
 */

import { Router, type Request, type Response } from "express";
import { positionLifecycleManager } from "../../lib/positionLifecycleManager";
import * as bot from "../../lib/bot";
import { publishEvent } from "../../lib/eventBus";
import { logger } from "../../lib/logger";

const router = Router();

// ─── GET /api/positions/live ──────────────────────────────────────────────────

router.get("/positions/live", (_req: Request, res: Response): void => {
  try {
    const positions = positionLifecycleManager.getAll();
    res.json({ ok: true, positions });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/positions/:symbol/take-profit ──────────────────────────────────

router.post("/positions/:symbol/take-profit", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "");
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  try {
    const result = await bot.triggerManualClose(symbol, "manual_take_profit");
    if (!result.ok) {
      const status = result.error === "No open position" ? 404 : 409;
      res.status(status).json(result);
      return;
    }
    publishEvent({ type: "position:update", payload: { action: "take_profit", symbol }, ts: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/positions/:symbol/close ────────────────────────────────────────

router.post("/positions/:symbol/close", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "");
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  try {
    const result = await bot.triggerManualClose(symbol, "manual_close");
    if (!result.ok) {
      const status = result.error === "No open position" ? 404 : 409;
      res.status(status).json(result);
      return;
    }
    publishEvent({ type: "position:update", payload: { action: "close", symbol }, ts: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/positions/:symbol/close-partial ────────────────────────────────
// Body: { pct: 25 | 50 | 75 }
//
// Closes a percentage of the active position. Uses the full execution pipeline
// (BullMQ → tradeWorker → paper/live exchange) so the close is real.

router.post("/positions/:symbol/close-partial", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "");
  const pct    = Number((req.body as { pct?: number })?.pct ?? 50);
  const valid  = [25, 50, 75];
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  if (!valid.includes(pct)) {
    res.status(400).json({ ok: false, error: "pct must be 25, 50, or 75" });
    return;
  }
  try {
    const result = await bot.triggerManualPartialClose(symbol, pct);
    if (!result.ok) {
      const status = result.error === "No open position" ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    publishEvent({
      type:    "position:update",
      payload: { action: "partial_close", symbol, pct, closeQty: result.closeQty, remainingQty: result.remainingQty },
      ts:      new Date().toISOString(),
    });
    res.json({ ok: true, symbol, pct, closeQty: result.closeQty, remainingQty: result.remainingQty });
  } catch (e) {
    logger.error({ err: e, symbol, pct }, "positions: close-partial failed");
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/positions/:symbol/modify-tpsl ──────────────────────────────────
// Body: { tpPrice: number, slPrice: number }

router.post("/positions/:symbol/modify-tpsl", async (req: Request, res: Response): Promise<void> => {
  const symbol   = String(req.params["symbol"] ?? "");
  const body     = req.body as { tpPrice?: unknown; slPrice?: unknown };
  const tpPrice  = Number(body.tpPrice);
  const slPrice  = Number(body.slPrice);

  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  if (!Number.isFinite(tpPrice) || tpPrice <= 0) {
    res.status(400).json({ ok: false, error: "tpPrice must be a positive number" }); return;
  }
  if (!Number.isFinite(slPrice) || slPrice <= 0) {
    res.status(400).json({ ok: false, error: "slPrice must be a positive number" }); return;
  }

  try {
    const result = await positionLifecycleManager.modifyTpSl(symbol, tpPrice, slPrice);
    if (!result.ok) {
      const status = result.error === "Position not found" ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    publishEvent({
      type:    "position:update",
      payload: { action: "tpsl_modified", symbol, tpPrice, slPrice },
      ts:      new Date().toISOString(),
    });
    res.json({ ok: true, symbol, tpPrice, slPrice });
  } catch (e) {
    logger.error({ err: e, symbol }, "positions: modify-tpsl failed");
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/positions/:symbol/breakeven ────────────────────────────────────

router.post("/positions/:symbol/breakeven", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "");
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  try {
    const result = await positionLifecycleManager.activateBreakeven(symbol);
    if (!result.ok) {
      const status = result.error === "Position not found" ? 404 : 409;
      res.status(status).json(result);
      return;
    }
    res.json({ ok: true, symbol, action: "breakeven", newStopLoss: result.newStopLoss });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/positions/:symbol/trailing ─────────────────────────────────────
// Body: { enable: boolean }

router.post("/positions/:symbol/trailing", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "");
  const enable = Boolean((req.body as { enable?: boolean })?.enable ?? true);
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  try {
    const result = enable
      ? await positionLifecycleManager.activateTrailing(symbol)
      : await positionLifecycleManager.deactivateTrailing(symbol);
    if (!result.ok) {
      const status = result.error === "Position not found" ? 404 : 409;
      res.status(status).json(result);
      return;
    }
    res.json({ ok: true, symbol, action: enable ? "trailing_on" : "trailing_off" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── POST /api/positions/:symbol/lock-profit ──────────────────────────────────

router.post("/positions/:symbol/lock-profit", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.params["symbol"] ?? "");
  if (!symbol) { res.status(400).json({ ok: false, error: "symbol is required" }); return; }
  try {
    const result = await positionLifecycleManager.lockProfit(symbol);
    if (!result.ok) {
      const status = result.error === "Position not found" ? 404 : 409;
      res.status(status).json(result);
      return;
    }
    res.json({ ok: true, symbol, action: "lock_profit", newStopLoss: result.newStopLoss, tierPct: result.tierPct });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
