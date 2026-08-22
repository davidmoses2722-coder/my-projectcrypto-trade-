/** Phase 15 — Manual Trading Center.
 * Manual orders reuse the existing queue, risk validation and execution pipeline.
 * BUY opens a paper/live LONG (market or limit); SELL closes the active LONG at market.
 * Short-entry execution is intentionally not enabled until the core engine has a
 * first-class short-position model.
 */
import { Router, type Request, type Response } from "express";
import * as bot from "../../lib/bot";
import { publishEvent } from "../../lib/eventBus";

const router = Router();

router.get("/manual-trading/status", (_req: Request, res: Response) => {
  res.json({ ok: true, status: bot.buildStatus(), capabilities: {
    longEntry:       true,
    longExit:        true,
    limitOrders:     true,
    shortEntry:      false,
    note: "Short-entry execution is reserved for the future two-sided position model.",
  }});
});

/**
 * POST /api/manual-trading/order
 *
 * Body (market order — existing):
 *   { symbol, side: "BUY"|"SELL", sizeUsdt, tpPct?, slPct?, strategy? }
 *
 * Body (limit order — new):
 *   { symbol, side: "BUY", orderType: "LIMIT", limitPrice, sizeUsdt, tpPct?, slPct?, strategy? }
 */
router.post("/manual-trading/order", async (req: Request, res: Response): Promise<void> => {
  try {
    const body       = req.body ?? {};
    const symbol     = String(body.symbol     ?? "").trim().toUpperCase();
    const side       = String(body.side       ?? "BUY").toUpperCase();
    const orderType  = String(body.orderType  ?? "MARKET").toUpperCase();
    const sizeUsdt   = Number(body.sizeUsdt);
    const tpPct      = body.tpPct    == null ? undefined : Number(body.tpPct);
    const slPct      = body.slPct    == null ? undefined : Number(body.slPct);
    const strategy   = String(body.strategy   ?? "manual").trim() || "manual";
    const limitPrice = body.limitPrice != null ? Number(body.limitPrice) : undefined;

    // ── Common validation ────────────────────────────────────────────────────
    if (!symbol || !/^[A-Z0-9_/-]+$/.test(symbol)) {
      res.status(400).json({ ok: false, error: "A valid trading symbol is required" }); return;
    }
    if (side !== "BUY" && side !== "SELL") {
      res.status(400).json({ ok: false, error: "Side must be BUY or SELL" }); return;
    }
    if (orderType !== "MARKET" && orderType !== "LIMIT") {
      res.status(400).json({ ok: false, error: "orderType must be MARKET or LIMIT" }); return;
    }
    if (tpPct !== undefined && (!Number.isFinite(tpPct) || tpPct <= 0 || tpPct > 50)) {
      res.status(400).json({ ok: false, error: "TP percentage must be between 0 and 50" }); return;
    }
    if (slPct !== undefined && (!Number.isFinite(slPct) || slPct <= 0 || slPct > 50)) {
      res.status(400).json({ ok: false, error: "SL percentage must be between 0 and 50" }); return;
    }

    // ── SELL always closes at market, regardless of orderType ────────────────
    if (side === "SELL") {
      const result = await bot.triggerManualClose(symbol, "manual_close");
      if (!result.ok) { res.status(400).json(result); return; }
      publishEvent({ type: "position:update", payload: { action: "manual_close", symbol }, ts: new Date().toISOString() });
      res.json({ action: "close", ...result });
      return;
    }

    // ── BUY LIMIT order ──────────────────────────────────────────────────────
    if (orderType === "LIMIT") {
      if (!limitPrice || !Number.isFinite(limitPrice) || limitPrice <= 0) {
        res.status(400).json({ ok: false, error: "A valid limitPrice is required for LIMIT orders" }); return;
      }
      if (!Number.isFinite(sizeUsdt) || sizeUsdt < 5) {
        res.status(400).json({ ok: false, error: "Position size must be at least $5 USDT" }); return;
      }
      const result = await bot.openLimitOrder({ symbol, sizeUsdt, limitPrice, tpPct, slPct, strategy });
      if (!result.ok) { res.status(400).json(result); return; }
      publishEvent({
        type: "order:created",
        payload: { action: "limit_order_placed", symbol, orderId: result.orderId },
        ts: new Date().toISOString(),
      });
      res.json(result);
      return;
    }

    // ── BUY MARKET order (existing path) ─────────────────────────────────────
    if (!Number.isFinite(sizeUsdt) || sizeUsdt < 5) {
      res.status(400).json({ ok: false, error: "Manual entry size must be at least $5 USDT" }); return;
    }
    const result = await bot.openManualPosition({ symbol, sizeUsdt, tpPct, slPct, strategy });
    if (!result.ok) { res.status(400).json(result); return; }
    publishEvent({ type: "position:update", payload: { action: "manual_entry", symbol }, ts: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
