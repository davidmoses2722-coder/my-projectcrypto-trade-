import { pgTable, serial, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketScansTable = pgTable("market_scans", {
  id:           serial("id").primaryKey(),
  symbol:       text("symbol").notNull(),
  ema50:        numeric("ema50",         { precision: 20, scale: 8 }),
  ema200:       numeric("ema200",        { precision: 20, scale: 8 }),
  rsi:          numeric("rsi",           { precision: 8,  scale: 4 }),
  adx:          numeric("adx",           { precision: 8,  scale: 4 }),
  atr:          numeric("atr",           { precision: 20, scale: 8 }),
  atrPct:       numeric("atr_pct",       { precision: 10, scale: 6 }),
  volumeRatio:  numeric("volume_ratio",  { precision: 8,  scale: 4 }),
  spreadPct:    numeric("spread_pct",    { precision: 10, scale: 6 }),
  bbWidth:      numeric("bb_width",      { precision: 10, scale: 6 }),
  regime:       text("regime"),
  score:        integer("score").notNull().default(0),
  selected:     boolean("selected").notNull().default(false),
  rejected:     boolean("rejected").notNull().default(false),
  rejectReason: text("reject_reason"),
  scannedAt:    timestamp("scanned_at",  { withTimezone: true }).notNull().defaultNow(),
});

export const insertMarketScanSchema = createInsertSchema(marketScansTable).omit({ id: true });
export type InsertMarketScan = z.infer<typeof insertMarketScanSchema>;
export type MarketScan = typeof marketScansTable.$inferSelect;
