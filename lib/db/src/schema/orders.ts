import { pgTable, serial, integer, text, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * orders — lifecycle record for every order submitted through the platform.
 *
 * Distinct from `trades` (an append-only fill ledger):
 *   • orders tracks the ORDER lifecycle (pending → open → filled/cancelled/rejected)
 *   • trades tracks individual fills (ENTRY/EXIT rows) — what actually transacted
 *
 * Market orders are recorded here immediately and transition to "filled" once
 * the BullMQ worker confirms execution.
 *
 * Limit orders start as "open" (or "pending" for paper while waiting for price
 * to cross), remain until filled or cancelled, and emit SSE events at each step.
 */
export const ordersTable = pgTable("orders", {
  id:                serial("id").primaryKey(),
  orderId:           text("order_id").notNull().unique(),           // stable internal UUID
  clientOrderId:     text("client_order_id"),                       // caller-supplied idempotency key
  positionId:        text("position_id"),                           // links to positions.position_id once filled

  userId:            integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  symbol:            text("symbol").notNull(),
  side:              text("side",      { enum: ["BUY", "SELL"] }).notNull(),
  orderType:         text("order_type",{ enum: ["MARKET","LIMIT"] }).notNull().default("MARKET"),
  limitPrice:        numeric("limit_price",          { precision: 24, scale: 10 }),
  quantity:          numeric("quantity",             { precision: 24, scale: 10 }).notNull(),
  filledQuantity:    numeric("filled_quantity",      { precision: 24, scale: 10 }).notNull().default("0"),
  remainingQuantity: numeric("remaining_quantity",   { precision: 24, scale: 10 }).notNull(),
  averageFillPrice:  numeric("average_fill_price",   { precision: 24, scale: 10 }),

  status: text("status", {
    enum: ["pending","open","partially_filled","filled","cancelled","rejected","failed"],
  }).notNull().default("open"),

  source:          text("source",   { enum: ["BOT","MANUAL"] }).notNull().default("MANUAL"),
  exchange:        text("exchange").notNull().default("gateio"),
  exchangeOrderId: text("exchange_order_id"),   // null for paper orders until placed
  isPaper:         boolean("is_paper").notNull().default(true),

  /** Percentage values stored for limit-fill lifecycle (e.g. 2.0 = 2%) */
  tpPct:    numeric("tp_pct",  { precision: 10, scale: 4 }),
  slPct:    numeric("sl_pct",  { precision: 10, scale: 4 }),
  strategy: text("strategy"),

  errorMessage: text("error_message"),

  // ── Futures-only fields (Phase 2) ────────────────────────────────────────
  // Nullable/defaulted — the existing spot order flow never sets these.
  market: text("market", { enum: ["spot", "futures"] }).notNull().default("spot"),
  positionSide: text("position_side", { enum: ["long", "short"] }),
  leverage: integer("leverage"),
  marginMode: text("margin_mode", { enum: ["isolated", "cross"] }),
  reduceOnly: boolean("reduce_only").notNull().default(false),
  triggerPrice: numeric("trigger_price", { precision: 24, scale: 10 }),

  createdAt:   timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at",   { withTimezone: true }).notNull().defaultNow(),
  filledAt:    timestamp("filled_at",    { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
