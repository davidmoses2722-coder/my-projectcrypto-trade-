/**
 * gateioFuturesExchange — Gate.io USDT-margined Perpetual Futures CCXT driver.
 *
 * Deliberately a SEPARATE file from gateioExchange.ts (spot). Nothing here is
 * imported by lib/bot.ts or manual-trading.ts, so the existing spot execution
 * path is byte-for-byte unchanged by this file's existence.
 *
 * Gate.io USDT-M perpetual swaps are addressed in CCXT's unified symbol form
 * "BASE/QUOTE:SETTLE", e.g. "BTC/USDT:USDT".
 */

import ccxt from "ccxt";
import type { Exchange } from "ccxt";
import { logger } from "../lib/logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GateioCreds {
  apiKey: string;
  secret: string;
  password?: string;
  paper?: boolean;
}

export interface FuturesCapabilityResult {
  supported: boolean;
  reason?: string;
  balanceUsdt?: number;
}

export interface FuturesPositionResult {
  symbol: string;
  side: "long" | "short";
  contracts: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  leverage: number;
  marginMode: "isolated" | "cross";
  initialMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  raw?: unknown;
}

export interface FuturesOrderInput {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  amount: number;
  price?: number;
  reduceOnly?: boolean;
  leverage?: number;
  marginMode?: "isolated" | "cross";
  clientOrderId?: string;
  tpPrice?: number;
  slPrice?: number;
}

export interface FuturesOrderResult {
  success: boolean;
  orderId: string | null;
  price: number | null;
  amount: number | null;
  status?: string;
  filled?: number;
  raw?: unknown;
  error?: string;
}

export interface FundingRateResult {
  symbol: string;
  fundingRate: number;
  nextFundingTime: number | null;
  markPrice: number | null;
}

export interface FuturesAccountResult {
  totalEquity: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnl: number;
  marginMode: string;
  currency: string;
}

export interface FuturesTickerResult {
  symbol: string;
  last: number;
  markPrice: number | null;
  indexPrice: number | null;
  bid: number;
  ask: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  fundingRate: number | null;
  nextFundingTime: number | null;
  timestamp: number;
}

export interface OrderBookEntry {
  price: number;
  amount: number;
  total: number;
}

export interface FuturesOrderBookResult {
  symbol: string;
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
  spread: number;
  midPrice: number;
  timestamp: number;
}

export interface RecentTradeResult {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  amount: number;
  timestamp: number;
}

// ─── CCXT instance cache (separate from spot cache) ─────────────────────────

const cache = new Map<string, Exchange>();

function fingerprint(creds: GateioCreds): string {
  return `gateio-futures|${creds.apiKey}|${creds.paper ? "paper" : "live"}`;
}

function toFuturesSymbol(raw: string): string {
  if (raw.includes(":")) return raw;
  const base = raw.includes("/") ? raw : toSpotSymbol(raw);
  const [b, q] = base.split("/");
  if (!b || !q) return raw;
  return `${b}/${q}:${q}`;
}

function toSpotSymbol(raw: string): string {
  if (raw.includes("/")) return raw;
  const quotes = ["USDT", "USDC", "USD"];
  for (const q of quotes) {
    if (raw.endsWith(q)) {
      const b = raw.slice(0, -q.length);
      if (b) return `${b}/${q}`;
    }
  }
  return raw;
}

function safeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

/** Return a cached (or new) authenticated CCXT instance in "swap" (futures) mode. */
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
    options: { defaultType: "swap", defaultSettle: "usdt" },
  });

  if (creds.paper) {
    ex.headers = { ...(ex.headers ?? {}), "x-simulated-trading": "1" };
  }

  cache.set(key, ex);
  return ex;
}

export function evict(creds: GateioCreds): void {
  cache.delete(fingerprint(creds));
}

// ─── Public market data (no auth needed) ────────────────────────────────────

