import { pgTable, serial, text, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * risk_events — append-only audit log for every risk action.
 *
 * Every blocked trade, SL/TP trigger, daily limit hit, halt/resume, and
 * kill-switch activation is written here for post-incident analysis.
 */
export const riskEventsTable = pgTable("risk_events", {
  id:        serial("id").primaryKey(),
  eventType: text("event_type", {
    enum: [
      "TRADE_BLOCKED",    // validateTrade() rejected an entry
      "SL_TRIGGERED",     // stop-loss price hit → position closed
      "TP_TRIGGERED",     // take-profit price hit → position closed
      "DAILY_LIMIT",      // daily loss limit breached → halt
      "KILL_SWITCH",      // global kill switch is active
      "MANUAL_HALT",      // operator triggered force-halt
      "HALT_CLEARED",     // halt was cleared, trading resumed
      "RISK_OVERRIDE",    // operator changed risk config at runtime
    ],
  }).notNull(),
  symbol:    text("symbol"),
  reason:    text("reason").notNull(),
  pnlUsd:    numeric("pnl_usd", { precision: 18, scale: 4 }),
  meta:      jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RiskEvent    = typeof riskEventsTable.$inferSelect;
export type RiskEventType = RiskEvent["eventType"];
