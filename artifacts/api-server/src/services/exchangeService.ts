import { logger } from "../lib/logger";
import * as trade from "./tradeService";
import * as gateio from "./gateioExchange";
import * as store from "../lib/store";
import * as apiKeys from "./apiKeyService";
import type { ExchangeCreds, TradeResult } from "./tradeService";
import { gateioWs } from "../lib/gateioWs";

/**
 * exchangeService — multi-exchange façade.
 *
 * Responsibilities:
 *   • Knows which exchanges this app supports (currently Gate.io).
 *   • Loads encrypted API credentials from the DB vault.
 *   • Delegates ALL exchange-specific operations to gateioExchange.
 *   • Delegates order execution (with risk gates + execution locks) to tradeService.
 *   • Never returns or logs API key material.
 *
 * Call graph:
 *   exchangeService  →  gateioExchange   (balance, ticker, OHLCV, credentials)
 *   exchangeService  →  tradeService     (market/limit orders, order confirmation)
 */

// ─── Supported exchanges ─────────────────────────────────────────────────────

export type ExchangeId = "gateio";

export interface ExchangeMeta {
  id: ExchangeId;
  label: string;
  needsPassphrase: boolean;
  supportsPaperTrading: boolean;
  notes?: string;
}

export const SUPPORTED_EXCHANGES: ReadonlyArray<ExchangeMeta> = [
  { id: "gateio", label: "Gate.io", needsPassphrase: false, supportsPaperTrading: true, notes: "Spot trading" },
];

export function isSupported(id: string): id is ExchangeId {
  return SUPPORTED_EXCHANGES.some((e) => e.id === id);
}

export function listSupported(): ExchangeMeta[] {
  return SUPPORTED_EXCHANGES.map((e) => ({ ...e }));
}

// ─── Active selection (in-memory; persisted via bot config) ──────────────────

let activeExchange: ExchangeId = "gateio";

export function getActiveExchange(): ExchangeId {
  return activeExchange;
}

export function setActiveExchange(id: ExchangeId): void {
  if (!isSupported(id)) throw new Error(`Unsupported exchange: ${id}`);
  activeExchange = id;
  logger.info({ exchange: id }, "exchangeService.activeExchange set");
}

// ─── Credential loading (from encrypted vault) ───────────────────────────────

interface LoadedCreds extends ExchangeCreds {
  apiKeyMask: string;
  hasKeys: boolean;
}

/**
 * Load credentials for the given exchange (defaults to active).
 * Returns null if no keys are stored.
 *
 * IMPORTANT: the returned object contains plaintext key material — never
 * log it, serialize it to clients, or write it to disk. Use `summariseCreds()`
 * for anything you intend to expose.
 */
export async function loadCreds(
  exchange?: ExchangeId,
  userId?: number,
): Promise<LoadedCreds | null> {
  const id = exchange ?? activeExchange;
  if (!isSupported(id)) return null;
  const stored = await store.loadActiveApiKey(id, userId);
  if (!stored) return null;
  return {
    apiKey: stored.apiKey,
    secret: stored.apiSecret,
    password: stored.passphrase || undefined,
    exchange: id,
    paper: stored.isPaper,
    apiKeyMask: stored.apiKeyMask,
    hasKeys: Boolean(stored.apiKey && stored.apiSecret),
  };
}

/** Public, safe-to-expose summary (NO secrets). */
export interface CredsSummary {
  exchange: ExchangeId;
  hasKeys: boolean;
  apiKeyMask: string;
  needsPassphrase: boolean;
  hasPassphrase: boolean;
  paper: boolean;
}

export async function summariseCreds(
  exchange?: ExchangeId,
  userId?: number,
): Promise<CredsSummary> {
  const id = exchange ?? activeExchange;
  const meta = SUPPORTED_EXCHANGES.find((e) => e.id === id)!;
  const c = await loadCreds(id, userId);
  return {
    exchange: id,
    hasKeys: Boolean(c?.hasKeys),
    apiKeyMask: c?.apiKeyMask ?? "",
    needsPassphrase: meta.needsPassphrase,
    hasPassphrase: Boolean(c?.password),
    paper: c?.paper ?? true,
  };
}

// ─── Adapter: LoadedCreds → GateioCreds ──────────────────────────────────────

function toGateioCreds(c: LoadedCreds): gateio.GateioCreds {
  return {
    apiKey:   c.apiKey,
    secret:   c.secret,
    password: c.password,
    paper:    c.paper,
  };
}

// ─── Save / validate keys for a specific exchange ────────────────────────────

export interface SaveKeysInput {
  userId?: number;
  exchange: ExchangeId;
  apiKey: string;
  secret: string;
  passphrase?: string;
  paper?: boolean;
  label?: string;
}