export async function fetchTickerPublic(symbol: string): Promise<FuturesTickerResult | null> {
  try {
    const ex = new ccxt.gate({ enableRateLimit: true, timeout: 10_000, options: { defaultType: "swap", defaultSettle: "usdt" } });
    const fSymbol = toFuturesSymbol(symbol);
    const ticker = await ex.fetchTicker(fSymbol);

    let fundingRate: number | null = null;
    let nextFundingTime: number | null = null;
    try {
      const fr = await ex.fetchFundingRate(fSymbol);
      fundingRate = fr.fundingRate != null ? Number(fr.fundingRate) : null;
      nextFundingTime = fr.fundingTimestamp ?? null;
    } catch { /* funding rate not critical */ }

    return {
      symbol,
      last: Number(ticker.last ?? 0),
      markPrice: ticker.markPrice != null ? Number(ticker.markPrice) : null,
      indexPrice: null,
      bid: Number(ticker.bid ?? 0),
      ask: Number(ticker.ask ?? 0),
      high24h: Number(ticker.high ?? 0),
      low24h: Number(ticker.low ?? 0),
      volume24h: Number(ticker.baseVolume ?? 0),
      fundingRate,
      nextFundingTime,
      timestamp: ticker.timestamp ?? Date.now(),
    };
  } catch (e) {
    logger.warn({ err: e, symbol }, "gateioFuturesExchange.fetchTickerPublic failed");
    return null;
  }
}

export async function fetchOrderBookPublic(symbol: string, limit = 20): Promise<FuturesOrderBookResult | null> {
  try {
    const ex = new ccxt.gate({ enableRateLimit: true, timeout: 10_000, options: { defaultType: "swap", defaultSettle: "usdt" } });
    const fSymbol = toFuturesSymbol(symbol);
    const ob = await ex.fetchOrderBook(fSymbol, limit);

    const asks: OrderBookEntry[] = [];
    let askTotal = 0;
    for (const [price, amount] of ob.asks) {
      askTotal += Number(amount);
      asks.push({ price: Number(price), amount: Number(amount), total: askTotal });
    }

    const bids: OrderBookEntry[] = [];
    let bidTotal = 0;
    for (const [price, amount] of ob.bids) {
      bidTotal += Number(amount);
      bids.push({ price: Number(price), amount: Number(amount), total: bidTotal });
    }

    const bestAsk = asks[0]?.price ?? 0;
    const bestBid = bids[0]?.price ?? 0;
    const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
    const midPrice = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : 0;

    return { symbol, asks, bids, spread, midPrice, timestamp: Date.now() };
  } catch (e) {
    logger.warn({ err: e, symbol }, "gateioFuturesExchange.fetchOrderBookPublic failed");
    return null;
  }
}

export async function fetchRecentTradesPublic(symbol: string, limit = 50): Promise<RecentTradeResult[]> {
  try {
    const ex = new ccxt.gate({ enableRateLimit: true, timeout: 10_000, options: { defaultType: "swap", defaultSettle: "usdt" } });
    const fSymbol = toFuturesSymbol(symbol);
    const trades = await ex.fetchTrades(fSymbol, undefined, limit);
    return trades.map((t) => ({
      id: String(t.id ?? ""),
      symbol,
      side: (t.side === "sell" ? "sell" : "buy") as "buy" | "sell",
      price: Number(t.price ?? 0),
      amount: Number(t.amount ?? 0),
      timestamp: t.timestamp ?? Date.now(),
    }));
  } catch (e) {
    logger.warn({ err: e, symbol }, "gateioFuturesExchange.fetchRecentTradesPublic failed");
    return [];
  }
}

// ─── Authenticated endpoints ────────────────────────────────────────────────

export async function checkFuturesCapability(creds: GateioCreds): Promise<FuturesCapabilityResult> {
  try {
    const ex = connect(creds);
    const bal = await ex.fetchBalance({ type: "swap" });
    const free = (bal.free as unknown as Record<string, number>) ?? {};
    const balanceUsdt = Number(free["USDT"] ?? 0);
    return { supported: true, balanceUsdt };
  } catch (e) {
    const msg = safeError(e);
    logger.warn({ err: e }, "gateioFuturesExchange.checkFuturesCapability: not supported");
    return { supported: false, reason: msg };
  }
}

