/**
 * opportunityScanner.ts — Phase 8.7 Trade Opportunity Scanner (dual mode)
 *
 * Scans ALL approved symbols (APPROVED_SYMBOLS from ActiveSwingStrategy) with
 * ActiveSwingStrategy (4h candles). Each symbol yields trend, signal strength,
 * confidence, and long/short direction. Always ranks the strongest opportunity
 * first, across both directions.
 *
 * Results are cached for 5 minutes to avoid hammering Gate.io.
 * A single concurrent scan lock prevents duplicate fetches.
 */

import ccxt                from "ccxt";
import { logger }          from "../lib/logger";
import { resolveStrategy } from "./strategies/index";
import { toDisplaySymbol } from "../shared/symbolUtils";
import { APPROVED_SYMBOLS } from "./strategies/ActiveSwingStrategy";

// ─── Config ───────────────────────────────────────────────────────────────────

// Phase 8.7: scan every approved symbol (was a separately-maintained list that
// had drifted from ActiveSwingStrategy's APPROVED_SYMBOLS).
const SCAN_SYMBOLS = APPROVED_SYMBOLS;

const TIMEFRAME      = "4h";
const CANDLE_COUNT   = 260;   // 200 (EMA200) + 60 buffer
const CACHE_TTL_MS   = 5 * 60 * 1000;  // 5 min cache

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpportunityResult {
  symbol:          string;    // Gate.io format: BTC_USDT
  displaySymbol:   string;    // CCXT/UI format: BTC/USDT
  strategy:        string;
  conditionsMet:   number;
  conditionsTotal: number;
  readinessScore:  number;    // 0–100 (conditions / total * 100)
  isReady:         boolean;   // strategy emitted BUY or SHORT
  confidence:      number;    // 0–100 (from strategy)
  action:          "BUY" | "SHORT" | "HOLD";
  direction:       "LONG" | "SHORT" | null;  // Phase 8.7 — trend/entry direction
  trendBullish:    boolean | null;
  rsi:             number | null;
  lastPrice:       number;
  blockReason:     string | null;
  missingConditions: string[] | null;
  reason:          string;
  scannedAt:       string;
}

