import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  tradesTable,
  botConfigurationsTable,
  performanceHistoryTable,
  apiKeysTable,
  riskDailyPnlTable,
  riskEventsTable,
  systemSettingsTable,
  positionsTable,
  journalEntriesTable,
  type Trade,
  type BotConfiguration,
  type ApiKey,
  type RiskEventType,
  type Position,
  type JournalEntryRow,
} from "@workspace/db";
import { logger } from "./logger";
import { encryptSecret, decryptSecret, maskKey } from "./crypto";

// ─── Trades ──────────────────────────────────────────────────────────────────

export interface PersistTradeInput {
  symbol: string;
  side: "BUY" | "SELL";
  kind: "ENTRY" | "EXIT";
  qty: number;
  price: number;
  notionalUsd: number;
  pnlUsd?: number | null;
  pnlPct?: number | null;
  reason?: string | null;
  isPaper: boolean;
  exchangeOrderId?: string | null;
  raw?: unknown;
}

export async function persistTrade(input: PersistTradeInput): Promise<Trade | null> {
  try {
    const [row] = await db
      .insert(tradesTable)
      .values({
        symbol: input.symbol,
        side: input.side,
        kind: input.kind,
        qty: input.qty.toString(),
        price: input.price.toString(),
        notionalUsd: input.notionalUsd.toString(),
        pnlUsd: input.pnlUsd != null ? input.pnlUsd.toString() : null,
        pnlPct: input.pnlPct != null ? input.pnlPct.toString() : null,
        reason: input.reason ?? null,
        isPaper: input.isPaper,
        exchangeOrderId: input.exchangeOrderId ?? null,
        raw: input.raw ?? null,
      })
      .returning();
    return row ?? null;
  } catch (e) {
    logger.error({ err: e }, "persistTrade failed");
    return null;
  }
}

export async function listTrades(limit = 100): Promise<Trade[]> {
  try {
    return await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.executedAt))
      .limit(limit);
  } catch (e) {
    logger.error({ err: e }, "listTrades failed");
    return [];
  }
}

// ─── Performance history (per UTC day, per symbol) ──────────────────────────

export async function bumpPerformance(
  symbol: string,
  pnlUsd: number,
  isWin: boolean,
): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    // Wrap both operations in a transaction so a failed UPDATE rolls back
    // the preceding INSERT seed, preventing partial performance records.
    await db.transaction(async (tx) => {
      await tx
        .insert(performanceHistoryTable)
        .values({
          bucketDate: today,
          symbol,
          trades: 1,
          wins: isWin ? 1 : 0,
          losses: isWin ? 0 : 1,
          pnlUsd: pnlUsd.toString(),
        })
        .onConflictDoNothing();
      await tx.execute(sql`
        UPDATE performance_history
           SET trades   = trades + 1,
               wins     = wins   + ${isWin ? 1 : 0},
               losses   = losses + ${isWin ? 0 : 1},
               pnl_usd  = pnl_usd + ${pnlUsd.toString()}::numeric,
               updated_at = NOW()
         WHERE bucket_date = ${today}
           AND symbol      = ${symbol}
           AND id IN (
             SELECT id FROM performance_history
              WHERE bucket_date = ${today} AND symbol = ${symbol}
              ORDER BY id DESC LIMIT 1
           )
      `);
    });
  } catch (e) {
    logger.error({ err: e }, "bumpPerformance failed — transaction rolled back");
  }
}

export async function listPerformance(days = 30) {
  try {
    return await db
      .select()
      .from(performanceHistoryTable)
      .orderBy(desc(performanceHistoryTable.bucketDate))
      .limit(days);
  } catch (e) {
    logger.error({ err: e }, "listPerformance failed");
    return [];
  }
}

// ─── Bot configuration (single "default" row) ───────────────────────────────

export async function loadActiveConfig(): Promise<BotConfiguration | null> {
  try {
    const [row] = await db
      .select()
      .from(botConfigurationsTable)
      .where(eq(botConfigurationsTable.name, "default"))
      .limit(1);
    return row ?? null;
  } catch (e) {
    logger.error({ err: e }, "loadActiveConfig failed");
    return null;
  }
}