export async function fetchAccount(creds: GateioCreds): Promise<FuturesAccountResult> {
  try {
    const ex = connect(creds);
    const bal = await ex.fetchBalance({ type: "swap" });
    const free = (bal.free as unknown as Record<string, number>) ?? {};
    const used = (bal.used as unknown as Record<string, number>) ?? {};
    const total = (bal.total as unknown as Record<string, number>) ?? {};
    return {
      totalEquity: Number(total["USDT"] ?? 0),
      availableBalance: Number(free["USDT"] ?? 0),
      usedMargin: Number(used["USDT"] ?? 0),
      unrealizedPnl: 0,
      marginMode: "isolated",
      currency: "USDT",
    };
  } catch (e) {
    logger.error({ err: e }, "gateioFuturesExchange.fetchAccount failed");
    return { totalEquity: 0, availableBalance: 0, usedMargin: 0, unrealizedPnl: 0, marginMode: "isolated", currency: "USDT" };
  }
}

export async function fetchPositions(creds: GateioCreds, symbol?: string): Promise<FuturesPositionResult[]> {
  const ex = connect(creds);
  const symbols = symbol ? [toFuturesSymbol(symbol)] : undefined;
  const raw = await ex.fetchPositions(symbols);
  return raw
    .filter((p: import("ccxt").Position) => Number(p.contracts ?? 0) !== 0)
    .map((p: import("ccxt").Position) => ({
      symbol: String(p.symbol ?? ""),
      side: (p.side === "short" ? "short" : "long") as "long" | "short",
      contracts: Number(p.contracts ?? 0),
      entryPrice: Number(p.entryPrice ?? 0),
      markPrice: Number(p.markPrice ?? 0),
      liquidationPrice: p.liquidationPrice != null ? Number(p.liquidationPrice) : null,
      leverage: Number(p.leverage ?? 1),
      marginMode: (p.marginMode === "cross" ? "cross" : "isolated") as "isolated" | "cross",
      initialMargin: Number(p.initialMargin ?? 0),
      unrealizedPnl: Number(p.unrealizedPnl ?? 0),
      realizedPnl: Number((p as unknown as { realizedPnl?: number }).realizedPnl ?? 0),
      raw: p,
    }));
}

export async function setLeverage(
  creds: GateioCreds,
  symbol: string,
  leverage: number,
  marginMode: "isolated" | "cross" = "isolated",
): Promise<{ success: boolean; error?: string }> {
  if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) {
    return { success: false, error: "leverage must be between 1 and 125" };
  }
  try {
    const ex = connect(creds);
    const fSymbol = toFuturesSymbol(symbol);
    try {
      await ex.setMarginMode(marginMode, fSymbol);
    } catch (marginErr) {
      logger.warn({ err: marginErr, symbol, marginMode }, "gateioFuturesExchange.setLeverage: setMarginMode warning");
    }
    await ex.setLeverage(leverage, fSymbol);
    return { success: true };
  } catch (e) {
    logger.error({ err: e, symbol, leverage }, "gateioFuturesExchange.setLeverage failed");
    return { success: false, error: safeError(e) };
  }
}

export async function fetchFundingRate(symbol: string): Promise<FundingRateResult | null> {
  try {
    const ex = new ccxt.gate({ enableRateLimit: true, timeout: 10_000, options: { defaultType: "swap", defaultSettle: "usdt" } });
    const r = await ex.fetchFundingRate(toFuturesSymbol(symbol));
    return {
      symbol,
      fundingRate: Number(r.fundingRate ?? 0),
      nextFundingTime: r.fundingTimestamp ?? null,
      markPrice: r.markPrice != null ? Number(r.markPrice) : null,
    };
  } catch (e) {
    logger.warn({ err: e, symbol }, "gateioFuturesExchange.fetchFundingRate failed");
    return null;
  }
}

