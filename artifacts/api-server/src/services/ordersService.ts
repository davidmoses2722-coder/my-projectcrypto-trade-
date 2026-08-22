/**
 * ordersService — CRUD for the orders table.
 *
 * All order mutations go through here. The service is the single source of
 * truth for order state; it never talks to the exchange directly.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db, ordersTable, type Order } from "@workspace/db";
export type { Order };
import { logger } from "../lib/logger";
import { randomUUID } from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderStatus =
  | "pending" | "open" | "partially_filled"
  | "filled" | "cancelled" | "rejected" | "failed";

export interface CreateOrderInput {
  userId:        number;
  symbol:        string;
  side:          "BUY" | "SELL";
  orderType:     "MARKET" | "LIMIT";
  limitPrice?:   number;
  quantity:      number;
  source?:       "BOT" | "MANUAL";
  exchange?:     string;
  exchangeOrderId?: string;
  isPaper:       boolean;
  tpPct?:        number;
  slPct?:        number;
  strategy?:     string;
  clientOrderId?: string;
  status?:       OrderStatus;
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput): Promise<Order | null> {
  try {
    const orderId = randomUUID();
    const qty = input.quantity.toString();
    const [row] = await db.insert(ordersTable).values({
      orderId,
      clientOrderId:     input.clientOrderId ?? null,
      userId:            input.userId,
      symbol:            input.symbol.toUpperCase(),
      side:              input.side,
      orderType:         input.orderType,
      limitPrice:        input.limitPrice != null ? input.limitPrice.toString() : null,
      quantity:          qty,
      filledQuantity:    "0",
      remainingQuantity: qty,
      averageFillPrice:  null,
      status:            input.status ?? (input.orderType === "LIMIT" ? "open" : "pending"),
      source:            input.source ?? "MANUAL",
      exchange:          input.exchange ?? "gateio",
      exchangeOrderId:   input.exchangeOrderId ?? null,
      isPaper:           input.isPaper,
      tpPct:             input.tpPct != null ? input.tpPct.toString() : null,
      slPct:             input.slPct != null ? input.slPct.toString() : null,
      strategy:          input.strategy ?? null,
    }).returning();
    return row ?? null;
  } catch (e) {
    logger.error({ err: e }, "ordersService.createOrder failed");
    return null;
  }
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateOrder(
  orderId: string,
  patch: Partial<{
    status:           OrderStatus;
    filledQuantity:   number;
    remainingQuantity:number;
    averageFillPrice: number;
    exchangeOrderId:  string;
    positionId:       string;
    errorMessage:     string;
    filledAt:         Date;
    cancelledAt:      Date;
  }>,
): Promise<Order | null> {
  try {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status            != null) values["status"]            = patch.status;
    if (patch.filledQuantity    != null) values["filledQuantity"]    = patch.filledQuantity.toString();
    if (patch.remainingQuantity != null) values["remainingQuantity"] = patch.remainingQuantity.toString();
    if (patch.averageFillPrice  != null) values["averageFillPrice"]  = patch.averageFillPrice.toString();
    if (patch.exchangeOrderId   != null) values["exchangeOrderId"]   = patch.exchangeOrderId;
    if (patch.positionId        != null) values["positionId"]        = patch.positionId;
    if (patch.errorMessage      != null) values["errorMessage"]      = patch.errorMessage;
    if (patch.filledAt          != null) values["filledAt"]          = patch.filledAt;
    if (patch.cancelledAt       != null) values["cancelledAt"]       = patch.cancelledAt;

    const [row] = await db
      .update(ordersTable)
      .set(values as Partial<typeof ordersTable.$inferInsert>)
      .where(eq(ordersTable.orderId, orderId))
      .returning();
    return row ?? null;
  } catch (e) {
    logger.error({ err: e, orderId }, "ordersService.updateOrder failed");
    return null;
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getOrderById(orderId: string): Promise<Order | null> {
  try {
    const [row] = await db.select().from(ordersTable).where(eq(ordersTable.orderId, orderId));
    return row ?? null;
  } catch (e) {
    logger.error({ err: e }, "ordersService.getOrderById failed");
    return null;
  }
}

export async function listOpenOrders(userId?: number): Promise<Order[]> {
  try {
    const conditions = inArray(ordersTable.status, ["pending","open","partially_filled"]);
    const rows = userId != null
      ? await db.select().from(ordersTable)
          .where(and(conditions, eq(ordersTable.userId, userId)))
          .orderBy(desc(ordersTable.createdAt))
      : await db.select().from(ordersTable)
          .where(conditions)
          .orderBy(desc(ordersTable.createdAt));
    return rows;
  } catch (e) {
    logger.error({ err: e }, "ordersService.listOpenOrders failed");
    return [];
  }
}

export async function listAllOrders(userId?: number, limit = 100): Promise<Order[]> {
  try {
    const rows = userId != null
      ? await db.select().from(ordersTable)
          .where(eq(ordersTable.userId, userId))
          .orderBy(desc(ordersTable.createdAt))
          .limit(limit)
      : await db.select().from(ordersTable)
          .orderBy(desc(ordersTable.createdAt))
          .limit(limit);
    return rows;
  } catch (e) {
    logger.error({ err: e }, "ordersService.listAllOrders failed");
    return [];
  }
}

/** Open limit orders eligible for fill-detection polling. */
export async function listOpenLimitOrders(): Promise<Order[]> {
  try {
    return await db.select().from(ordersTable)
      .where(and(
        eq(ordersTable.orderType, "LIMIT"),
        inArray(ordersTable.status, ["open","partially_filled"]),
      ))
      .orderBy(desc(ordersTable.createdAt));
  } catch (e) {
    logger.error({ err: e }, "ordersService.listOpenLimitOrders failed");
    return [];
  }
}

// ── Cancellation ──────────────────────────────────────────────────────────────

export interface CancelResult {
  ok:     boolean;
  error?: string;
}

export async function cancelOrder(orderId: string): Promise<CancelResult> {
  const order = await getOrderById(orderId);
  if (!order) return { ok: false, error: "Order not found" };

  const terminal: OrderStatus[] = ["filled","cancelled","rejected","failed"];
  if (terminal.includes(order.status as OrderStatus)) {
    return { ok: false, error: `Order is already ${order.status} — cannot cancel` };
  }

  await updateOrder(orderId, {
    status:      "cancelled",
    cancelledAt: new Date(),
  });
  return { ok: true };
}
