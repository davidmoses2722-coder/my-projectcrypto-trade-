import { logger } from "./logger";
import { notify } from "./telegramNotifier";
import * as exchangeService from "../services/exchangeService";
import { resolveStrategy } from "../services/strategies/index";
import { portfolioRegistry } from "./portfolioRegistry";
import { advancedRiskEngine } from "./advancedRiskEngine";
import { enqueueTradeEntry } from "../queues/tradeQueue";
import {
  pushLog,
  getBotActiveStrategy,
  getBotActiveEngine,
  getBotStopLossPct,
  getBotTakeProfitPct,
  getBotOrderSizeUsdt,
  getBotBalanceUsdt,
  getBotIsRunning,
  getBotHasKeys,
  getBotOwnerUserId,
  getBotExchangeCreds,
  getBotCandleBar,
} from "./bot";
import { tradingParamsService } from "./tradingParamsService";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCAN_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT",
];

const SCAN_INTERVAL_MS = 30_000;
const CANDLE_LIMIT     = 210;
const CANDLE_TTL_MS    = 60_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanResult {
  symbol:           string;
  price:            number;
  signal:           "BUY" | "SELL" | "SHORT" | "HOLD" | null;
  confidence:       number;
  canTrade:         boolean;
  blockReason:      string | null;
  portfolioAllowed: boolean;
  portfolioReason:  string | null;
  riskAllowed:      boolean;
  riskReason:       string | null;
  enqueued:         boolean;
  lastScannedAt:    number;
  error:            string | null;
}

// ─── Per-symbol candle cache ──────────────────────────────────────────────────

interface CandleEntry {
  candles:   { time: number; open: number; high: number; low: number; close: number; volume: number; volUsdt: number }[];
  fetchedAt: number;
}

const candleCache = new Map<string, CandleEntry>();

async function fetchCandlesForSymbol(symbol: string, bar: string): Promise<CandleEntry["candles"]> {
  const now    = Date.now();
  const cached = candleCache.get(symbol);
  if (cached && now - cached.fetchedAt < CANDLE_TTL_MS && cached.candles.length > 0) {
    return cached.candles;
  }
  try {
    const fresh = await exchangeService.getOHLCV(symbol, bar, CANDLE_LIMIT);
    if (fresh.length >= 20) {
      const candles = fresh.map((c) => ({
        time:    c.timestamp,
        open:    c.open,
        high:    c.high,
        low:     c.low,
        close:   c.close,
        volume:  c.volume,
        volUsdt: 0,
      }));
      candleCache.set(symbol, { candles, fetchedAt: now });
      return candles;
    }
  } catch (e) {
    logger.warn({ err: e, symbol }, "multiSymbolScanner: candle fetch failed");
  }
  return cached?.candles ?? [];
}

// ─── Scan state ───────────────────────────────────────────────────────────────

const scanResults = new Map<string, ScanResult>();
let scannerRunning = false;
let scanHandle: ReturnType<typeof setTimeout> | null = null;
let scanCount = 0;

// ─── Per-symbol scan ──────────────────────────────────────────────────────────