export async function createOrder(
  creds: GateioCreds,
  input: FuturesOrderInput,
): Promise<FuturesOrderResult> {
  if (input.amount <= 0) {
    return { success: false, orderId: null, price: null, amount: null, error: "amount must be > 0" };
  }
  if (input.type === "limit" && (input.price == null || input.price <= 0)) {
    return { success: false, orderId: null, price: null, amount: null, error: "price required for limit orders" };
  }

  try {
    const ex = connect(creds);
    const symbol = toFuturesSymbol(input.symbol);

    if (input.leverage != null) {
      const lev = await setLeverage(creds, symbol, input.leverage, input.marginMode ?? "isolated");
      if (!lev.success) {
        return { success: false, orderId: null, price: null, amount: null, error: `leverage rejected: ${lev.error}` };
      }
    }

    const params: Record<string, unknown> = {};
    if (input.reduceOnly) params["reduceOnly"] = true;
    if (input.clientOrderId) params["clientOrderId"] = input.clientOrderId;
    if (input.tpPrice != null && input.tpPrice > 0) {
      params["tpTriggerPx"] = String(input.tpPrice.toFixed(8));
      params["tpOrdPx"] = "-1";
    }
    if (input.slPrice != null && input.slPrice > 0) {
      params["slTriggerPx"] = String(input.slPrice.toFixed(8));
      params["slOrdPx"] = "-1";
    }

    const order = await ex.createOrder(symbol, input.type, input.side, input.amount, input.price, params);

    logger.info(
      { symbol: input.symbol, side: input.side, type: input.type, reduceOnly: input.reduceOnly, orderId: order.id },
      "gateioFuturesExchange.createOrder: submitted",
    );

    return {
      success: true,
      orderId: String(order.id ?? ""),
      price: order.price ?? order.average ?? input.price ?? null,
      amount: order.amount ?? input.amount,
      status: order.status,
      filled: order.filled,
      raw: order,
    };
  } catch (e) {
    logger.error({ err: e, symbol: input.symbol, side: input.side }, "gateioFuturesExchange.createOrder failed");
    return { success: false, orderId: null, price: null, amount: null, error: safeError(e) };
  }
}

export async function cancelOrder(
  creds: GateioCreds,
  symbol: string,
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const ex = connect(creds);
    const fSymbol = toFuturesSymbol(symbol);
    await ex.cancelOrder(orderId, fSymbol);
    return { success: true };
  } catch (e) {
    logger.error({ err: e, symbol, orderId }, "gateioFuturesExchange.cancelOrder failed");
    return { success: false, error: safeError(e) };
  }
}

export async function closePosition(
  creds: GateioCreds,
  symbol: string,
  side: "long" | "short",
  amount: number,
): Promise<FuturesOrderResult> {
  return createOrder(creds, {
    symbol,
    side: side === "long" ? "sell" : "buy",
    type: "market",
    amount,
    reduceOnly: true,
  });
}

// ─── Paper Trading Engine ────────────────────────────────────────────────────

interface PaperPosition {
  id: string;
  symbol: string;
  side: "long" | "short";
  contracts: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  marginMode: "isolated" | "cross";
  initialMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  liquidationPrice: number | null;
  tpPrice: number | null;
  slPrice: number | null;
  createdAt: number;
}

interface PaperOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  amount: number;
  price: number | null;
  reduceOnly: boolean;
  leverage: number;
  marginMode: "isolated" | "cross";
  status: "open" | "filled" | "cancelled";
  filledAt: number | null;
  createdAt: number;
}

const paperPositions = new Map<string, PaperPosition>();
const paperOrders = new Map<string, PaperOrder>();
const paperBalance = { total: 10000, available: 10000, used: 0, unrealizedPnl: 0 };

