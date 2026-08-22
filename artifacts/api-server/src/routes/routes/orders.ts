/**
 * orders.ts — Order lifecycle API.
 *
 * GET  /api/orders              — list open orders (pending/open/partially_filled)
 * GET  /api/orders/history      — list closed orders (filled/cancelled/rejected/failed)
 * DELETE /api/orders/:orderId   — cancel a resting limit order
 *
 * All routes require JWT authentication (applied in index.ts via requireAuth).
 */

import { Router, type Request, type Response } from "express";
import {
  listOpenOrders,
  listAllOrders,
  getOrderById,
  cancelOrder,
  updateOrder,
} from "../../services/ordersService";
import { connect as connectExchange, toCcxtSymbol } from "../../services/tradeService";
import { getBotExchangeCreds, getBotIsRunning } from "../../lib/bot";
import { publishEvent } from "../../lib/eventBus";
import { logger } from "../../lib/logger";

const router = Router();

// ── GET /api/orders ──────────────────────────────────────────────────────────

router.get("/orders", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as Request & { user?: { uid: number } }).user?.uid;
    const orders = await listOpenOrders(userId);
    res.json({ ok: true, orders });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /api/orders/history ───────────────────────────────────────────────────

router.get("/orders/history", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as Request & { user?: { uid: number } }).user?.uid;
    const limit  = Math.min(500, Math.max(1, Number(req.query["limit"] ?? 100)));
    const orders = await listAllOrders(userId, limit);
    res.json({ ok: true, orders });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── DELETE /api/orders/:orderId ───────────────────────────────────────────────
//
// Cancels a resting limit order. For live orders, sends cancel to exchange first.
// For paper orders, just marks cancelled in DB.

router.delete("/orders/:orderId", async (req: Request, res: Response): Promise<void> => {
  const { orderId } = req.params as { orderId: string };
  if (!orderId) { res.status(400).json({ ok: false, error: "orderId is required" }); return; }

  try {
    const order = await getOrderById(orderId);
    if (!order) { res.status(404).json({ ok: false, error: "Order not found" }); return; }

    const terminal = ["filled","cancelled","rejected","failed"] as string[];
    if (terminal.includes(order.status)) {
      res.status(409).json({ ok: false, error: `Order is already ${order.status}` });
      return;
    }

    // For live orders with an exchange order ID: cancel on exchange first
    if (!order.isPaper && order.exchangeOrderId) {
      try {
        const creds = getBotExchangeCreds();
        const ex    = connectExchange(creds);
        await ex.cancelOrder(order.exchangeOrderId, toCcxtSymbol(order.symbol));
        logger.info(
          { orderId, exchangeOrderId: order.exchangeOrderId, symbol: order.symbol },
          "orders: live order cancelled on exchange",
        );
      } catch (exErr) {
        // Exchange cancel may throw if already filled — surface the error
        const msg = exErr instanceof Error ? exErr.message : String(exErr);
        // If the exchange says it's already filled/doesn't exist, refuse to cancel
        if (/already filled|not found|no such order/i.test(msg)) {
          res.status(409).json({ ok: false, error: `Exchange says order is already resolved: ${msg}` });
          return;
        }
        logger.warn({ err: exErr, orderId }, "orders: exchange cancel failed — marking cancelled anyway");
      }
    }

    const result = await cancelOrder(orderId);
    if (!result.ok) { res.status(409).json(result); return; }

    publishEvent({
      type:    "order:update",
      payload: { action: "cancelled", orderId, symbol: order.symbol },
      ts:      new Date().toISOString(),
    });

    res.json({ ok: true, orderId, status: "cancelled" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
