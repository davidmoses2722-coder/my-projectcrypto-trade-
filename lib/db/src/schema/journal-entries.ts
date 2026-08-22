import { pgTable, serial, text, timestamp, numeric, integer, jsonb } from "drizzle-orm/pg-core";

/**
 * journal_entries — persisted mirror of the in-memory TradeJournalService.
 *
 * The service (lib/tradeJournal.ts) keeps a synchronous in-memory Map as the
 * source of truth for the current process (bot.ts calls .create()/.closeEntry()
 * and expects an immediate return value, not a Promise) — this table is a
 * write-through persistence layer: every mutation is also written here
 * (fire-and-forget), and on boot the in-memory Map is rehydrated from this
 * table so a restart no longer silently wipes journal history.
 */
export const journalEntriesTable = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  entryId: text("entry_id").notNull().unique(),   // matches JournalEntry.id (jrn_...)
  tradeId: text("trade_id").notNull(),
  symbol: text("symbol").notNull(),
  strategyId: text("strategy_id").notNull(),
  strategyName: text("strategy_name").notNull(),
  side: text("side", { enum: ["buy", "sell"] }).notNull(),
  entryPrice: numeric("entry_price", { precision: 24, scale: 10 }).notNull(),
  exitPrice: numeric("exit_price", { precision: 24, scale: 10 }),
  pnlUsd: numeric("pnl_usd", { precision: 18, scale: 4 }),
  pnlPct: numeric("pnl_pct", { precision: 10, scale: 4 }),
  marketRegime: text("market_regime").notNull().default(""),
  reasoning: text("reasoning").notNull().default(""),
  confidence: integer("confidence").notNull().default(0),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  status: text("status", { enum: ["open", "closed", "cancelled"] }).notNull().default("open"),
  entryTime: text("entry_time").notNull(),
  exitTime: text("exit_time"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JournalEntryRow = typeof journalEntriesTable.$inferSelect;