export interface SaveConfigInput {
  exchange?:            string;
  symbol:               string;
  takeProfit:           number;
  stopLoss:             number;
  tickMs:               number;
  maxDailyLoss:         number;
  orderSizeUsdt:        number;
  testMode:             boolean;
  isActive?:            boolean;
  symbolSelectionMode?: string;
  approvedSymbols?:     string[];
  scanIntervalMinutes?: number;
  minimumMarketScore?:  number;
}

export async function saveConfig(input: SaveConfigInput): Promise<void> {
  try {
    const existing = await loadActiveConfig();
    const approvedJson = input.approvedSymbols !== undefined
      ? JSON.stringify(input.approvedSymbols)
      : undefined;
    if (existing) {
      await db
        .update(botConfigurationsTable)
        .set({
          exchange:            input.exchange ?? existing.exchange,
          symbol:              input.symbol,
          takeProfit:          input.takeProfit.toString(),
          stopLoss:            input.stopLoss.toString(),
          tickMs:              input.tickMs,
          maxDailyLoss:        input.maxDailyLoss.toString(),
          orderSizeUsdt:       input.orderSizeUsdt.toString(),
          testMode:            input.testMode,
          isActive:            input.isActive ?? existing.isActive,
          symbolSelectionMode: input.symbolSelectionMode ?? existing.symbolSelectionMode,
          approvedSymbols:     approvedJson ?? existing.approvedSymbols,
          scanIntervalMinutes: input.scanIntervalMinutes ?? existing.scanIntervalMinutes,
          minimumMarketScore:  input.minimumMarketScore  ?? existing.minimumMarketScore,
          updatedAt:           new Date(),
        })
        .where(eq(botConfigurationsTable.id, existing.id));
    } else {
      await db.insert(botConfigurationsTable).values({
        name:                "default",
        exchange:            input.exchange ?? "gateio",
        symbol:              input.symbol,
        takeProfit:          input.takeProfit.toString(),
        stopLoss:            input.stopLoss.toString(),
        tickMs:              input.tickMs,
        maxDailyLoss:        input.maxDailyLoss.toString(),
        orderSizeUsdt:       input.orderSizeUsdt.toString(),
        testMode:            input.testMode,
        isActive:            input.isActive ?? false,
        symbolSelectionMode: input.symbolSelectionMode ?? "manual",
        approvedSymbols:     approvedJson ?? '["BTC_USDT","ETH_USDT","SOL_USDT","BNB_USDT"]',
        scanIntervalMinutes: input.scanIntervalMinutes ?? 15,
        minimumMarketScore:  input.minimumMarketScore  ?? 67,
      });
    }
  } catch (e) {
    logger.error({ err: e }, "saveConfig failed");
  }
}

// ─── API key vault (encrypted) ──────────────────────────────────────────────

export interface SaveApiKeyInput {
  userId?: number;
  exchange?: string;
  label?: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  isPaper?: boolean;
}