export async function saveAndValidate(input: SaveKeysInput): Promise<{ success: boolean; error?: string }> {
  if (!isSupported(input.exchange)) return { success: false, error: `Unsupported exchange: ${input.exchange}` };
  if (!input.apiKey || !input.secret) return { success: false, error: "apiKey and secret are required" };

  const meta = SUPPORTED_EXCHANGES.find((e) => e.id === input.exchange)!;
  if (meta.needsPassphrase && !input.passphrase) {
    return { success: false, error: `${meta.label} requires a passphrase` };
  }

  // Validate via gateioExchange before persisting
  const auth = await gateio.validateCredentials({
    apiKey:   input.apiKey,
    secret:   input.secret,
    password: input.passphrase,
    paper:    input.paper ?? true,
  });
  if (!auth.success) return { success: false, error: auth.error ?? "Auth failed" };

  // Persist (encrypted)
  if (input.userId) {
    const r = await apiKeys.saveApiKeys(
      input.userId,
      input.exchange,
      input.apiKey,
      input.secret,
      { passphrase: input.passphrase, isPaper: input.paper ?? true, label: input.label },
    );
    if (!r.ok) return { success: false, error: r.error };
  } else {
    await store.saveApiKey({
      exchange: input.exchange,
      apiKey: input.apiKey,
      apiSecret: input.secret,
      passphrase: input.passphrase,
      isPaper: input.paper ?? true,
      label: input.label,
    });
  }

  // Evict any stale gateioExchange cache entry for these credentials
  gateio.evict({ apiKey: input.apiKey, secret: input.secret, password: input.passphrase, paper: input.paper ?? true });

  return { success: true };
}

// ─── withCreds — load credentials then invoke a function ─────────────────────

async function withCredsBalance<T>(
  exchange: ExchangeId | undefined,
  fn: (c: LoadedCreds) => Promise<T>,
  emptyResult: T,
): Promise<T> {
  const creds = await loadCreds(exchange);
  if (!creds) return emptyResult;
  return fn(creds);
}

async function withTradeCredsLoaded<T>(
  exchange: ExchangeId | undefined,
  fn: (c: ExchangeCreds) => Promise<T>,
  emptyResult: T,
): Promise<T> {
  const creds = await loadCreds(exchange);
  if (!creds) return emptyResult;
  return fn({
    apiKey:   creds.apiKey,
    secret:   creds.secret,
    password: creds.password,
    exchange: creds.exchange,
    paper:    creds.paper,
  });
}

// ─── Balance ─────────────────────────────────────────────────────────────────

export interface BalanceResult {
  success: boolean;
  totalUsd: number;
  free: Record<string, number>;
  used: Record<string, number>;
  total: Record<string, number>;
  error?: string;
}

export async function fetchBalance(exchange?: ExchangeId): Promise<BalanceResult> {
  return withCredsBalance(
    exchange,
    (c) => gateio.fetchBalance(toGateioCreds(c)),
    { success: false, totalUsd: 0, free: {}, used: {}, total: {}, error: "No credentials stored for this exchange" },
  );
}

// ─── Ticker (public, no credentials needed) ──────────────────────────────────

/**
 * Returns the current ticker for the given symbol.
 *
 * Priority:
 *   1. Gate.io WebSocket cache — used when connected and data is fresh (< 10 s).
 *      Calling subscribeTicker() here is idempotent; it's a no-op once subscribed.
 *   2. REST fallback via gateio.fetchTicker() — used when WS is unavailable or
 *      the cached value is stale.
 */
export async function getTicker(symbol: string, _exchange?: ExchangeId): Promise<gateio.GateioTickerResult | null> {
  // Lazily subscribe so the WS cache is populated for subsequent calls.
  gateioWs.subscribeTicker(symbol);

  if (gateioWs.isFreshTicker(symbol)) {
    const ws = gateioWs.getLastTicker(symbol);
    if (ws) {
      logger.debug({ symbol, source: "websocket" }, "exchangeService: ticker from WS cache");
      return {
        symbol:    ws.symbol,
        last:      ws.last,
        bid:       ws.bid,
        ask:       ws.ask,
        high:      ws.high24h,
        low:       ws.low24h,
        volume:    ws.volume24h,
        timestamp: ws.updatedAt,
      };
    }
  }

  // WS unavailable or data not yet arrived — fall back to REST
  logger.debug({ symbol, source: "rest" }, "exchangeService: ticker from REST fallback");
  return gateio.fetchTicker(symbol);
}

// ─── OHLCV (public, no credentials needed) ───────────────────────────────────

export async function getOHLCV(
  symbol: string,
  timeframe = "1h",
  limit = 200,
  _exchange?: ExchangeId,
): Promise<gateio.GateioOHLCV[]> {
  return gateio.fetchOHLCV(symbol, timeframe, limit);
}

// ─── Order execution (delegated to tradeService — risk gates live there) ──────

export async function placeMarketOrder(
  input: { symbol: string; side: "buy" | "sell"; amount: number; clientOrderId?: string },
  exchange?: ExchangeId,
): Promise<TradeResult> {
  return withTradeCredsLoaded(
    exchange,
    (c) => trade.placeMarketOrder(c, input),
    { success: false, orderId: null, price: null, amount: null, error: "No credentials stored for this exchange" },
  );
}

export async function placeLimitOrder(
  input: { symbol: string; side: "buy" | "sell"; amount: number; price: number; clientOrderId?: string },
  exchange?: ExchangeId,
): Promise<TradeResult> {
  return withTradeCredsLoaded(
    exchange,
    (c) => trade.placeLimitOrder(c, input),
    { success: false, orderId: null, price: null, amount: null, error: "No credentials stored for this exchange" },
  );
}

export async function confirmOrder(
  input: { symbol: string; orderId: string; timeoutMs?: number; pollMs?: number },
  exchange?: ExchangeId,
): Promise<TradeResult> {
  return withTradeCredsLoaded(
    exchange,
    (c) => trade.confirmOrder(c, input),
    { success: false, orderId: input.orderId, price: null, amount: null, error: "No credentials stored for this exchange" },
  );
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function ping(exchange?: ExchangeId): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
  const t0 = Date.now();
  const r = await fetchBalance(exchange);
  return r.success
    ? { success: true, latencyMs: Date.now() - t0 }
    : { success: false, error: r.error };
}