let paperIdCounter = 0;
function nextPaperId(): string { return `paper_${Date.now()}_${++paperIdCounter}`; }

export function paperGetPositions(): FuturesPositionResult[] {
  return Array.from(paperPositions.values()).map((p) => ({
    symbol: p.symbol,
    side: p.side,
    contracts: p.contracts,
    entryPrice: p.entryPrice,
    markPrice: p.markPrice,
    liquidationPrice: p.liquidationPrice,
    leverage: p.leverage,
    marginMode: p.marginMode,
    initialMargin: p.initialMargin,
    unrealizedPnl: p.unrealizedPnl,
    realizedPnl: p.realizedPnl,
  }));
}

export function paperGetAccount(): FuturesAccountResult {
  // Recalculate unrealized PnL from positions
  let unrealizedPnl = 0;
  for (const pos of paperPositions.values()) {
    if (pos.side === "long") {
      pos.unrealizedPnl = (pos.markPrice - pos.entryPrice) * pos.contracts;
    } else {
      pos.unrealizedPnl = (pos.entryPrice - pos.markPrice) * pos.contracts;
    }
    unrealizedPnl += pos.unrealizedPnl;
  }
  paperBalance.unrealizedPnl = unrealizedPnl;

  return {
    totalEquity: paperBalance.total + unrealizedPnl,
    availableBalance: paperBalance.available,
    usedMargin: paperBalance.used,
    unrealizedPnl,
    marginMode: "isolated",
    currency: "USDT",
  };
}

