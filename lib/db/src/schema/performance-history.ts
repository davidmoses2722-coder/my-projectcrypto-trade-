import { pgTable, serial, integer, text, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const performanceHistoryTable = pgTable("performance_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  bucketDate: date("bucket_date").notNull(),
  symbol: text("symbol").notNull().default("BTCUSDT"),
  trades: integer("trades").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  pnlUsd: numeric("pnl_usd", { precision: 18, scale: 4 }).notNull().default("0"),
  startBalance: numeric("start_balance", { precision: 18, scale: 4 }),
  endBalance: numeric("end_balance", { precision: 18, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPerformanceHistorySchema = createInsertSchema(performanceHistoryTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPerformanceHistory = z.infer<typeof insertPerformanceHistorySchema>;
export type PerformanceHistory = typeof performanceHistoryTable.$inferSelect;
