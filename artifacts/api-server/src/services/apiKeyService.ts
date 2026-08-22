import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { apiKeysTable, type ApiKey } from "@workspace/db/schema";
import { encrypt, decrypt, maskKey } from "../lib/crypto";
import { logger } from "../lib/logger";

/**
 * apiKeyService — the ONLY module that handles plaintext exchange API keys.
 *
 *   • saveApiKeys(...)      → encrypt + persist (deactivates prior keys for that exchange/user)
 *   • getDecryptedKeys(...) → load + decrypt (called only inside the backend, never sent to clients)
 *   • listMaskedKeys(...)   → safe summary for UI
 *   • deleteApiKeys(...)    → revoke
 *
 * Plaintext key material NEVER leaves this module's return values to anything
 * that touches an HTTP response. Routes must call `listMaskedKeys` to expose
 * status to the frontend.
 */

export type ExchangeId = "gateio";

export interface SaveOptions {
  passphrase?: string; // required for OKX
  isPaper?: boolean;
  label?: string;
}

export interface DecryptedKeys {
  apiKey: string;
  apiSecret: string;
  passphrase: string; // empty string when not set
  isPaper: boolean;
  apiKeyMask: string;
}

export interface MaskedKeySummary {
  exchange: string;
  hasKeys: boolean;
  apiKeyMask: string;
  hasPassphrase: boolean;
  isPaper: boolean;
  isActive: boolean;
  label: string | null;
  createdAt: string | null;
}

function emptySummary(exchange: string): MaskedKeySummary {
  return {
    exchange,
    hasKeys: false,
    apiKeyMask: "",
    hasPassphrase: false,
    isPaper: true,
    isActive: false,
    label: null,
    createdAt: null,
  };
}

/**
 * Encrypt and persist API credentials for (userId, exchange).
 * Any previously stored row for the same (userId, exchange) is deactivated
 * so only the latest row is "active".
 */
export async function saveApiKeys(
  userId: number,
  exchange: ExchangeId,
  apiKey: string,
  secret: string,
  options: SaveOptions = {},
): Promise<{ ok: true; data: MaskedKeySummary } | { ok: false; error: string }> {
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, error: "Valid userId is required" };
  }
  if (!apiKey || !secret) {
    return { ok: false, error: "apiKey and secret are required" };
  }
  

  try {
    // Deactivate previous active rows for this (user, exchange).
    await db
      .update(apiKeysTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.exchange, exchange)));

    const [row] = await db
      .insert(apiKeysTable)
      .values({
        userId,
        exchange,
        label: options.label ?? null,
        apiKeyEnc: encrypt(apiKey),
        apiKeyMask: maskKey(apiKey),
        apiSecretEnc: encrypt(secret),
        passphraseEnc: options.passphrase ? encrypt(options.passphrase) : null,
        isPaper: options.isPaper ?? true,
        isActive: true,
        lastValidatedAt: new Date(),
      })
      .returning();

    if (!row) return { ok: false, error: "Failed to persist credentials" };

    logger.info(
      { userId, exchange, apiKeyMask: row.apiKeyMask, isPaper: row.isPaper },
      "apiKeyService.saveApiKeys",
    );
    return { ok: true, data: rowToSummary(row) };
  } catch (e) {
    logger.error({ err: e, userId, exchange }, "apiKeyService.saveApiKeys failed");
    return { ok: false, error: "Failed to save credentials" };
  }
}

/**
 * Load and decrypt the latest active credentials for (userId, exchange).
 * Returns null if no usable keys are stored.
 *
 * IMPORTANT: callers must NEVER include the returned object in an HTTP
 * response, log it, or persist it. Use only inside trade-execution paths.
 */
