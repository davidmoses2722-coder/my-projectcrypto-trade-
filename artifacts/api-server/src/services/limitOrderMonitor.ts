/**
 * limitOrderMonitor — asynchronous fill-detection for resting limit orders.
 *
 * Design constraints (from the spec):
 *   • Do NOT block a BullMQ worker waiting for a limit order to fill.
 *   • Use proper async order lifecycle (poll, not block).
 *   • Paper orders: compare current market price against limit price.
 *   • Live orders: poll the exchange via ccxt fetchOrder.
 *
 * On fill the monitor:
 *   1. Updates the orders table.
 *   2. Calls the registered fill callback (same path as market-order entry).
 *   3. Emits SSE order:filled event.
 *   4. Telegram notification (non-fatal if fails).
 */

import { logger } from "../lib/logger";
import {
  listOpenLimitOrders,
  updateOrder,
  type Order,
} from "./ordersService";
import { connect as connectExchange, toCcxtSymbol } from "./tradeService";
import type { ExchangeCreds } from "./tradeService";
import { publishEvent } from "../lib/eventBus";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LimitFillResult {
  orderId:        string;
  symbol:         string;
  side:           "BUY" | "SELL";
  fillPrice:      number;
  fillQty:        number;
  tpPct:          number;
  slPct:          number;
  strategy:       string;
  isPaper:        boolean;
  exchangeOrderId:string;
  userId:         number;
  correlationId:  string;
  source:         "BOT" | "MANUAL";
}

type FillCallback = (result: LimitFillResult) => void;

// ── Internal state ────────────────────────────────────────────────────────────

let _timer:       ReturnType<typeof setInterval> | null = null;
let _fillCb:      FillCallback | null = null;
let _getCreds:    (() => ExchangeCreds) | null = null;
let _getPrice:    ((symbol: string) => number) | null = null;

const POLL_INTERVAL_MS = 10_000;   // 10 s — fast enough for paper simulation, gentle on exchange
const MIN_FILL_AGE_MS  = 1_000;    // ignore orders created < 1 s ago (avoid instant ghost fills)

// ── Public API ────────────────────────────────────────────────────────────────

export function startLimitOrderMonitor(
  onFill:   FillCallback,
  getCreds: () => ExchangeCreds,
  getPrice: (symbol: string) => number,
): void {
  if (_timer) return;
  _fillCb   = onFill;
  _getCreds = getCreds;
  _getPrice = getPrice;
  _timer = setInterval(() => { void pollOpenOrders(); }, POLL_INTERVAL_MS);
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "limitOrderMonitor: started");
}

export function stopLimitOrderMonitor(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
  logger.info("limitOrderMonitor: stopped");
}

// ── Core polling loop ─────────────────────────────────────────────────────────

async function pollOpenOrders(): Promise<void> {
  try {
    const orders = await listOpenLimitOrders();
    if (!orders.length) return;

    await Promise.allSettled(orders.map(checkOrder));
  } catch (e) {
    logger.warn({ err: e }, "limitOrderMonitor: poll error (non-fatal)");
  }
}

async function checkOrder(order: Order): Promise<void> {
  const ageMs = Date.now() - new Date(order.createdAt).getTime();
  if (ageMs < MIN_FILL_AGE_MS) return;

  try {
    if (order.isPaper) {
      await checkPaperOrder(order);
    } else {
      await checkLiveOrder(order);
    }
  } catch (e) {
    logger.warn({ err: e, orderId: order.orderId }, "limitOrderMonitor: order check failed (non-fatal)");
  }
}

// ── Paper order fill detection ─────────────────────────────────────────────────

async function checkPaperOrder(order: Order): Promise<void> {
  const limitPrice  = Number(order.limitPrice);
  if (!limitPrice || limitPrice <= 0) return;

  const symbol     = order.symbol;
  const marketPrice = _getPrice?.(symbol) ?? 0;
  if (!marketPrice || marketPrice <= 0) return;

  const shouldFill =
    order.side === "BUY"
      ? marketPrice <= limitPrice   // buy limit fills when price drops to limit
      : marketPrice >= limitPrice;  // sell limit fills when price rises to limit

  if (!shouldFill) return;

  const fillPrice = order.side === "BUY"
    ? Math.min(marketPrice, limitPrice)   // filled at limit or better
    : Math.max(marketPrice, limitPrice);

  const qty = Number(order.quantity);
  logger.info(
    { orderId: order.orderId, symbol, side: order.side, limitPrice, marketPrice, fillPrice },
    "limitOrderMonitor: PAPER limit order filled",
  );

  await markFilled(order, fillPrice, qty);
}

// ── Live order fill detection ──────────────────────────────────────────────────

async function checkLiveOrder(order: Order): Promise<void> {
  if (!order.exchangeOrderId) return;
  const creds = _getCreds?.();
  if (!creds) return;

  try {
    const ex = connectExchange(creds);
    const o  = await ex.fetchOrder(order.exchangeOrderId, toCcxtSymbol(order.symbol));
    const st = (o.status ?? "").toLowerCase();

    if (st === "closed" || st === "filled") {
      const fillPrice = o.average ?? o.price ?? Number(order.limitPrice);
      const fillQty   = o.filled  ?? Number(order.quantity);
      if (fillPrice > 0 && fillQty > 0) {
        await markFilled(order, fillPrice, fillQty);
      }
    } else if (st === "canceled" || st === "cancelled" || st === "rejected") {
      await updateOrder(order.orderId, {
        status:      st === "rejected" ? "rejected" : "cancelled",
        cancelledAt: new Date(),
      });
      emitOrderEvent(order.orderId, order.symbol, st === "rejected" ? "rejected" : "cancelled");
    }
  } catch (e) {
    logger.debug({ err: e, orderId: order.orderId }, "limitOrderMonitor: fetchOrder transient error");
  }
}

// ── Mark filled + fire callback ────────────────────────────────────────────────

async function markFilled(order: Order, fillPrice: number, fillQty: number): Promise<void> {
  await updateOrder(order.orderId, {
    status:          "filled",
    filledQuantity:  fillQty,
    remainingQuantity: 0,
    averageFillPrice: fillPrice,
    filledAt:        new Date(),
  });

  emitOrderEvent(order.orderId, order.symbol, "filled", { fillPrice, fillQty });

  if (_fillCb) {
    _fillCb({
      orderId:         order.orderId,
      symbol:          order.symbol,
      side:            order.side as "BUY" | "SELL",
      fillPrice,
      fillQty,
      tpPct:           Number(order.tpPct ?? 2),
      slPct:           Number(order.slPct ?? 1.2),
      strategy:        order.strategy ?? "manual",
      isPaper:         order.isPaper,
      exchangeOrderId: order.exchangeOrderId ?? order.orderId,
      userId:          order.userId ?? 0,
      correlationId:   `limit-fill-${order.orderId}`,
      source:          order.source === "BOT" ? "BOT" : "MANUAL",
    });
  }
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function emitOrderEvent(orderId: string, symbol: string, action: string, extra?: Record<string, unknown>): void {
  publishEvent({
    type:    "order:update",
    payload: { orderId, symbol, action, ...extra },
    ts:      new Date().toISOString(),
  });
}
