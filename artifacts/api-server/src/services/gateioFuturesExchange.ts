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
  // Advanced order type fields
  orderType?: string;
  triggerPrice?: number;
  triggerDirection?: "above" | "below";
  trailingOffsetPct?: number;
  trailingActivationPrice?: number;
  twapNumSlices?: number;
  twapIntervalSec?: number;
  scaledMinPrice?: number;
  scaledMaxPrice?: number;
  scaledNumOrders?: number;
  chaseOffsetTicks?: number;
  postOnly?: boolean;
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

type PaperOrderType = "market" | "limit" | "trigger" | "trailing_stop" | "post_only" | "twap" | "scaled" | "chase_limit";

interface PaperOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: PaperOrderType;
  amount: number;
  price: number | null;
  reduceOnly: boolean;
  leverage: number;
  marginMode: "isolated" | "cross";
  status: "open" | "filled" | "cancelled";
  filledAt: number | null;
  createdAt: number;
  // Extended fields for advanced order types
  triggerPrice?: number;
  triggerDirection?: "above" | "below";
  trailingActivationPrice?: number;
  trailingOffsetPct?: number;
  trailingHighWater?: number;
  trailingActivated?: boolean;
  // TWAP
  twapTotalMargin?: number;
  twapNumSlices?: number;
  twapIntervalMs?: number;
  twapSliceIndex?: number;
  twapSliceMargin?: number;
  twapExecutedSlices?: number;
  // Scaled
  scaledMinPrice?: number;
  scaledMaxPrice?: number;
  scaledNumOrders?: number;
  // Chase Limit
  chaseOffsetTicks?: number;
  // Notification helpers
  orderLabel?: string;
}

const paperPositions = new Map<string, PaperPosition>();
const paperOrders = new Map<string, PaperOrder>(); // All orders (filled, cancelled, and open)
const paperOpenOrders = new Map<string, PaperOrder>(); // Pending open orders awaiting execution
const paperBalance = { total: 10000, available: 10000, used: 0, unrealizedPnl: 0 };

// TWAP slice timers — keyed by orderId
const twapTimers = new Map<string, ReturnType<typeof setInterval>>();

let paperIdCounter = 0;
function nextPaperId(): string { return `paper_${Date.now()}_${++paperIdCounter}`; }

// ── Internal: fill a paper market order into a position ────────────────────
function fillPaperMarketOrder(order: PaperOrder, price: number): FuturesOrderResult {
  const posSide: "long" | "short" = order.side === "buy" ? "long" : "short";
  const existingKey = `${order.symbol}_${posSide}`;
  const existing = paperPositions.get(existingKey);

  if (existing && order.reduceOnly) {
    const closeAmount = Math.min(order.amount, existing.contracts);
    const pnl = posSide === "long"
      ? (price - existing.entryPrice) * closeAmount
      : (existing.entryPrice - price) * closeAmount;
    const marginReturned = existing.contracts > 0 ? (existing.initialMargin * closeAmount) / existing.contracts : 0;
    existing.contracts -= closeAmount;
    existing.realizedPnl += pnl;
    paperBalance.total += pnl;
    paperBalance.available += marginReturned;
    paperBalance.used -= marginReturned;
    if (existing.contracts <= 0) paperPositions.delete(existingKey);
  } else {
    const margin = (order.amount * price) / order.leverage;
    if (margin > paperBalance.available) {
      order.status = "cancelled";
      return { success: false, orderId: order.id, price: null, amount: null, error: "Insufficient margin" };
    }
    paperBalance.available -= margin;
    paperBalance.used += margin;
    const maintenanceMarginRate = 0.004;
    let liquidationPrice: number | null = null;
    if (posSide === "long") liquidationPrice = price * (1 - 1 / order.leverage + maintenanceMarginRate);
    else liquidationPrice = price * (1 + 1 / order.leverage - maintenanceMarginRate);

    if (existing) {
      const totalContracts = existing.contracts + order.amount;
      existing.entryPrice = (existing.entryPrice * existing.contracts + price * order.amount) / totalContracts;
      existing.contracts = totalContracts;
      existing.initialMargin += margin;
      existing.markPrice = price;
    } else {
      paperPositions.set(existingKey, {
        id: order.id, symbol: order.symbol, side: posSide, contracts: order.amount,
        entryPrice: price, markPrice: price, leverage: order.leverage,
        marginMode: order.marginMode, initialMargin: margin,
        unrealizedPnl: 0, realizedPnl: 0, liquidationPrice,
        tpPrice: null, slPrice: null, createdAt: Date.now(),
      });
    }
  }

  order.status = "filled";
  order.filledAt = Date.now();
  order.price = price;
  paperOrders.set(order.id, order);
  paperOpenOrders.delete(order.id);
  return { success: true, orderId: order.id, price, amount: order.amount, status: "filled" };
}