export async function getDecryptedKeys(
  userId: number,
  exchange: ExchangeId,
): Promise<DecryptedKeys | null> {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  try {
    // Access control: this WHERE clause is the only path to plaintext keys.
    // The userId predicate combined with the unique (userId, exchange) lookup
    // guarantees a user can only ever decrypt rows they own.
    const [row] = await db
      .select()
      .from(apiKeysTable)
      .where(and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.exchange, exchange)))
      .orderBy(desc(apiKeysTable.id))
      .limit(1);
    if (!row || !row.isActive) return null;
    if (row.userId !== userId) {
      // Defense in depth: refuse if the row's owner doesn't match the caller
      // (should be impossible given the WHERE clause, but we audit-log it).
      logger.error(
        { callerUserId: userId, rowUserId: row.userId, exchange, rowId: row.id },
        "apiKeyService.getDecryptedKeys: ownership mismatch — DENIED",
      );
      return null;
    }

    const decrypted: DecryptedKeys = {
      apiKey: decrypt(row.apiKeyEnc),
      apiSecret: decrypt(row.apiSecretEnc),
      passphrase: row.passphraseEnc ? decrypt(row.passphraseEnc) : "",
      isPaper: row.isPaper,
      apiKeyMask: row.apiKeyMask,
    };
    // Audit log: record every decryption WITHOUT exposing key material.
    logger.info(
      {
        action: "apiKey.decrypt",
        userId,
        exchange,
        rowId: row.id,
        apiKeyMask: row.apiKeyMask,
        isPaper: row.isPaper,
        hasPassphrase: Boolean(row.passphraseEnc),
      },
      "API key decrypted for trading operation",
    );
    return decrypted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isKeyRotation = /integrity check|bad mac|authentication tag/i.test(msg);
    if (isKeyRotation) {
      // Ciphertext was encrypted with a different ENCRYPTION_KEY (key rotation).
      // Treat as "no usable keys" so the user is prompted to re-enter credentials.
      logger.warn(
        { userId, exchange },
        "apiKeyService.getDecryptedKeys: decryption failed — key rotation detected. User must re-enter API keys.",
      );
    } else {
      logger.error({ err: e, userId, exchange }, "apiKeyService.getDecryptedKeys failed");
    }
    return null;
  }
}

/** Safe-to-expose summary for a single (userId, exchange). */
export async function getMaskedSummary(
  userId: number,
  exchange: ExchangeId,
): Promise<MaskedKeySummary> {
  if (!Number.isInteger(userId) || userId <= 0) return emptySummary(exchange);
  try {
    const [row] = await db
      .select()
      .from(apiKeysTable)
      .where(and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.exchange, exchange)))
      .orderBy(desc(apiKeysTable.id))
      .limit(1);
    if (!row) return emptySummary(exchange);
    return rowToSummary(row);
  } catch (e) {
    logger.error({ err: e, userId, exchange }, "apiKeyService.getMaskedSummary failed");
    return emptySummary(exchange);
  }
}

/** Safe summaries for every active row a user owns. */
export async function listMaskedKeys(userId: number): Promise<MaskedKeySummary[]> {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  try {
    const rows = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.userId, userId))
      .orderBy(desc(apiKeysTable.id));
    return rows.map(rowToSummary);
  } catch (e) {
    logger.error({ err: e, userId }, "apiKeyService.listMaskedKeys failed");
    return [];
  }
}

/** Hard-revoke all stored keys for (userId, exchange). */
export async function deleteApiKeys(
  userId: number,
  exchange: ExchangeId,
): Promise<{ ok: boolean; deleted: number }> {
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, deleted: 0 };
  try {
    const result = await db
      .delete(apiKeysTable)
      .where(and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.exchange, exchange)))
      .returning({ id: apiKeysTable.id });
    return { ok: true, deleted: result.length };
  } catch (e) {
    logger.error({ err: e, userId, exchange }, "apiKeyService.deleteApiKeys failed");
    return { ok: false, deleted: 0 };
  }
}

function rowToSummary(row: ApiKey): MaskedKeySummary {
  return {
    exchange: row.exchange,
    hasKeys: Boolean(row.apiKeyEnc && row.apiSecretEnc),
    apiKeyMask: row.apiKeyMask,
    hasPassphrase: Boolean(row.passphraseEnc),
    isPaper: row.isPaper,
    isActive: row.isActive,
    label: row.label ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}
