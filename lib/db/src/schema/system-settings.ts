import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * system_settings — key/value store for runtime operational flags.
 *
 * Global kill switch:
 *   key = "trading_enabled"   value = "true" | "false"
 *
 * Reading order (first match wins):
 *   1. TRADING_ENABLED env var  (fastest, set at deploy time)
 *   2. system_settings row       (toggleable at runtime via API)
 *   3. Default: trading ENABLED
 */
export const systemSettingsTable = pgTable("system_settings", {
  key:       text("key").primaryKey(),
  value:     text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SystemSetting = typeof systemSettingsTable.$inferSelect;
