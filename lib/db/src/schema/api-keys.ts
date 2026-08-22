import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  exchange: text("exchange").notNull().default("okx"),
  label: text("label"),
  apiKeyEnc: text("api_key_enc").notNull(),
  apiKeyMask: text("api_key_mask").notNull(),
  apiSecretEnc: text("api_secret_enc").notNull(),
  passphraseEnc: text("passphrase_enc"),
  isPaper: boolean("is_paper").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;
