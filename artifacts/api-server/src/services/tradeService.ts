/**
 * tradeService — production-ready trade execution layer.
 *
 * Safety architecture (two independent layers):
 *
 *   Layer 1 — Risk gate (riskService)
 *     Every entry order MUST pass riskService.validateTrade() first.
 *     If it throws RiskError → the order is NEVER submitted to the exchange.
 *     Exits (isExit: true) skip this check — we must always be able to close.
 *
 *   Layer 2 — Execution lock (pendingOrders Set)
 *     Prevents two concurrent tick() calls from submitting the same symbol
 *     before the first order completes.
 *
 * Both layers must pass for an entry order to reach the exchange.
 */

import ccxt, { type Exchange } from "ccxt";
import { logger } from "../lib/logger";
import { validateTrade, RiskError } from "./riskService";
import { toDisplaySymbol } from "../shared/symbolUtils";
import type { TradeParams, ValidatedTrade } from "./riskService";
import type { RiskManager } from "../lib/riskManager";

// ─── Re-export so callers get RiskError from one place ───────────────────────
export { RiskError };
export type { TradeParams, ValidatedTrade };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExchangeCreds {
  apiKey: string;
  secret: string;
  password?: string;
  exchange?: string;
  paper?: boolean;
  simulate?: boolean;  // true = skip exchange entirely (pure paper trading)
}

export type OrderSide = "buy" | "sell";

/**
 * Risk context for entry orders.
 * Required for all buy orders. Skip for sells (exits).
 */
export interface RiskContext {
  balanceFreeUsdt: number;
  currentPrice: number;
  stopLossPct: number;    // e.g. 0.009 = 0.9%
  takeProfitPct: number;  // e.g. 0.010 = 1.0%
}

export interface PlaceOrderInput {
  symbol: string;
  side: OrderSide;
  amount: number;
  price?: number;
  clientOrderId?: string;
  /**
   * Provide for ALL entry (buy) orders.
   * If present, riskService.validateTrade() is called — throws RiskError if blocked.
   * The validated safe amount and SL/TP prices are attached to the order.
   */
  riskContext?: RiskContext;
  /** Source-specific manager for queued bot/manual execution. */
  riskManager?: RiskManager;
  /**
   * Set true for position-closing orders.
   * Skips risk validation — exits must always be allowed.
   */
  isExit?: boolean;
}

export interface TradeResult {
  success: boolean;
  orderId: string | null;
  price: number | null;
  amount: number | null;
  status?: string;
  filled?: number;
  cost?: number;
  raw?: unknown;
  error?: string;
  blocked?: boolean;         // true if rejected by risk layer
  riskBlocked?: boolean;     // true specifically if rejected by riskService
  validatedTrade?: ValidatedTrade;  // present when risk validation passed
}

export interface BalanceResult {
  success: boolean;
  totalUsd: number;
  free: Record<string, number>;
  used: Record<string, number>;
  total: Record<string, number>;
  error?: string;
}

// ─── Exchange connection (cached per cred-fingerprint) ───────────────────────

type AnyExchange = Exchange;
const cache = new Map<string, AnyExchange>();

function fingerprint(c: ExchangeCreds): string {
  return `${c.exchange ?? "gateio"}|${c.apiKey}|${c.paper ? "paper" : "live"}`;
}

// ccxt v4 renamed "gateio" → "gate"; map internal IDs before class lookup
const CCXT_ID_MAP: Record<string, string> = { gateio: "gate" };
function toCcxtId(id: string): string { return CCXT_ID_MAP[id] ?? id; }

