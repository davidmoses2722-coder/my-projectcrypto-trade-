import { pgTable, serial, text, numeric, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * risk_daily_pnl — persists daily P&L across server restarts.
 *
 * One row per UTC calendar day. Upserted on every trade close.
 * On startup, the risk manager reads today's row and restores its counters.
 * If the daily loss limit was already breached, trading is immediately blocked.
 */
export const riskDailyPnlTable = pgTable("risk_daily_pnl", {
  id:           serial("id").primaryKey(),
  bucketDate:   text("bucket_date").notNull().unique(),  // YYYY-MM-DD UTC
  pnlUsd:       numeric("pnl_usd", { precision: 18, scale: 4 }).notNull().default("0"),
  tradeCount:   integer("trade_count").notNull().default(0),
  isHalted:     boolean("is_halted").notNull().default(false),
  haltReason:   text("halt_reason"),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RiskDailyPnl = typeof riskDailyPnlTable.$inferSelect;