export async function saveApiKey(input: SaveApiKeyInput): Promise<ApiKey | null> {
  try {
    const exchange = input.exchange ?? "gateio";
    // Deactivate previous active keys for this (user, exchange) pair.
    const scope = input.userId
      ? and(eq(apiKeysTable.userId, input.userId), eq(apiKeysTable.exchange, exchange))
      : eq(apiKeysTable.exchange, exchange);
    await db
      .update(apiKeysTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(scope);

    const [row] = await db
      .insert(apiKeysTable)
      .values({
        userId: input.userId ?? null,
        exchange,
        label: input.label ?? null,
        apiKeyEnc: encryptSecret(input.apiKey),
        apiKeyMask: maskKey(input.apiKey),
        apiSecretEnc: encryptSecret(input.apiSecret),
        passphraseEnc: input.passphrase ? encryptSecret(input.passphrase) : null,
        isPaper: input.isPaper ?? true,
        isActive: true,
        lastValidatedAt: new Date(),
      })
      .returning();
    return row ?? null;
  } catch (e) {
    logger.error({ err: e }, "saveApiKey failed");
    return null;
  }
}

export async function loadActiveApiKey(
  exchange = "gateio",
  userId?: number,
): Promise<{
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  isPaper: boolean;
  apiKeyMask: string;
} | null> {
  try {
    const scope = userId
      ? and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.exchange, exchange))
      : eq(apiKeysTable.exchange, exchange);
    const [row] = await db
      .select()
      .from(apiKeysTable)
      .where(scope)
      .orderBy(desc(apiKeysTable.id))
      .limit(1);
    if (!row || !row.isActive) return null;
    return {
      apiKey: decryptSecret(row.apiKeyEnc),
      apiSecret: decryptSecret(row.apiSecretEnc),
      passphrase: row.passphraseEnc ? decryptSecret(row.passphraseEnc) : "",
      isPaper: row.isPaper,
      apiKeyMask: row.apiKeyMask,
    };
  } catch (e) {
    logger.error({ err: e }, "loadActiveApiKey failed");
    return null;
  }
}

// ─── Risk daily PnL persistence ──────────────────────────────────────────────

export interface DailyPnlRow {
  bucketDate: string;
  pnlUsd: number;
  tradeCount: number;
  isHalted: boolean;
  haltReason: string | null;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Load today's PnL row (returns null if no trades have been recorded yet today). */
export async function loadTodayPnl(): Promise<DailyPnlRow | null> {
  try {
    const today = todayUtc();
    const [row] = await db
      .select()
      .from(riskDailyPnlTable)
      .where(eq(riskDailyPnlTable.bucketDate, today))
      .limit(1);
    if (!row) return null;
    return {
      bucketDate: row.bucketDate,
      pnlUsd: Number(row.pnlUsd),
      tradeCount: row.tradeCount,
      isHalted: row.isHalted,
      haltReason: row.haltReason,
    };
  } catch (e) {
    logger.error({ err: e }, "loadTodayPnl failed");
    return null;
  }
}

/** Upsert today's PnL row — called after every trade close and on halt. */
export async function upsertTodayPnl(input: {
  pnlUsd: number;
  tradeCount: number;
  isHalted: boolean;
  haltReason?: string | null;
}): Promise<void> {
  try {
    const today = todayUtc();
    await db
      .insert(riskDailyPnlTable)
      .values({
        bucketDate: today,
        pnlUsd: input.pnlUsd.toString(),
        tradeCount: input.tradeCount,
        isHalted: input.isHalted,
        haltReason: input.haltReason ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: riskDailyPnlTable.bucketDate,
        set: {
          pnlUsd: input.pnlUsd.toString(),
          tradeCount: input.tradeCount,
          isHalted: input.isHalted,
          haltReason: input.haltReason ?? null,
          updatedAt: new Date(),
        },
      });
  } catch (e) {
    logger.error({ err: e }, "upsertTodayPnl failed");
  }
}

// ─── Risk event audit log ─────────────────────────────────────────────────────

export async function logRiskEvent(input: {
  eventType: RiskEventType;
  symbol?: string;
  reason: string;
  pnlUsd?: number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(riskEventsTable).values({
      eventType: input.eventType,
      symbol: input.symbol ?? null,
      reason: input.reason,
      pnlUsd: input.pnlUsd != null ? input.pnlUsd.toString() : null,
      meta: input.meta ?? null,
    });
  } catch (e) {
    logger.error({ err: e }, "logRiskEvent failed");
  }
}

export async function listRiskEvents(limit = 100) {
  try {
    return await db
      .select()
      .from(riskEventsTable)
      .orderBy(desc(riskEventsTable.createdAt))
      .limit(limit);
  } catch (e) {
    logger.error({ err: e }, "listRiskEvents failed");
    return [];
  }
}

// ─── System settings (global kill switch) ────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, key))
      .limit(1);
    return row?.value ?? null;
  } catch (e) {
    logger.error({ err: e, key }, "getSetting failed");
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  try {
    await db
      .insert(systemSettingsTable)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value, updatedAt: new Date() },
      });
  } catch (e) {
    logger.error({ err: e, key, value }, "setSetting failed");
  }
}