async function scanSymbol(symbol: string): Promise<ScanResult> {
  const base: ScanResult = {
    symbol,
    price:            0,
    signal:           null,
    confidence:       0,
    canTrade:         false,
    blockReason:      null,
    portfolioAllowed: false,
    portfolioReason:  null,
    riskAllowed:      false,
    riskReason:       null,
    enqueued:         false,
    lastScannedAt:    Date.now(),
    error:            null,
  };

  try {
    // 1. Ticker
    const ticker = await exchangeService.getTicker(symbol);
    if (!ticker) return { ...base, error: "No ticker data" };
    base.price = ticker.last;

    // 2. OHLCV candles (cached per symbol)
    const bar     = getBotCandleBar().toLowerCase();
    const candles = await fetchCandlesForSymbol(symbol, bar);
    if (candles.length < 20) return { ...base, error: "Insufficient candle data" };

    // 3. Strategy signal
    const strategyId = getBotActiveStrategy();
    const engine     = resolveStrategy(strategyId);
    const sig        = engine.fn({ candles, currentPrice: ticker.last, dailyTradeCount: 0 });

    base.signal     = sig.action;
    base.confidence = sig.confidence;
    base.canTrade   = sig.canTrade ?? false;
    base.blockReason = sig.blockReason ?? null;

    // Notify BUY signal detected (deduped per symbol, 1-min cooldown)
    if (sig.action === "BUY" && (sig.canTrade ?? false)) {
      notify("SCAN_BUY_SIGNAL", {
        symbol,
        price:      ticker.last,
        confidence: sig.confidence,
      }, symbol);
    }

    // 4. Phase 14 — use the same Trading Params authority as the main bot
    // entry path. The scanner must never silently fall back to the old
    // positionSizingService and ignore Bot Control's fixed size / TP / SL.
    const resolved = tradingParamsService.resolve(ticker.last, {
      strategySlPct:  sig.stopLossPct  ?? undefined,
      strategyTpPct:  sig.takeProfitPct ?? undefined,
      configSlPct:    getBotStopLossPct(),
      configTpPct:    getBotTakeProfitPct(),
      configSizeUsdt: getBotOrderSizeUsdt(),
      atr:            sig.atr ?? undefined,
      balance:        getBotBalanceUsdt(),
    });
    const slPct    = resolved.slPct;
    const tpPct    = resolved.tpPct;
    const sizeUsdt = resolved.sizeUsdt;
    const engineName = getBotActiveEngine();
    const pg         = portfolioRegistry.canOpen(symbol, engineName, sizeUsdt);
    base.portfolioAllowed = pg.allowed;
    base.portfolioReason  = pg.reason ?? null;

    // 5. Advanced risk guard
    const ar         = advancedRiskEngine.canTrade();
    base.riskAllowed = ar.allowed;
    base.riskReason  = ar.reason ?? null;

    // 6. Enqueue if every gate passes and bot is live
    if (
      sig.action === "BUY" &&
      (sig.canTrade ?? false) &&
      pg.allowed &&
      ar.allowed &&
      getBotIsRunning() &&
      getBotHasKeys()
    ) {
      const correlationId = `scanner-${symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // slPct / tpPct / sizeUsdt already computed above via positionSizingService
      const creds  = getBotExchangeCreds();

      await enqueueTradeEntry({
        userId:       getBotOwnerUserId() ?? 0,
        source:       "BOT",
        symbol,
        sizeUsdt,
        balanceFreeUsdt: getBotBalanceUsdt(),
        currentPrice:  ticker.last,
        stopLossPct:   slPct,
        takeProfitPct: tpPct,
        isPaper:       creds.paper ?? false,
        creds,
        correlationId,
      });

      base.enqueued = true;
      notify("SCAN_BUY_ENQUEUED", { symbol, price: ticker.last, sizeUsdt });
      pushLog(
        "info",
        `[Scanner] 🟢 BUY ENQUEUED ${symbol} @ ${ticker.last.toFixed(4)} — ${sig.reason ?? ""}`,
      );
    }

    // Notify if BUY signal was blocked by portfolio or risk engine
    if (
      sig.action === "BUY" &&
      (sig.canTrade ?? false) &&
      getBotIsRunning() &&
      getBotHasKeys() &&
      !base.enqueued
    ) {
      if (!pg.allowed) {
        notify("SCAN_BUY_BLOCKED_PORTFOLIO", {
          symbol, reason: pg.reason ?? "portfolio limit",
        }, `port:${symbol}`);
      } else if (!ar.allowed) {
        notify("SCAN_BUY_BLOCKED_RISK", {
          symbol, reason: ar.reason ?? "risk limit",
        }, `risk:${symbol}`);
      }
    }

    return base;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e, symbol }, "multiSymbolScanner.scanSymbol error");
    return { ...base, error: msg };
  }
}

// ─── Scan loop ────────────────────────────────────────────────────────────────

async function runScan(): Promise<void> {
  if (!scannerRunning) return;
  scanCount++;

  const strategyId = getBotActiveStrategy();
  pushLog("info", `[Scanner] Scan #${scanCount} — ${SCAN_SYMBOLS.length} symbols — strategy: ${strategyId}`);

  const settled = await Promise.allSettled(SCAN_SYMBOLS.map((s) => scanSymbol(s)));

  let buyCount   = 0;
  let errorCount = 0;

  for (let i = 0; i < SCAN_SYMBOLS.length; i++) {
    const sym = SCAN_SYMBOLS[i]!;
    const r   = settled[i]!;
    if (r.status === "fulfilled") {
      scanResults.set(sym, r.value);
      if (r.value.signal === "BUY" && r.value.canTrade) buyCount++;
      if (r.value.error) errorCount++;
    } else {
      scanResults.set(sym, {
        symbol:           sym,
        price:            0,
        signal:           null,
        confidence:       0,
        canTrade:         false,
        blockReason:      null,
        portfolioAllowed: false,
        portfolioReason:  null,
        riskAllowed:      false,
        riskReason:       null,
        enqueued:         false,
        lastScannedAt:    Date.now(),
        error:            String(r.reason),
      });
      errorCount++;
    }
  }

  const buyLine = buyCount > 0 ? ` | 🟢 BUY signals: ${buyCount}` : "";
  const errLine = errorCount > 0 ? ` | ⚠ Errors: ${errorCount}` : "";
  pushLog("info", `[Scanner] Scan #${scanCount} complete${buyLine}${errLine}`);

  if (scannerRunning) {
    scanHandle = setTimeout(() => { void runScan(); }, SCAN_INTERVAL_MS);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function start(): void {
  if (scannerRunning) return;
  scannerRunning = true;
  scanCount = 0;
  pushLog("info", `[Scanner] Started — watching ${SCAN_SYMBOLS.join(", ")} every ${SCAN_INTERVAL_MS / 1000}s`);
  void runScan();
}

export function stop(): void {
  if (!scannerRunning) return;
  scannerRunning = false;
  if (scanHandle) { clearTimeout(scanHandle); scanHandle = null; }
  pushLog("info", "[Scanner] Stopped.");
}

export function isRunning(): boolean {
  return scannerRunning;
}

export function getResults(): ScanResult[] {
  return SCAN_SYMBOLS.map((s) => scanResults.get(s) ?? {
    symbol:           s,
    price:            0,
    signal:           null,
    confidence:       0,
    canTrade:         false,
    blockReason:      null,
    portfolioAllowed: false,
    portfolioReason:  null,
    riskAllowed:      false,
    riskReason:       null,
    enqueued:         false,
    lastScannedAt:    0,
    error:            null,
  });
}

export function getStatus() {
  return {
    running:    scannerRunning,
    scanCount,
    intervalMs: SCAN_INTERVAL_MS,
    symbols:    SCAN_SYMBOLS,
    results:    getResults(),
  };
}