interface ScanCache {
  results:   OpportunityResult[];
  scannedAt: number;
  scanning:  boolean;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache: ScanCache = { results: [], scannedAt: 0, scanning: false };

// ─── Candle fetcher ───────────────────────────────────────────────────────────

interface RawCandle {
  timestamp: number;
  open: number; high: number; low: number; close: number; volume: number;
}

async function fetchCandles(symbol: string): Promise<RawCandle[]> {
  const ex      = new ccxt.gate({ enableRateLimit: true });
  const ccxtSym = toDisplaySymbol(symbol);  // BTC/USDT
  const raw     = await ex.fetchOHLCV(ccxtSym, TIMEFRAME, undefined, CANDLE_COUNT);
  return raw.map(c => ({
    timestamp: c[0]!, open: c[1]!, high: c[2]!,
    low: c[3]!, close: c[4]!, volume: c[5]!,
  }));
}

// ─── Condition extractor ──────────────────────────────────────────────────────
// Parse "N/5" from signal reason string

function parseConditionsMet(reason: string): number {
  const m = reason.match(/(\d+)\/5/);
  return m ? parseInt(m[1]!, 10) : 0;
}

// ─── Public getters ───────────────────────────────────────────────────────────

export function getOpportunities(): {
  results:   OpportunityResult[];
  scannedAt: string;
  ageMs:     number;
  scanning:  boolean;
  ready:     number;
  total:     number;
} {
  const age = Date.now() - cache.scannedAt;
  return {
    results:   cache.results,
    scannedAt: cache.scannedAt > 0 ? new Date(cache.scannedAt).toISOString() : "",
    ageMs:     age,
    scanning:  cache.scanning,
    ready:     cache.results.filter(r => r.isReady).length,
    total:     cache.results.length,
  };
}

/** Phase 8.7 — strongest opportunity overall, either direction. */
export function getTopOpportunity(): OpportunityResult | null {
  return cache.results[0] ?? null;
}

/** Phase 8.7 — top N LONG opportunities, ranked by conditionsMet/confidence. */
export function getTopLongOpportunities(n = 3): OpportunityResult[] {
  return cache.results.filter(r => r.direction === "LONG").slice(0, n);
}

/** Phase 8.7 — top N SHORT opportunities, ranked by conditionsMet/confidence. */
export function getTopShortOpportunities(n = 3): OpportunityResult[] {
  return cache.results.filter(r => r.direction === "SHORT").slice(0, n);
}

export function getOpportunitiesForTelegram(): string {
  const { results, scannedAt, ageMs } = getOpportunities();
  if (results.length === 0) return "No scan data — run /opportunities first.";

  const ageMin = Math.round(ageMs / 60_000);

  const fmtLine = (r: OpportunityResult) => {
    const bar   = "█".repeat(r.conditionsMet) + "░".repeat(r.conditionsTotal - r.conditionsMet);
    const dir   = r.direction === "SHORT" ? "🔴" : "🟢";
    const ready = r.isReady ? ` 🚀 ${r.action}` : "";
    return (
      `${dir} <code>${r.displaySymbol.padEnd(9)}</code> ` +
      `${bar} ${r.conditionsMet}/${r.conditionsTotal} · Conf ${r.confidence}%` +
      (r.rsi != null ? ` · RSI ${r.rsi.toFixed(0)}` : "") +
      ready
    );
  };

  const topLongs  = getTopLongOpportunities(5);
  const topShorts = getTopShortOpportunities(5);
  const top       = getTopOpportunity();

  const sections: string[] = [];

  if (top) {
    sections.push(
      `⭐ <b>Strongest Opportunity:</b> ${top.displaySymbol} — ${top.direction ?? "?"} ` +
      `(${top.conditionsMet}/${top.conditionsTotal}, ${top.confidence}% confidence)`,
    );
  }

  sections.push(
    `\n🟢 <b>Top Long Opportunities</b>\n` +
    (topLongs.length ? topLongs.map(fmtLine).join("\n") : "<i>None currently in LONG mode.</i>"),
  );

  sections.push(
    `\n🔴 <b>Top Short Opportunities</b>\n` +
    (topShorts.length ? topShorts.map(fmtLine).join("\n") : "<i>None currently in SHORT mode.</i>"),
  );

  const readySyms = results.filter(r => r.isReady).map(r => `${r.displaySymbol} (${r.action})`).join(", ");

  return (
    `🔭 <b>Trade Opportunities — Active Swing (4h, ${results.length} symbols)</b>\n\n` +
    sections.join("\n") + "\n\n" +
    (readySyms ? `🚀 <b>Ready to trade:</b> ${readySyms}\n` : `⏳ <i>No symbols ready right now.</i>\n`) +
    `<i>Scanned ${scannedAt ? new Date(scannedAt).toUTCString() : "—"} (${ageMin}m ago)</i>`
  );
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

export async function runOpportunityScanner(): Promise<OpportunityResult[]> {
  // Return cached if fresh
  if (cache.scannedAt > 0 && Date.now() - cache.scannedAt < CACHE_TTL_MS && !cache.scanning) {
    return cache.results;
  }

  // Lock to prevent concurrent scans
  if (cache.scanning) {
    logger.info("[OpportunityScanner] Already scanning — returning cached");
    return cache.results;
  }

  cache.scanning = true;
  logger.info("[OpportunityScanner] Starting scan across 10 symbols (4h candles)…");

  const strategy = resolveStrategy("active-swing");
  const results:  OpportunityResult[] = [];

  for (const symbol of SCAN_SYMBOLS) {
    try {
      const candles = await fetchCandles(symbol);

      if (candles.length < 202) {
        logger.warn(`[OpportunityScanner] ${symbol}: only ${candles.length} candles (need 202)`);
        continue;
      }

      const lastPrice = candles[candles.length - 1]!.close;

      const sig = strategy.fn({
        candles: candles.map(c => ({
          time:   c.timestamp,
          open:   c.open,
          high:   c.high,
          low:    c.low,
          close:  c.close,
          volume: c.volume,
        })),
        currentPrice:    lastPrice,
        dailyTradeCount: 0,  // scanner ignores caps
      });

      const conditionsMet  = sig.conditionsMet ?? parseConditionsMet(sig.reason ?? "");
      const trendBullish   = sig.ema50 != null && sig.ema200 != null
        ? sig.ema50 > sig.ema200
        : null;
      const readinessScore = Math.round((conditionsMet / 5) * 100);
      const direction: "LONG" | "SHORT" | null = sig.mode ?? (trendBullish != null ? (trendBullish ? "LONG" : "SHORT") : null);

      results.push({
        symbol,
        displaySymbol:   toDisplaySymbol(symbol),
        strategy:        "active-swing",
        conditionsMet,
        conditionsTotal: 5,
        readinessScore,
        isReady:         (sig.action === "BUY" || sig.action === "SHORT") && sig.canTrade,
        confidence:      sig.confidence,
        action:          sig.action === "BUY" ? "BUY" : sig.action === "SHORT" ? "SHORT" : "HOLD",
        direction,
        trendBullish,
        rsi:             sig.rsi,
        lastPrice,
        blockReason:     sig.blockReason ?? null,
        missingConditions: sig.missingConditions ?? null,
        reason:          sig.reason ?? "",
        scannedAt:       new Date().toISOString(),
      });

      logger.info(
        `[OpportunityScanner] ${symbol}: ${conditionsMet}/5 conditions [${direction ?? "?"}]` +
        (sig.action === "BUY" || sig.action === "SHORT" ? ` → READY (${sig.action})` : ""),
      );

      // Small delay between symbols to respect rate limits
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      logger.warn({ err }, `[OpportunityScanner] Error scanning ${symbol}`);
    }
  }

  // Sort: READY first, then by conditionsMet desc, then readinessScore
  results.sort((a, b) => {
    if (a.isReady !== b.isReady) return a.isReady ? -1 : 1;
    if (b.conditionsMet !== a.conditionsMet) return b.conditionsMet - a.conditionsMet;
    return b.readinessScore - a.readinessScore;
  });

  const readyCount = results.filter(r => r.isReady).length;
  logger.info(
    `[OpportunityScanner] Complete: ${results.length} symbols scanned, ${readyCount} ready`,
  );

  cache = { results, scannedAt: Date.now(), scanning: false };
  return results;
}
