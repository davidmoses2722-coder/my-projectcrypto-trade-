/**
 * trading-params routes — Phase 13 Configuration Authority
 *
 * GET  /api/trading-params/config   → current full config
 * POST /api/trading-params/config   → patch config (syncs risk manager + emits SSE event)
 */

import { Router, type Request, type Response } from "express";
import { tradingParamsService } from "../../lib/tradingParamsService";
import { riskManager } from "../../lib/riskManager";
import { publishEvent } from "../../lib/eventBus";

const router = Router();

// GET /api/trading-params/config
router.get("/trading-params/config", (_req: Request, res: Response) => {
  res.json({ ok: true, config: tradingParamsService.getConfig() });
});

// POST /api/trading-params/config
router.post("/trading-params/config", (req: Request, res: Response) => {
  try {
    const patch   = req.body as Parameters<typeof tradingParamsService.updateConfig>[0];
    const updated = tradingParamsService.updateConfig(patch);

    // ── Sync trade execution controls to riskManager ──────────────────────
    const riskPatch: Record<string, number> = {};
    if (patch.maxOpenPositions !== undefined) riskPatch.maxOpenPositions = updated.maxOpenPositions;
    if (patch.maxDailyLossUsd  !== undefined) riskPatch.maxDailyLossUsd  = updated.maxDailyLossUsd;
    if (patch.maxTradesPerDay  !== undefined) riskPatch.maxTradesPerDay  = updated.maxTradesPerDay;
    if (patch.tradeCooldownMs  !== undefined) riskPatch.tradeCooldownMs  = updated.tradeCooldownMs;
    if (Object.keys(riskPatch).length > 0) {
      riskManager.updateConfig(riskPatch);
    }

    // ── Broadcast config update to all SSE clients ────────────────────────
    publishEvent({
      type:    "config:update",
      payload: { config: updated as unknown as Record<string, unknown>, changedFields: Object.keys(patch) },
      ts:      new Date().toISOString(),
    });

    res.json({ ok: true, config: updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
