/**
 * gateioExchange — Gate.io CCXT driver.
 *
 * Encapsulates ALL Gate.io-specific API interactions. This is the only
 * file that knows about Gate.io's quirks:
 *   • Paper trading via x-simulated-trading header (no standard sandbox mode)
 *   • Native SL/TP order parameters (tpTriggerPx / slTriggerPx / tpOrdPx / slOrdPx)
 *   • Gate.io symbol format normalisation
 *
 * Higher-level concerns (risk validation, execution locks, credential
 * loading, queue dispatch) live in tradeService / exchangeService.
 */

import ccxt from "ccxt";
import type { Exchange } from "ccxt";
import { logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GateioCreds {
  apiKey: string;
  secret: string;
  password?: string;
  paper?: boolean;
}

export interface GateioBalanceResult {
  success: boolean;
  totalUsd: number;
  free: Record<string, number>;
  used: Record<string, number>;
  total: Record<string, number>;
  error?: string;
}

export interface GateioTickerResult {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
}

export interface GateioOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GateioOrderInput {
  symbol: string;
  type: "market" | "limit";
  side: "buy" | "sell";
  amount: number;
  price?: number;
  clientOrderId?: string;
  tpPrice?: number;
  slPrice?: number;
}

export interface GateioOrderResult {
  success: boolean;
  orderId: string | null;
  price: number | null;
  amount: number | null;
  status?: string;
  filled?: number;
  cost?: number;
  raw?: unknown;
  error?: string;
}

export interface GateioCloseInput {
  symbol: string;
  orderId?: string;
  amount?: number;
  clientOrderId?: string;
}

// ─── CCXT instance cache ─────────────────────────────────────────────────────

const cache = new Map<string, Exchange>();

function fingerprint(creds: GateioCreds): string {
  return `gateio|${creds.apiKey}|${creds.paper ? "paper" : "live"}`;
}

// ─── Symbol normalisation ────────────────────────────────────────────────────

function toSymbol(raw: string): string {
  if (raw.includes("/")) return raw;
  const quotes = ["USDT", "USDC", "USD", "BTC", "ETH", "BUSD", "EUR"];
  for (const q of quotes) {
    if (raw.endsWith(q)) {
      const base = raw.slice(0, -q.length);
      if (base) return `${base}/${q}`;
    }
  }
  return raw;
}

// ─── Error helper ────────────────────────────────────────────────────────────

function safeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

// ─── connect() ───────────────────────────────────────────────────────────────

/**
 * Return a cached (or new) authenticated CCXT gateio instance.
 *
 * Gate.io paper trading does not use a separate sandbox URL — instead the
 * x-simulated-trading: 1 request header activates the simulated account.
 * setSandboxMode() throws on Gate.io so we set the header directly.
 */
export function connect(creds: GateioCreds): Exchange {
  const key = fingerprint(creds);
  const cached = cache.get(key);
  if (cached) return cached;

  const ex = new ccxt.gate({
    apiKey: creds.apiKey,
    secret: creds.secret,
    password: creds.password,
    enableRateLimit: true,
    timeout: 15_000,
  });

  if (creds.paper) {
    ex.headers = { ...(ex.headers ?? {}), "x-simulated-trading": "1" };
  }

  cache.set(key, ex);
  logger.debug({ paper: Boolean(creds.paper) }, "gateioExchange: new CCXT instance created");
  return ex;
}

/** Evict a cached instance (e.g. after credentials change). */
export function evict(creds: GateioCreds): void {
  cache.delete(fingerprint(creds));
}

// ─── fetchBalance() ──────────────────────────────────────────────────────────

export async function fetchBalance(creds: GateioCreds): Promise<GateioBalanceResult> {
  try {
    const ex = connect(creds);
    const bal = await ex.fetchBalance();
    const free  = (bal.free  as unknown as Record<string, number>) ?? {};
    const used  = (bal.used  as unknown as Record<string, number>) ?? {};
    const total = (bal.total as unknown as Record<string, number>) ?? {};

    let totalUsd = 0;
    for (const [k, v] of Object.entries(total)) {
      const n = Number(v ?? 0);
      if (!Number.isFinite(n) || n === 0) continue;
      if (/^(USDT|USDC|USD|BUSD|DAI|FDUSD|TUSD)$/i.test(k)) totalUsd += n;
    }

    return { success: true, totalUsd, free, used, total };
  } catch (e) {
    logger.error({ err: e }, "gateioExchange.fetchBalance failed");
    return { success: false, totalUsd: 0, free: {}, used: {}, total: {}, error: safeError(e) };
  }
}

// ─── fetchTicker() ───────────────────────────────────────────────────────────

/**
 * Fetch a public ticker for `symbol`. No API keys required.
 * Uses an ephemeral anonymous instance so authenticated cached instances
 * remain unaffected.
 */
export async function fetchTicker(symbol: string): Promise<GateioTickerResult | null> {
  try {
    const ex = new ccxt.gate({ enableRateLimit: true, timeout: 10_000 });
    const t = await ex.fetchTicker(toSymbol(symbol));
    return {
      symbol,
      last:      t.last        ?? 0,
      bid:       t.bid         ?? 0,
      ask:       t.ask         ?? 0,
      high:      t.high        ?? 0,
      low:       t.low         ?? 0,
      volume:    t.quoteVolume ?? t.baseVolume ?? 0,
      timestamp: t.timestamp   ?? Date.now(),
    };
  } catch (e) {
    logger.warn({ err: e, symbol }, "gateioExchange.fetchTicker failed");
    return null;
  }
}

// ─── fetchOHLCV() ────────────────────────────────────────────────────────────

/**
 * Fetch OHLCV candles from Gate.io. No auth required.
 *
 * @param symbol   e.g. "BTCUSDT" or "BTC/USDT"
 * @param timeframe CCXT timeframe string: "1m" | "5m" | "15m" | "1h" | "4h" | "1d"
 * @param limit    Number of candles to fetch (default 200)
 */
export async function fetchOHLCV(
  symbol: string,
  timeframe = "1h",
  limit = 200,
): Promise<GateioOHLCV[]> {
  try {
    const ex = new ccxt.gate({ enableRateLimit: true, timeout: 10_000 });
    const raw = await ex.fetchOHLCV(toSymbol(symbol), timeframe, undefined, limit);
    return raw.map(([ts, open, high, low, close, volume]) => ({
      timestamp: ts     ?? 0,
      open:      open   ?? 0,
      high:      high   ?? 0,
      low:       low    ?? 0,
      close:     close  ?? 0,
      volume:    volume ?? 0,
    }));
  } catch (e) {
    logger.warn({ err: e, symbol, timeframe }, "gateioExchange.fetchOHLCV failed");
    return [];
  }
}

// ─── createOrder() ───────────────────────────────────────────────────────────

/**
 * Submit a market or limit order to Gate.io.
 *
 * When tpPrice / slPrice are provided they are attached directly to the
 * order using Gate.io's native TP/SL parameters so the exchange enforces
 * them server-side without an additional order.
 */
export async function createOrder(
  creds: GateioCreds,
  input: GateioOrderInput,
): Promise<GateioOrderResult> {
  if (input.amount <= 0) {
    return { success: false, orderId: null, price: null, amount: null, error: "amount must be > 0" };
  }
  if (input.type === "limit" && (input.price == null || input.price <= 0)) {
    return { success: false, orderId: null, price: null, amount: null, error: "price required for limit orders" };
  }

  try {
    const ex = connect(creds);
    const symbol = toSymbol(input.symbol);
    const params: Record<string, unknown> = {};

    if (input.clientOrderId) params["clientOrderId"] = input.clientOrderId;

    // Gate.io native TP/SL — market order executes when trigger price is hit
    if (input.tpPrice != null && input.tpPrice > 0) {
      params["tpTriggerPx"] = String(input.tpPrice.toFixed(8));
      params["tpOrdPx"]     = "-1";
    }
    if (input.slPrice != null && input.slPrice > 0) {
      params["slTriggerPx"] = String(input.slPrice.toFixed(8));
      params["slOrdPx"]     = "-1";
    }

    const order = await ex.createOrder(
      symbol,
      input.type,
      input.side,
      input.amount,
      input.price,
      params,
    );

    logger.info(
      { symbol: input.symbol, type: input.type, side: input.side, orderId: order.id },
      "gateioExchange.createOrder: submitted",
    );

    return {
      success: true,
      orderId: String(order.id ?? ""),
      price:   order.price ?? order.average ?? input.price ?? null,
      amount:  order.amount ?? input.amount,
      status:  order.status,
      filled:  order.filled,
      cost:    order.cost,
      raw:     order,
    };
  } catch (e) {
    logger.error(
      { err: e, symbol: input.symbol, type: input.type, side: input.side },
      "gateioExchange.createOrder failed",
    );
    return { success: false, orderId: null, price: null, amount: null, error: safeError(e) };
  }
}

// ─── closeOrder() ────────────────────────────────────────────────────────────

/**
 * Close a position on Gate.io.
 *
 * Strategy (in order of preference):
 *   1. If `orderId` is provided — cancel that open order directly.
 *   2. If `amount` is provided — place a market SELL to close the position.
 *   3. Otherwise — return an error.
 */
export async function closeOrder(
  creds: GateioCreds,
  input: GateioCloseInput,
): Promise<GateioOrderResult> {
  try {
    const ex = connect(creds);
    const symbol = toSymbol(input.symbol);

    if (input.orderId) {
      const cancelled = await ex.cancelOrder(input.orderId, symbol);
      logger.info(
        { symbol: input.symbol, orderId: input.orderId },
        "gateioExchange.closeOrder: order cancelled",
      );
      return {
        success: true,
        orderId: String(cancelled.id ?? input.orderId),
        price:   cancelled.price  ?? null,
        amount:  cancelled.amount ?? null,
        status:  cancelled.status ?? "canceled",
        raw:     cancelled,
      };
    }

    if (!input.amount || input.amount <= 0) {
      return {
        success: false,
        orderId: null,
        price:   null,
        amount:  null,
        error:   "orderId or a positive amount is required to close a position",
      };
    }

    const order = await ex.createOrder(
      symbol, "market", "sell", input.amount, undefined,
      input.clientOrderId ? { clientOrderId: input.clientOrderId } : {},
    );

    logger.info(
      { symbol: input.symbol, amount: input.amount },
      "gateioExchange.closeOrder: market sell placed",
    );

    return {
      success: true,
      orderId: String(order.id ?? ""),
      price:   order.price ?? order.average ?? null,
      amount:  order.amount ?? input.amount,
      status:  order.status,
      filled:  order.filled,
      cost:    order.cost,
      raw:     order,
    };
  } catch (e) {
    logger.error({ err: e, symbol: input.symbol }, "gateioExchange.closeOrder failed");
    return { success: false, orderId: null, price: null, amount: null, error: safeError(e) };
  }
}

// ─── validateCredentials() ───────────────────────────────────────────────────

/**
 * Validate Gate.io credentials by performing an authenticated balance fetch.
 * The cached CCXT instance is evicted afterwards so the caller always gets a
 * fresh connection when the keys are subsequently used for live trading.
 */
export async function validateCredentials(
  creds: GateioCreds,
): Promise<{ success: boolean; error?: string }> {
  try {
    const ex = connect(creds);
    await ex.fetchBalance();
    evict(creds);
    return { success: true };
  } catch (e) {
    evict(creds);
    return { success: false, error: safeError(e) };
  }
}
