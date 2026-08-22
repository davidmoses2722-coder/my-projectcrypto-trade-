import { pgTable, serial, integer, text, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * positions — CURRENT position state (open or just-closed), one row per position.
 *
 * This is distinct from `trades`, which is an append-only ledger of individual
 * fills (ENTRY/EXIT rows). `positions` instead represents "what does the platform
 * currently believe is open right now" and is the source used to restore
 * portfolioRegistry / positionLifecycleManager state after a server restart.
 *
 * Row lifecycle:
 *   INSERT on entry fill (status="open")
 *   UPDATE on every SL/TP/trailing/breakeven/profit-lock/partial-close change
 *   UPDATE to status="closed" (+ closedAt, realizedPnlUsd) on full close
 *
 * positionId (not symbol) is the stable identity — mirrors portfolioRegistry's
 * existing id-keyed design so multiple concurrent positions are representable.
 */
export const positionsTable = pgTable("positions", {
  id: serial("id").primaryKey(),
  positionId: text("position_id").notNull().unique(),     // matches portfolioRegistry PortfolioPosition.id (orderId)
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  symbol: text("symbol").notNull(),
  side: text("side", { enum: ["long", "short"] }).notNull().default("long"),
  source: text("source", { enum: ["BOT", "MANUAL"] }).notNull().default("BOT"),
  strategy: text("strategy"),

  entryPrice: numeric("entry_price", { precision: 24, scale: 10 }).notNull(),
  currentPrice: numeric("current_price", { precision: 24, scale: 10 }),
  quantity: numeric("quantity", { precision: 24, scale: 10 }).notNull(),
  originalQuantity: numeric("original_quantity", { precision: 24, scale: 10 }).notNull(),
  sizeUsdt: numeric("size_usdt", { precision: 18, scale: 4 }).notNull(),

  stopLoss: numeric("stop_loss", { precision: 24, scale: 10 }),
  takeProfit: numeric("take_profit", { precision: 24, scale: 10 }),
  initialStopLoss: numeric("initial_stop_loss", { precision: 24, scale: 10 }),
  initialTakeProfit: numeric("initial_take_profit", { precision: 24, scale: 10 }),

  realizedPnlUsd: numeric("realized_pnl_usd", { precision: 18, scale: 4 }),
  unrealizedPnlUsd: numeric("unrealized_pnl_usd", { precision: 18, scale: 4 }),
  riskAmountUsd: numeric("risk_amount_usd", { precision: 18, scale: 4 }),

  trailingActive: boolean("trailing_active").notNull().default(false),
  breakevenActive: boolean("breakeven_active").notNull().default(false),
  lockedProfitPct: integer("locked_profit_pct").notNull().default(0),

  isPaper: boolean("is_paper").notNull().default(true),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  closeReason: text("close_reason"),

  // ── Futures-only fields (Phase 2) ────────────────────────────────────────
  // All nullable/defaulted so the existing spot engine (lib/bot.ts) never
  // reads or writes them — spot rows simply leave these at their defaults.
  market: text("market", { enum: ["spot", "futures"] }).notNull().default("spot"),
  leverage: integer("leverage"),
  marginMode: text("margin_mode", { enum: ["isolated", "cross"] }),
  marginUsd: numeric("margin_usd", { precision: 18, scale: 4 }),
  liquidationPrice: numeric("liquidation_price", { precision: 24, scale: 10 }),
  markPrice: numeric("mark_price", { precision: 24, scale: 10 }),
  fundingPaidUsd: numeric("funding_paid_usd", { precision: 18, scale: 4 }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const insertPositionSchema = createInsertSchema(positionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Position = typeof positionsTable.$inferSelect;