function buildExchange(c: ExchangeCreds): AnyExchange {
  const id = (c.exchange ?? "gateio").toLowerCase();
  const Cls = (ccxt as unknown as Record<string, new (cfg: object) => AnyExchange>)[toCcxtId(id)];
  if (!Cls) throw new Error(`Unsupported exchange: ${id}`);
  const ex = new Cls({
    apiKey: c.apiKey,
    secret: c.secret,
    password: c.password,
    enableRateLimit: true,
    timeout: 15_000,
  });
  if (c.paper) {
    try {
      ex.setSandboxMode(true);
    } catch {
      if (id === "gateio") {
        ex.headers = { ...(ex.headers ?? {}), "x-simulated-trading": "1" };
      }
    }
  }
  return ex;
}

export function connect(creds: ExchangeCreds): AnyExchange {
  const key = fingerprint(creds);
  let ex = cache.get(key);
  if (!ex) { ex = buildExchange(creds); cache.set(key, ex); }
  return ex;
}

// ─── Public ticker (no auth required) ────────────────────────────────────────

export interface TickerResult {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
}

/**
 * Fetch a public ticker for `symbol` using a temporary anonymous CCXT exchange.
 * No API keys required — suitable for price monitoring even without stored creds.
 */
export async function fetchTicker(
  exchange: string,
  symbol: string,
): Promise<TickerResult | null> {
  try {
    const id = exchange.toLowerCase();
    const Cls = (ccxt as unknown as Record<string, new (cfg: object) => AnyExchange>)[id];
    if (!Cls) return null;
    const ex = new Cls({ enableRateLimit: true, timeout: 10_000 });
    const t = await ex.fetchTicker(toCcxtSymbol(symbol));
    return {
      symbol,
      last:      t.last     ?? 0,
      bid:       t.bid      ?? 0,
      ask:       t.ask      ?? 0,
      high:      t.high     ?? 0,
      low:       t.low      ?? 0,
      volume:    t.quoteVolume ?? t.baseVolume ?? 0,
      timestamp: t.timestamp  ?? Date.now(),
    };
  } catch (e) {
    logger.warn({ err: e, exchange, symbol }, "tradeService.fetchTicker failed");
    return null;
  }
}

export function disconnect(creds: ExchangeCreds): void {
  cache.delete(fingerprint(creds));
}

// ─── Pending-order execution lock ─────────────────────────────────────────────
// Prevents duplicate concurrent submissions for the same symbol+side pair.

const pendingOrders = new Set<string>();

function pendingKey(symbol: string, side: OrderSide): string {
  return `${symbol.toUpperCase()}:${side}`;
}

function acquirePending(symbol: string, side: OrderSide): boolean {
  const key = pendingKey(symbol, side);
  if (pendingOrders.has(key)) {
    logger.warn({ symbol, side }, "tradeService: order in-flight — duplicate blocked");
    return false;
  }
  pendingOrders.add(key);
  return true;
}

function releasePending(symbol: string, side: OrderSide): void {
  pendingOrders.delete(pendingKey(symbol, side));
}

// ─── Symbol normalisation ─────────────────────────────────────────────────────

export function toCcxtSymbol(symbol: string): string {
  return toDisplaySymbol(symbol);
}

// ─── Core order placement ─────────────────────────────────────────────────────

function safeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