/**
 * Read the global kill switch state.
 * Priority: env var TRADING_ENABLED > DB setting > default true.
 * Returns true  = trading is allowed.
 * Returns false = kill switch is ACTIVE — no trades may execute.
 */
export async function isTradingEnabled(): Promise<boolean> {
  // Env var override (fastest — set at deploy time, no DB round trip)
  const envVal = process.env["TRADING_ENABLED"];
  if (envVal !== undefined) {
    return envVal.toLowerCase() !== "false" && envVal !== "0";
  }
  // DB setting (toggleable at runtime)
  const dbVal = await getSetting("trading_enabled");
  if (dbVal !== null) {
    return dbVal.toLowerCase() !== "false" && dbVal !== "0";
  }
  return true; // default: enabled
}

// ─── Positions (current open-position state) ─────────────────────────────────
//
// Distinct from `trades` (append-only closed-fill ledger). This table always
// reflects the platform's current belief about what's open right now, so it
// can be used to restore in-memory state (portfolioRegistry /
// positionLifecycleManager) after a restart. Upserted on every lifecycle
// change (open, SL/TP/trailing/breakeven/profit-lock update, partial close,
// full close) — never appended-only.

export interface PersistPositionInput {
  positionId: string;         // stable id — matches portfolioRegistry position id (orderId)
  symbol: string;
  side?: "long" | "short";
  source: "BOT" | "MANUAL";
  strategy?: string | null;
  entryPrice: number;
  currentPrice?: number | null;
  quantity: number;
  originalQuantity: number;
  sizeUsdt: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  initialStopLoss?: number | null;
  initialTakeProfit?: number | null;
  realizedPnlUsd?: number | null;
  unrealizedPnlUsd?: number | null;
  riskAmountUsd?: number | null;
  trailingActive?: boolean;
  breakevenActive?: boolean;
  lockedProfitPct?: number;
  isPaper: boolean;
  status?: "open" | "closed";
  closeReason?: string | null;
  closedAt?: Date | null;
}

