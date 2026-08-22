/**
 * tradeJournal.ts — Phase 9.1 Trade Journal System
 *
 * Stores per-trade journal entries with context: market regime, strategy,
 * PnL, reasoning, confidence. The in-memory Map is the synchronous source of
 * truth within a running process (callers expect an immediate return value),
 * with every mutation also written through to the `journal_entries` table
 * and the whole set rehydrated from it on boot via hydrate() — so entries
 * now genuinely survive a restart instead of being silently wiped.
 */

import { logger } from "./logger";
import * as store from "./store";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JournalEntry {
  id:            string;
  tradeId:       string;
  symbol:        string;
  strategyId:    string;
  strategyName:  string;
  side:          "buy" | "sell";
  entryPrice:    number;
  exitPrice:     number | null;
  pnlUsd:        number | null;
  pnlPct:        number | null;
  marketRegime:  string;
  reasoning:     string;       // why the trade was taken
  confidence:    number;       // 0-100
  tags:          string[];
  notes:         string;
  status:        "open" | "closed" | "cancelled";
  entryTime:     string;
  exitTime:      string | null;
  createdAt:     string;
  updatedAt:     string;
}

export interface JournalSearchParams {
  strategyId?:  string;
  regime?:      string;
  status?:      "open" | "closed" | "cancelled";
  symbol?:      string;
  tag?:         string;
  minPnl?:      number;
  maxPnl?:      number;
  from?:        string;   // ISO date
  to?:          string;
  limit?:       number;
  offset?:      number;
}

export interface JournalStats {
  totalEntries:  number;
  openEntries:   number;
  closedEntries: number;
  winCount:      number;
  lossCount:     number;
  avgConfidence: number;
  topRegimes:    Array<{ regime: string; count: number }>;
  topStrategies: Array<{ strategyId: string; count: number }>;
}

// ─── Service class ────────────────────────────────────────────────────────────

class TradeJournalService {
  private entries = new Map<string, JournalEntry>();
  private nextId  = 1;

  private toPersistInput(entry: JournalEntry): store.PersistJournalEntryInput {
    const { id, ...rest } = entry;
    return { entryId: id, ...rest };
  }

  /** Create a new journal entry */
  create(data: Omit<JournalEntry, "id" | "createdAt" | "updatedAt">): JournalEntry {
    const id    = `jrn_${Date.now()}_${this.nextId++}`;
    const entry: JournalEntry = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(id, entry);
    logger.info({ id, tradeId: data.tradeId, symbol: data.symbol }, "TradeJournal: entry created");
    void store.upsertJournalEntry(this.toPersistInput(entry));
    return entry;
  }

  /** Update an existing entry (e.g., add exit data, notes) */
  update(id: string, patch: Partial<JournalEntry>): JournalEntry | null {
    const existing = this.entries.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    this.entries.set(id, updated);
    void store.upsertJournalEntry(this.toPersistInput(updated));
    return updated;
  }

  /** Mark entry as closed when trade closes */
  closeEntry(tradeId: string, exitData: { exitPrice: number; pnlUsd: number; pnlPct: number; exitTime: string }): void {
    for (const [id, entry] of this.entries) {
      if (entry.tradeId === tradeId && entry.status === "open") {
        const updated: JournalEntry = {
          ...entry,
          ...exitData,
          status:    "closed",
          updatedAt: new Date().toISOString(),
        };
        this.entries.set(id, updated);
        void store.upsertJournalEntry(this.toPersistInput(updated));
        logger.info({ id, tradeId, pnlUsd: exitData.pnlUsd }, "TradeJournal: entry closed");
        break;
      }
    }
  }

  /** Search entries */
  search(params: JournalSearchParams = {}): JournalEntry[] {
    let results = Array.from(this.entries.values());

    if (params.strategyId) results = results.filter((e) => e.strategyId === params.strategyId);
    if (params.regime)     results = results.filter((e) => e.marketRegime === params.regime);
    if (params.status)     results = results.filter((e) => e.status === params.status);
    if (params.symbol)     results = results.filter((e) => e.symbol.toLowerCase().includes(params.symbol!.toLowerCase()));
    if (params.tag)        results = results.filter((e) => e.tags.includes(params.tag!));
    if (params.minPnl != null) results = results.filter((e) => (e.pnlUsd ?? 0) >= params.minPnl!);
    if (params.maxPnl != null) results = results.filter((e) => (e.pnlUsd ?? 0) <= params.maxPnl!);
    if (params.from)       results = results.filter((e) => e.entryTime >= params.from!);
    if (params.to)         results = results.filter((e) => e.entryTime <= params.to!);

    // Sort newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const offset = params.offset ?? 0;
    const limit  = params.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  getById(id: string): JournalEntry | null { return this.entries.get(id) ?? null; }

  delete(id: string): boolean {
    if (!this.entries.has(id)) return false;
    this.entries.delete(id);
    void store.deleteJournalEntryRecord(id);
    return true;
  }

  /** Restore all persisted entries into the in-memory Map — call once at boot. */
  async hydrate(): Promise<void> {
    try {
      const rows = await store.listJournalEntries();
      for (const row of rows) {
        this.entries.set(row.entryId, {
          id: row.entryId,
          tradeId: row.tradeId,
          symbol: row.symbol,
          strategyId: row.strategyId,
          strategyName: row.strategyName,
          side: row.side,
          entryPrice: Number(row.entryPrice),
          exitPrice: row.exitPrice != null ? Number(row.exitPrice) : null,
          pnlUsd: row.pnlUsd != null ? Number(row.pnlUsd) : null,
          pnlPct: row.pnlPct != null ? Number(row.pnlPct) : null,
          marketRegime: row.marketRegime,
          reasoning: row.reasoning,
          confidence: row.confidence,
          tags: row.tags ?? [],
          notes: row.notes,
          status: row.status,
          entryTime: row.entryTime,
          exitTime: row.exitTime,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        });
      }
      // Keep nextId ahead of anything restored so newly created ids can't collide.
      this.nextId = rows.length + 1;
      logger.info({ count: rows.length }, "TradeJournal: hydrated from persistence");
    } catch (e) {
      logger.error({ err: e }, "TradeJournal: hydrate failed — starting with empty journal");
    }
  }

  /** Aggregate statistics */
  getStats(): JournalStats {
    const all     = Array.from(this.entries.values());
    const closed  = all.filter((e) => e.status === "closed");
    const regMap  = new Map<string, number>();
    const stratMap = new Map<string, number>();

    for (const e of all) {
      regMap.set(e.marketRegime, (regMap.get(e.marketRegime) ?? 0) + 1);
      stratMap.set(e.strategyId, (stratMap.get(e.strategyId) ?? 0) + 1);
    }

    return {
      totalEntries:  all.length,
      openEntries:   all.filter((e) => e.status === "open").length,
      closedEntries: closed.length,
      winCount:      closed.filter((e) => (e.pnlUsd ?? 0) > 0).length,
      lossCount:     closed.filter((e) => (e.pnlUsd ?? 0) <= 0).length,
      avgConfidence: all.length > 0 ? Math.round(all.reduce((s, e) => s + e.confidence, 0) / all.length) : 0,
      topRegimes:    Array.from(regMap.entries()).map(([regime, count]) => ({ regime, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      topStrategies: Array.from(stratMap.entries()).map(([strategyId, count]) => ({ strategyId, count })).sort((a, b) => b.count - a.count),
    };
  }

  getAll(): JournalEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const tradeJournal = new TradeJournalService();