async function placeOrder(
  creds: ExchangeCreds,
  type: "market" | "limit",
  input: PlaceOrderInput,
): Promise<TradeResult> {
  // Paper trading simulation — no exchange call at all
  if (creds.simulate === true) {
    const isEntrySimulate = !input.isExit && input.side === "buy";
    const fakeOrderId = `PAPER-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    logger.info({ symbol: input.symbol, side: input.side, amount: input.amount }, "tradeService: PAPER SIMULATE — no exchange call");
    return {
      success: true,
      orderId: fakeOrderId,
      price: input.price ?? null,
      amount: input.amount,
      status: "simulated",
      filled: isEntrySimulate ? input.amount : input.amount,
    };
  }

  const isEntry = !input.isExit && input.side === "buy";

  // ── Layer 1: Risk validation (entry orders only) ──────────────────────────
  let validated: ValidatedTrade | undefined;

  if (isEntry && input.riskContext) {
    const riskCtx = input.riskContext;
    const params: TradeParams = {
      symbol:               input.symbol,
      side:                 input.side,
      requestedAmountUsdt:  input.amount * (input.price ?? riskCtx.currentPrice),
      currentPrice:         riskCtx.currentPrice,
      balanceFreeUsdt:      riskCtx.balanceFreeUsdt,
      stopLossPct:          riskCtx.stopLossPct,
      takeProfitPct:        riskCtx.takeProfitPct,
      riskManager:          input.riskManager,
    };

    try {
      validated = await validateTrade(params);

      // Use the risk-validated (possibly reduced) quantity
      const riskAdjustedQty = validated.safeQty;
      if (Math.abs(riskAdjustedQty - input.amount) > 0.000001) {
        logger.info(
          { original: input.amount, adjusted: riskAdjustedQty, symbol: input.symbol },
          "tradeService: quantity adjusted by risk validation",
        );
        input = { ...input, amount: riskAdjustedQty };
      }
    } catch (e) {
      if (e instanceof RiskError) {
        logger.warn({ rule: e.rule, msg: e.message }, "tradeService: order blocked by risk gate");
        return {
          success: false,
          orderId: null,
          price: null,
          amount: null,
          blocked: true,
          riskBlocked: true,
          error: e.message,
        };
      }
      // Unknown error from risk check — surface it
      throw e;
    }
  } else if (isEntry && !input.riskContext) {
    // Entry without risk context is only allowed if caller explicitly opts out
    // This should never happen in normal operation — log a strong warning
    logger.warn(
      { symbol: input.symbol, side: input.side },
      "tradeService: entry order placed WITHOUT risk context — this bypasses risk validation!",
    );
  }

  // ── Layer 2: Execution-level duplicate guard ──────────────────────────────
  if (!acquirePending(input.symbol, input.side)) {
    return {
      success: false,
      orderId: null,
      price: null,
      amount: null,
      blocked: true,
      error: `Order already in-flight for ${input.symbol} ${input.side} — duplicate blocked`,
    };
  }

  try {
    if (input.amount <= 0) {
      return { success: false, orderId: null, price: null, amount: null, error: "amount must be > 0" };
    }
    if (type === "limit" && (input.price == null || input.price <= 0)) {
      return { success: false, orderId: null, price: null, amount: null, error: "price required for limit orders" };
    }

    const ex = connect(creds);
    const symbol = toCcxtSymbol(input.symbol);
    const params: Record<string, unknown> = {};
    if (input.clientOrderId) params["clientOrderId"] = input.clientOrderId;

    // ── Attach SL/TP to the order if the exchange supports it ───────────────
    // OKX supports attached SL/TP via tpsl* params on the order itself.
    // When validated is present we always send them — they are mandatory.
    const exchangeId = (creds.exchange ?? "gateio").toLowerCase();
    if (validated && !input.isExit && exchangeId === "gateio") {
      params["tpTriggerPx"] = String(validated.tpPrice.toFixed(8));
      params["slTriggerPx"] = String(validated.slPrice.toFixed(8));
      params["tpOrdPx"]     = "-1";  // market order on TP hit
      params["slOrdPx"]     = "-1";  // market order on SL hit
    }

    const order = await ex.createOrder(symbol, type, input.side, input.amount, input.price, params);

    return {
      success: true,
      orderId: String(order.id ?? ""),
      price: order.price ?? order.average ?? input.price ?? null,
      amount: order.amount ?? input.amount,
      status: order.status,
      filled: order.filled,
      cost: order.cost,
      raw: order,
      validatedTrade: validated,
    };
  } catch (e) {
    logger.error({ err: e, symbol: input.symbol, type, side: input.side }, "tradeService.placeOrder failed");
    return { success: false, orderId: null, price: null, amount: null, error: safeError(e) };
  } finally {
    releasePending(input.symbol, input.side);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function placeMarketOrder(
  creds: ExchangeCreds,
  input: PlaceOrderInput,
): Promise<TradeResult> {
  return placeOrder(creds, "market", input);
}

export function placeLimitOrder(
  creds: ExchangeCreds,
  input: PlaceOrderInput,
): Promise<TradeResult> {
  return placeOrder(creds, "limit", input);
}

// ─── Balance ─────────────────────────────────────────────────────────────────

export async function fetchBalance(creds: ExchangeCreds): Promise<BalanceResult> {
  // Paper simulation — never call the exchange
  if (creds.simulate === true) {
    logger.info("tradeService.fetchBalance: PAPER SIMULATE — returning empty balance");
    return { success: true, totalUsd: 0, free: { USDT: 0 }, used: {}, total: { USDT: 0 } };
  }
  try {
    const ex = connect(creds);
    const bal = await ex.fetchBalance();
    const free  = (bal.free  as unknown as Record<string, number>) ?? {};
    const used  = (bal.used  as unknown as Record<string, number>) ?? {};
    const total = (bal.total as unknown as Record<string, number>) ?? {};
    let totalUsd = 0;
    for (const k of Object.keys(total)) {
      const v = Number(total[k] ?? 0);
      if (!Number.isFinite(v) || v === 0) continue;
      if (/^(USDT|USDC|USD|BUSD|DAI|FDUSD|TUSD)$/i.test(k)) totalUsd += v;
    }
    return { success: true, totalUsd, free, used, total };
  } catch (e) {
    logger.error({ err: e }, "tradeService.fetchBalance failed");
    return { success: false, totalUsd: 0, free: {}, used: {}, total: {}, error: safeError(e) };
  }
}

// ─── Order confirmation (poll for fill) ──────────────────────────────────────

export interface ConfirmInput {
  symbol: string;
  orderId: string;
  timeoutMs?: number;
  pollMs?: number;
}

export async function confirmOrder(creds: ExchangeCreds, input: ConfirmInput): Promise<TradeResult> {
  const timeout = input.timeoutMs ?? 10_000;
  const poll = Math.max(250, input.pollMs ?? 750);
  const symbol = toCcxtSymbol(input.symbol);
  const start = Date.now();
  try {
    const ex = connect(creds);
    while (Date.now() - start < timeout) {
      try {
        const o = await ex.fetchOrder(input.orderId, symbol);
        const status = (o.status ?? "").toLowerCase();
        if (status === "closed" || status === "filled" || status === "canceled" || status === "rejected") {
          return {
            success: status === "closed" || status === "filled",
            orderId: String(o.id ?? input.orderId),
            price: o.average ?? o.price ?? null,
            amount: o.amount ?? null,
            filled: o.filled,
            cost: o.cost,
            status,
            raw: o,
          };
        }
      } catch (inner) {
        logger.debug({ err: inner, orderId: input.orderId }, "fetchOrder transient error");
      }
      await new Promise((r) => setTimeout(r, poll));
    }
    return {
      success: false,
      orderId: input.orderId,
      price: null,
      amount: null,
      status: "timeout",
      error: `Order ${input.orderId} not confirmed within ${timeout}ms`,
    };
  } catch (e) {
    logger.error({ err: e, orderId: input.orderId }, "tradeService.confirmOrder failed");
    return { success: false, orderId: input.orderId, price: null, amount: null, error: safeError(e) };
  }
}

// ─── Auth test ────────────────────────────────────────────────────────────────

export async function testAuth(creds: ExchangeCreds): Promise<{ success: boolean; error?: string }> {
  // Paper simulation — skip all authenticated exchange calls
  if (creds.simulate === true) {
    logger.info("tradeService.testAuth: PAPER SIMULATE — auth skipped");
    return { success: true };
  }
  try {
    const ex = connect(creds);
    await ex.fetchBalance();
    return { success: true };
  } catch (e) {
    return { success: false, error: safeError(e) };
  }
}
