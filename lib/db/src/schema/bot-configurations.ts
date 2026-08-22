import { pgTable, serial, integer, text, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const botConfigurationsTable = pgTable("bot_configurations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("default"),
  exchange: text("exchange").notNull().default("okx"),
  symbol: text("symbol").notNull().default("BTCUSDT"),
  takeProfit: numeric("take_profit", { precision: 8, scale: 6 }).notNull().default("0.01"),
  stopLoss: numeric("stop_loss", { precision: 8, scale: 6 }).notNull().default("0.009"),
  tickMs: integer("tick_ms").notNull().default(5000),
  maxDailyLoss: numeric("max_daily_loss", { precision: 12, scale: 4 }).notNull().default("-50"),
  orderSizeUsdt: numeric("order_size_usdt", { precision: 12, scale: 4 }).notNull().default("25"),
  testMode: boolean("test_mode").notNull().default(true),
  isActive: boolean("is_active").notNull().default(false),
  // ── Symbol selection (manual / auto) ────────────────────────────────────
  symbolSelectionMode: text("symbol_selection_mode").notNull().default("manual"),
  manualSymbol:        text("manual_symbol"),
  approvedSymbols:     text("approved_symbols").notNull().default('["BTC_USDT","ETH_USDT","SOL_USDT","BNB_USDT"]'),
  scanIntervalMinutes: integer("scan_interval_minutes").notNull().default(15),
  minimumMarketScore:  integer("minimum_market_score").notNull().default(75),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBotConfigurationSchema = createInsertSchema(botConfigurationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBotConfiguration = z.infer<typeof insertBotConfigurationSchema>;
export type BotConfiguration = typeof botConfigurationsTable.$inferSelect;
