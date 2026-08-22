import { pgTable, serial, integer, text, timestamp, numeric, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  exchange: text("exchange").notNull().default("okx"),
  symbol: text("symbol").notNull(),
  side: text("side", { enum: ["BUY", "SELL"] }).notNull(),
  kind: text("kind", { enum: ["ENTRY", "EXIT"] }).notNull(),
  qty: numeric("qty", { precision: 24, scale: 10 }).notNull(),
  price: numeric("price", { precision: 24, scale: 10 }).notNull(),
  notionalUsd: numeric("notional_usd", { precision: 18, scale: 4 }).notNull(),
  pnlUsd: numeric("pnl_usd", { precision: 18, scale: 4 }),
  pnlPct: numeric("pnl_pct", { precision: 12, scale: 6 }),
  reason: text("reason"),
  isPaper: boolean("is_paper").notNull().default(true),
  exchangeOrderId: text("exchange_order_id"),
  raw: jsonb("raw"),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({
  id: true,
  executedAt: true,
});
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