/** Upsert the current state of a position — called on open and every subsequent change. */
export async function upsertPosition(input: PersistPositionInput): Promise<Position | null> {
  try {
    const values = {
      positionId: input.positionId,
      symbol: input.symbol,
      side: input.side ?? "long",
      source: input.source,
      strategy: input.strategy ?? null,
      entryPrice: input.entryPrice.toString(),
      currentPrice: input.currentPrice != null ? input.currentPrice.toString() : null,
      quantity: input.quantity.toString(),
      originalQuantity: input.originalQuantity.toString(),
      sizeUsdt: input.sizeUsdt.toString(),
      stopLoss: input.stopLoss != null ? input.stopLoss.toString() : null,
      takeProfit: input.takeProfit != null ? input.takeProfit.toString() : null,
      initialStopLoss: input.initialStopLoss != null ? input.initialStopLoss.toString() : null,
      initialTakeProfit: input.initialTakeProfit != null ? input.initialTakeProfit.toString() : null,
      realizedPnlUsd: input.realizedPnlUsd != null ? input.realizedPnlUsd.toString() : null,
      unrealizedPnlUsd: input.unrealizedPnlUsd != null ? input.unrealizedPnlUsd.toString() : null,
      riskAmountUsd: input.riskAmountUsd != null ? input.riskAmountUsd.toString() : null,
      trailingActive: input.trailingActive ?? false,
      breakevenActive: input.breakevenActive ?? false,
      lockedProfitPct: input.lockedProfitPct ?? 0,
      isPaper: input.isPaper,
      status: input.status ?? "open",
      closeReason: input.closeReason ?? null,
      closedAt: input.closedAt ?? null,
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(positionsTable)
      .values(values)
      .onConflictDoUpdate({
        target: positionsTable.positionId,
        set: values,
      })
      .returning();
    return row ?? null;
  } catch (e) {
    logger.error({ err: e, positionId: input.positionId }, "upsertPosition failed");
    return null;
  }
}

/** All positions currently marked open — used for boot-time restoration. */
export async function listOpenPositions(): Promise<Position[]> {
  try {
    return await db
      .select()
      .from(positionsTable)
      .where(eq(positionsTable.status, "open"));
  } catch (e) {
    logger.error({ err: e }, "listOpenPositions failed");
    return [];
  }
}

export async function getPositionById(positionId: string): Promise<Position | null> {
  try {
    const [row] = await db
      .select()
      .from(positionsTable)
      .where(eq(positionsTable.positionId, positionId))
      .limit(1);
    return row ?? null;
  } catch (e) {
    logger.error({ err: e, positionId }, "getPositionById failed");
    return null;
  }
}

/** Mark a position row closed. Idempotent — safe to call even if already closed. */
export async function closePositionRecord(
  positionId: string,
  input: { realizedPnlUsd: number; closeReason: string; finalPrice?: number },
): Promise<void> {
  try {
    await db
      .update(positionsTable)
      .set({
        status: "closed",
        realizedPnlUsd: input.realizedPnlUsd.toString(),
        currentPrice: input.finalPrice != null ? input.finalPrice.toString() : undefined,
        closeReason: input.closeReason,
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(positionsTable.positionId, positionId));
  } catch (e) {
    logger.error({ err: e, positionId }, "closePositionRecord failed");
  }
}

// ─── Trade journal persistence ────────────────────────────────────────────────
//
// TradeJournalService (lib/tradeJournal.ts) keeps a synchronous in-memory Map
// as its source of truth within a running process — these functions are a
// write-through layer so journal history survives a restart instead of being
// silently wiped, matching the pattern already used for `positions`.

export interface PersistJournalEntryInput {
  entryId: string; tradeId: string; symbol: string; strategyId: string; strategyName: string;
  side: "buy" | "sell"; entryPrice: number; exitPrice: number | null;
  pnlUsd: number | null; pnlPct: number | null; marketRegime: string; reasoning: string;
  confidence: number; tags: string[]; notes: string; status: "open" | "closed" | "cancelled";
  entryTime: string; exitTime: string | null;
}

/** Upsert one journal entry — called on create/update/close so the DB always mirrors current state. */
export async function upsertJournalEntry(input: PersistJournalEntryInput): Promise<void> {
  try {
    const values = {
      entryId: input.entryId, tradeId: input.tradeId, symbol: input.symbol,
      strategyId: input.strategyId, strategyName: input.strategyName, side: input.side,
      entryPrice: input.entryPrice.toString(),
      exitPrice: input.exitPrice != null ? input.exitPrice.toString() : null,
      pnlUsd: input.pnlUsd != null ? input.pnlUsd.toString() : null,
      pnlPct: input.pnlPct != null ? input.pnlPct.toString() : null,
      marketRegime: input.marketRegime, reasoning: input.reasoning, confidence: input.confidence,
      tags: input.tags, notes: input.notes, status: input.status,
      entryTime: input.entryTime, exitTime: input.exitTime, updatedAt: new Date(),
    };
    await db
      .insert(journalEntriesTable)
      .values(values)
      .onConflictDoUpdate({ target: journalEntriesTable.entryId, set: values });
  } catch (e) {
    logger.error({ err: e, entryId: input.entryId }, "upsertJournalEntry failed (non-fatal)");
  }
}

export async function deleteJournalEntryRecord(entryId: string): Promise<void> {
  try {
    await db.delete(journalEntriesTable).where(eq(journalEntriesTable.entryId, entryId));
  } catch (e) {
    logger.error({ err: e, entryId }, "deleteJournalEntryRecord failed");
  }
}

/** All persisted journal entries — used to rehydrate the in-memory service on boot. */
export async function listJournalEntries(): Promise<JournalEntryRow[]> {
  try {
    return await db.select().from(journalEntriesTable).orderBy(desc(journalEntriesTable.createdAt)).limit(2000);
  } catch (e) {
    logger.error({ err: e }, "listJournalEntries failed");
    return [];
  }
}