// ── Internal: evaluate pending open orders against current market data ─────
export function paperEvaluatePendingOrders(markPrice: number, bestBid: number, bestAsk: number): void {
  const toFill: { order: PaperOrder; fillPrice: number }[] = [];

  for (const order of paperOpenOrders.values()) {
    if (order.status !== "open") continue;

    switch (order.type) {
      case "limit": {
        if (order.side === "buy" && bestAsk <= (order.price ?? Infinity)) {
          toFill.push({ order, fillPrice: order.price! });
        } else if (order.side === "sell" && bestBid >= (order.price ?? 0)) {
          toFill.push({ order, fillPrice: order.price! });
        }
        break;
      }
      case "trigger": {
        const tp = order.triggerPrice ?? 0;
        if (tp <= 0) break;
        const crossed = order.triggerDirection === "above"
          ? markPrice >= tp
          : markPrice <= tp;
        if (crossed) {
          // Execute as market order at current mark price
          toFill.push({ order, fillPrice: markPrice });
        }
        break;
      }
      case "trailing_stop": {
        const activation = order.trailingActivationPrice ?? 0;
        const offsetPct = order.trailingOffsetPct ?? 1;
        if (activation <= 0) break;
        // Track high/low watermark
        if (order.side === "buy") {
          // Short trailing stop: activates when price rises above activation, triggers when price drops from high by offset%
          if (!order.trailingActivated) {
            if (markPrice >= activation) {
              order.trailingActivated = true;
              order.trailingHighWater = markPrice;
            }
          }
          if (order.trailingActivated) {
            if (markPrice > (order.trailingHighWater ?? 0)) order.trailingHighWater = markPrice;
            const triggerLevel = (order.trailingHighWater ?? markPrice) * (1 - offsetPct / 100);
            if (markPrice <= triggerLevel) {
              toFill.push({ order, fillPrice: markPrice });
            }
          }
        } else {
          // Long trailing stop: activates when price drops below activation, triggers when price rises from low by offset%
          if (!order.trailingActivated) {
            if (markPrice <= activation) {
              order.trailingActivated = true;
              order.trailingHighWater = markPrice;
            }
          }
          if (order.trailingActivated) {
            if (markPrice < (order.trailingHighWater ?? Infinity)) order.trailingHighWater = markPrice;
            const triggerLevel = (order.trailingHighWater ?? markPrice) * (1 + offsetPct / 100);
            if (markPrice >= triggerLevel) {
              toFill.push({ order, fillPrice: markPrice });
            }
          }
        }
        break;
      }
      case "post_only": {
        // Post-only = limit order that is cancelled if it would match immediately
        // In paper mode, if the price already crosses, reject it
        if (order.side === "buy" && bestAsk <= (order.price ?? Infinity)) {
          order.status = "cancelled";
          paperOrders.set(order.id, order);
          paperOpenOrders.delete(order.id);
        } else if (order.side === "sell" && bestBid >= (order.price ?? 0)) {
          order.status = "cancelled";
          paperOrders.set(order.id, order);
          paperOpenOrders.delete(order.id);
        }
        // Otherwise it stays open as a maker order
        break;
      }
      case "chase_limit": {
        // Auto-adjust limit price to best bid/ask + offset
        const offset = order.chaseOffsetTicks ?? 0;
        const tickSize = markPrice >= 100 ? 0.1 : markPrice >= 1 ? 0.001 : 0.00001;
        if (order.side === "buy") {
          order.price = bestBid + offset * tickSize;
        } else {
          order.price = bestAsk - offset * tickSize;
        }
        // Check if it can fill
        if (order.side === "buy" && bestAsk <= order.price) {
          toFill.push({ order, fillPrice: order.price });
        } else if (order.side === "sell" && bestBid >= order.price) {
          toFill.push({ order, fillPrice: order.price });
        }
        break;
      }
      case "twap": {
        // TWAP is handled by timer, not by price evaluation
        break;
      }
      case "scaled": {
        // Scaled orders are pre-created as individual limit orders, already in openOrders
        break;
      }
    }
  }

  // Execute all orders that should fill
  for (const { order, fillPrice } of toFill) {
    fillPaperMarketOrder(order, fillPrice);
  }
}

export function paperGetPositions(): FuturesPositionResult[] {
  return Array.from(paperPositions.values())
    .filter(p => p.contracts > 0)
    .map((p) => ({
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
  // Recalculate unrealized PnL from active positions only
  let unrealizedPnl = 0;
  for (const pos of paperPositions.values()) {
    if (pos.contracts <= 0) continue;
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

export function paperGetOpenOrders(): PaperOrder[] {
  return Array.from(paperOpenOrders.values())
    .filter(o => o.status === "open")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function paperCancelOpenOrder(orderId: string): { success: boolean; error?: string } {
  const order = paperOpenOrders.get(orderId);
  if (!order) return { success: false, error: "Order not found" };
  if (order.status !== "open") return { success: false, error: "Order is not open" };

  order.status = "cancelled";
  paperOrders.set(order.id, order);
  paperOpenOrders.delete(order.id);

  // Cancel TWAP timer if active
  const timer = twapTimers.get(orderId);
  if (timer) {
    clearInterval(timer);
    twapTimers.delete(orderId);
  }

  // Refund held margin for the order
  if (order.twapTotalMargin && order.twapSliceIndex != null && order.twapNumSlices) {
    const remainingSlices = order.twapNumSlices - (order.twapExecutedSlices ?? 0);
    const refundPerSlice = order.twapSliceMargin ?? (order.twapTotalMargin / order.twapNumSlices);
    const refund = remainingSlices * refundPerSlice;
    paperBalance.available += refund;
    paperBalance.used -= refund;
  } else {
    // Regular open order — refund the held margin
    const heldMargin = (order.amount * (order.price ?? 0)) / order.leverage;
    paperBalance.available += heldMargin;
    paperBalance.used -= heldMargin;
  }

  return { success: true };
}

export function paperUpdateMarkPrice(symbol: string, markPrice: number, bestBid?: number, bestAsk?: number): void {
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
  // Evaluate pending open orders against current price
  if (markPrice > 0) {
    paperEvaluatePendingOrders(markPrice, bestBid ?? markPrice, bestAsk ?? markPrice);
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