export function paperGetOrders(): PaperOrder[] {
  return Array.from(paperOrders.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function paperUpdateMarkPrice(symbol: string, markPrice: number): void {
  for (const pos of paperPositions.values()) {
    if (pos.symbol === symbol || pos.symbol.includes(symbol.split("/")[0])) {
      pos.markPrice = markPrice;
      if (pos.side === "long") {
        pos.unrealizedPnl = (markPrice - pos.entryPrice) * pos.contracts;
      } else {
        pos.unrealizedPnl = (pos.entryPrice - markPrice) * pos.contracts;
      }
    }
  }
}

export async function paperCreateOrder(
  input: FuturesOrderInput,
  currentPrice: number,
): Promise<FuturesOrderResult> {
  const id = nextPaperId();
  const symbol = input.symbol;
  const leverage = input.leverage ?? 1;
  const price = input.type === "market" ? currentPrice : (input.price ?? currentPrice);
  const margin = (input.amount * price) / leverage;

  if (margin > paperBalance.available) {
    return { success: false, orderId: null, price: null, amount: null, error: "Insufficient margin" };
  }

  // For market orders, fill immediately
  if (input.type === "market") {
    const side = input.side;
    const posSide: "long" | "short" = side === "buy" ? "long" : "short";

    // Check for existing position
    const existingKey = `${symbol}_${posSide}`;
    const existing = paperPositions.get(existingKey);

    if (existing && input.reduceOnly) {
      // Close/reduce position
      const closeAmount = Math.min(input.amount, existing.contracts);
      const pnl = posSide === "long"
        ? (price - existing.entryPrice) * closeAmount
        : (existing.entryPrice - price) * closeAmount;

      existing.contracts -= closeAmount;
      existing.realizedPnl += pnl;
      paperBalance.total += pnl;
      paperBalance.available += (existing.initialMargin * closeAmount) / (existing.contracts + closeAmount);
      paperBalance.used -= (existing.initialMargin * closeAmount) / (existing.contracts + closeAmount);

      if (existing.contracts <= 0) {
        paperPositions.delete(existingKey);
      }

      paperOrders.set(id, {
        id, symbol, side, type: input.type, amount: input.amount,
        price, reduceOnly: true, leverage, marginMode: input.marginMode ?? "isolated",
        status: "filled", filledAt: Date.now(), createdAt: Date.now(),
      });

      return { success: true, orderId: id, price, amount: closeAmount, status: "filled" };
    }

    // Open new position
    paperBalance.available -= margin;
    paperBalance.used += margin;

    // Calculate liquidation price
    const maintenanceMarginRate = 0.004;
    let liquidationPrice: number | null = null;
    if (posSide === "long") {
      liquidationPrice = price * (1 - 1 / leverage + maintenanceMarginRate);
    } else {
      liquidationPrice = price * (1 + 1 / leverage - maintenanceMarginRate);
    }

    const pos: PaperPosition = {
      id, symbol, side: posSide, contracts: input.amount,
      entryPrice: price, markPrice: price, leverage,
      marginMode: input.marginMode ?? "isolated",
      initialMargin: margin, unrealizedPnl: 0, realizedPnl: 0,
      liquidationPrice, tpPrice: input.tpPrice ?? null, slPrice: input.slPrice ?? null,
      createdAt: Date.now(),
    };

    if (existing) {
      // Average into existing position
      const totalContracts = existing.contracts + input.amount;
      existing.entryPrice = (existing.entryPrice * existing.contracts + price * input.amount) / totalContracts;
      existing.contracts = totalContracts;
      existing.initialMargin += margin;
      existing.markPrice = price;
    } else {
      paperPositions.set(existingKey, pos);
    }

    paperOrders.set(id, {
      id, symbol, side, type: input.type, amount: input.amount,
      price, reduceOnly: false, leverage, marginMode: input.marginMode ?? "isolated",
      status: "filled", filledAt: Date.now(), createdAt: Date.now(),
    });

    return { success: true, orderId: id, price, amount: input.amount, status: "filled" };
  }

  // Limit order — store as pending
  paperOrders.set(id, {
    id, symbol, side: input.side, type: "limit", amount: input.amount,
    price, reduceOnly: input.reduceOnly ?? false, leverage,
    marginMode: input.marginMode ?? "isolated",
    status: "open", filledAt: null, createdAt: Date.now(),
  });

  return { success: true, orderId: id, price, amount: input.amount, status: "open" };
}

export function paperClosePosition(
  symbol: string,
  side: "long" | "short",
  amount: number,
  currentPrice: number,
): FuturesOrderResult {
  const key = `${symbol}_${side}`;
  const pos = paperPositions.get(key);
  if (!pos) {
    return { success: false, orderId: null, price: null, amount: null, error: "No position found" };
  }

  const closeAmount = Math.min(amount, pos.contracts);
  const pnl = side === "long"
    ? (currentPrice - pos.entryPrice) * closeAmount
    : (pos.entryPrice - currentPrice) * closeAmount;

  pos.contracts -= closeAmount;
  pos.realizedPnl += pnl;
  paperBalance.total += pnl;
  paperBalance.available += (pos.initialMargin * closeAmount) / (pos.contracts + closeAmount || 1);
  paperBalance.used -= (pos.initialMargin * closeAmount) / (pos.contracts + closeAmount || 1);

  const id = nextPaperId();
  if (pos.contracts <= 0) {
    paperPositions.delete(key);
  }

  paperOrders.set(id, {
    id, symbol, side: side === "long" ? "sell" : "buy", type: "market",
    amount: closeAmount, price: currentPrice, reduceOnly: true,
    leverage: pos.leverage, marginMode: pos.marginMode,
    status: "filled", filledAt: Date.now(), createdAt: Date.now(),
  });

  return { success: true, orderId: id, price: currentPrice, amount: closeAmount, status: "filled" };
}

export function paperSetLeverage(
  symbol: string,
  leverage: number,
  marginMode: "isolated" | "cross",
): { success: boolean; error?: string } {
  if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) {
    return { success: false, error: "leverage must be between 1 and 125" };
  }
  // Update all positions for this symbol
  for (const pos of paperPositions.values()) {
    if (pos.symbol === symbol || pos.symbol.includes(symbol.split("/")[0])) {
      pos.leverage = leverage;
      pos.marginMode = marginMode;
    }
  }
  return { success: true };
}
