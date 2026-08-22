import { pgTable, serial, integer, text, timestamp, numeric, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const backtestsTable = pgTable("backtests", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  strategy:       text("strategy").notNull(),
  symbol:         text("symbol").notNull(),
  timeframe:      text("timeframe").notNull().default("1h"),
  startDate:      text("start_date").notNull(),
  endDate:        text("end_date").notNull(),
  initialBalance: numeric("initial_balance", { precision: 18, scale: 4 }).notNull(),
  finalBalance:   numeric("final_balance",   { precision: 18, scale: 4 }),
  tradingFeesPct: numeric("trading_fees_pct", { precision: 8, scale: 4 }).notNull().default("0.1"),
  slippagePct:    numeric("slippage_pct",     { precision: 8, scale: 4 }).notNull().default("0.05"),
  riskProfile:    text("risk_profile").notNull().default("medium"),
  positionSizing: boolean("position_sizing").notNull().default(true),
  status:         text("status", { enum: ["running", "completed", "failed"] }).notNull().default("running"),
  metrics:        jsonb("metrics"),
  charts:         jsonb("charts"),
  trades:         jsonb("trades"),
  errorMessage:   text("error_message"),
  durationMs:     integer("duration_ms"),
  candlesUsed:    integer("candles_used"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:    timestamp("completed_at", { withTimezone: true }),
});

export const insertBacktestSchema = createInsertSchema(backtestsTable).omit({ id: true, createdAt: true });
export type InsertBacktest = z.infer<typeof insertBacktestSchema>;
export type Backtest       = typeof backtestsTable.$inferSelect;
