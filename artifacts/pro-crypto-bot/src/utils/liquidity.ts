/**
 * Liquidity Zone & Sniper Entry Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Processes raw order book depth data to identify:
 *   • Bid/ask walls (large resting orders = liquidity)
 *   • Support & resistance zones (clustered liquidity bands)
 *   • Supply & demand imbalances
 *   • Absorption events (large orders being filled)
 *   • Sniper entry setups (optimal entries near liquidity zones)
 */

import { OrderBook, OrderBookLevel, LiquidityZone, SniperEntry, ZoneType } from "../types/crypto";
import { BinanceOrderBookRaw, BinanceRecentTrade } from "../services/binance";

// ─── Config ──────────────────────────────────────────────────────────────────

const WALL_MULTIPLIER     = 4.0;   // qty must be Nx average to be a wall
const ZONE_BAND_PCT       = 0.003; // 0.3% band around each zone level
const MIN_ZONE_STRENGTH   = 20;    // minimum strength to surface a zone
const SNIPER_MAX_DISTANCE = 0.02;  // sniper only arms within 2% of current price

// ─── Order Book Parser ────────────────────────────────────────────────────────

/**
 * Parse raw Binance order book into typed OrderBook with wall detection.
 */
export function parseOrderBook(
  symbol: string,
  raw: BinanceOrderBookRaw,
  currentPrice: number
): OrderBook {
  const parseLevels = (
    levels: [string, string][],
    side: "bid" | "ask"
  ): OrderBookLevel[] => {
    const parsed = levels.map(([p, q]) => ({
      price:    parseFloat(p),
      quantity: parseFloat(q),
      total:    parseFloat(p) * parseFloat(q),
      isWall:   false,
      depth:    0,
    }));

    // compute average qty for wall detection
    const avgQty = parsed.reduce((s, l) => s + l.quantity, 0) / (parsed.length || 1);
    const wallThreshold = avgQty * WALL_MULTIPLIER;
    const maxTotal = Math.max(...parsed.map((l) => l.total), 1);

    return parsed
      .map((l) => ({
        ...l,
        isWall: l.quantity >= wallThreshold,
        depth:  l.total / maxTotal,
      }))
      .sort((a, b) => side === "bid" ? b.price - a.price : a.price - b.price);
  };

  const bids = parseLevels(raw.bids, "bid");
  const asks = parseLevels(raw.asks, "ask");

  const bestBid  = bids[0]?.price ?? currentPrice * 0.999;
  const bestAsk  = asks[0]?.price ?? currentPrice * 1.001;
  const spread    = bestAsk - bestBid;
  const midPrice  = (bestBid + bestAsk) / 2;
  const spreadPct = (spread / midPrice) * 100;

  return {
    symbol,
    bids,
    asks,
    spread,
    spreadPct,
    midPrice,
    timestamp:    new Date(),
    lastUpdateId: raw.lastUpdateId,
  };
}

// ─── Liquidity Zone Detection ─────────────────────────────────────────────────

/**
 * Detect liquidity zones from parsed order book levels.
 * Returns zones sorted by strength descending.
 */
export function detectLiquidityZones(
  book: OrderBook,
  sparkline: number[],
  currentPrice: number
): LiquidityZone[] {
  const zones: LiquidityZone[] = [];
  let idCounter = 0;

  // ── Helper: create a zone from a level cluster ────────────────────────────
  const makeZone = (
    type: ZoneType,
    midPrice: number,
    volume: number,
    strength: number,
    touchCount = 1
  ): LiquidityZone => {
    const bandHalf = midPrice * ZONE_BAND_PCT;
    const distPct  = Math.abs(currentPrice - midPrice) / currentPrice;
    return {
      id:         `zone_${++idCounter}`,
      type,
      priceHigh:  midPrice + bandHalf,
      priceLow:   midPrice - bandHalf,
      midPrice,
      strength:   Math.min(Math.round(strength), 100),
      volume,
      touchCount,
      isActive:   distPct < 0.015,  // within 1.5% of current price
      label:      buildZoneLabel(type, strength),
    };
  };

  // ── Bid walls → demand / support zones ───────────────────────────────────
  const bidWalls = book.bids.filter((l) => l.isWall).slice(0, 5);
  for (const wall of bidWalls) {
    const avgBidTotal = book.bids.reduce((s, l) => s + l.total, 0) / (book.bids.length || 1);
    const strength    = Math.min((wall.total / avgBidTotal) * 25, 100);
    if (strength < MIN_ZONE_STRENGTH) continue;

    const type: ZoneType = wall.price < currentPrice ? "demand" : "support";
    zones.push(makeZone(type, wall.price, wall.total, strength, 1));
  }

  // ── Ask walls → supply / resistance zones ────────────────────────────────
  const askWalls = book.asks.filter((l) => l.isWall).slice(0, 5);
  for (const wall of askWalls) {
    const avgAskTotal = book.asks.reduce((s, l) => s + l.total, 0) / (book.asks.length || 1);
    const strength    = Math.min((wall.total / avgAskTotal) * 25, 100);
    if (strength < MIN_ZONE_STRENGTH) continue;

    const type: ZoneType = wall.price > currentPrice ? "supply" : "resistance";
    zones.push(makeZone(type, wall.price, wall.total, strength, 1));
  }

  // ── Sparkline price cluster zones (historical S/R) ─────────────────────
  if (sparkline.length >= 10) {
    const priceMin  = Math.min(...sparkline);
    const priceMax  = Math.max(...sparkline);
    const range     = priceMax - priceMin || 1;
    const buckets   = 10;
    const bucketSize = range / buckets;

    type Bucket = { total: number; count: number; price: number };
    const histo: Bucket[] = Array.from({ length: buckets }, (_, i) => ({
      price: priceMin + bucketSize * (i + 0.5),
      total: 0,
      count: 0,
    }));

    for (const price of sparkline) {
      const idx = Math.min(Math.floor((price - priceMin) / bucketSize), buckets - 1);
      histo[idx].total += price;
      histo[idx].count++;
    }

    for (const bucket of histo) {
      if (bucket.count < 2) continue;
      const touchCount = bucket.count;
      const strength   = Math.min(touchCount * 12, 80);
      if (strength < MIN_ZONE_STRENGTH) continue;
      const type: ZoneType = bucket.price < currentPrice ? "support" : "resistance";
      zones.push(makeZone(type, bucket.price, bucket.total * 1000, strength, touchCount));
    }
  }

  // ── Deduplicate overlapping zones ────────────────────────────────────────
  const deduped = deduplicateZones(zones, currentPrice);

  return deduped.sort((a, b) => b.strength - a.strength).slice(0, 12);
}

function buildZoneLabel(type: ZoneType, strength: number): string {
  const level = strength >= 75 ? "Major" : strength >= 50 ? "Key" : "Minor";
  switch (type) {
    case "demand":     return `${level} Demand Zone`;
    case "supply":     return `${level} Supply Zone`;
    case "support":    return `${level} Support`;
    case "resistance": return `${level} Resistance`;
    case "absorption": return `${level} Absorption`;
  }
}

function deduplicateZones(zones: LiquidityZone[], _price: number): LiquidityZone[] {
  const out: LiquidityZone[] = [];
  for (const zone of zones) {
    const overlap = out.find(
      (z) =>
        Math.abs(z.midPrice - zone.midPrice) / zone.midPrice < ZONE_BAND_PCT * 3
    );
    if (overlap) {
      // Keep the stronger one
      if (zone.strength > overlap.strength) {
        out.splice(out.indexOf(overlap), 1, zone);
      }
    } else {
      out.push(zone);
    }
  }
  return out;
}

// ─── Absorption Detection (from recent trades) ───────────────────────────────

/**
 * Detect absorption events — large trades that got filled without moving price much.
 * An absorption zone is where big sellers/buyers are absorbing opposite pressure.
 */
export function detectAbsorption(
  trades: BinanceRecentTrade[],
  currentPrice: number
): LiquidityZone[] {
  if (trades.length < 10) return [];

  const avgQuoteQty =
    trades.reduce((s, t) => s + parseFloat(t.quoteQty), 0) / trades.length;
  const bigTrades = trades.filter(
    (t) => parseFloat(t.quoteQty) > avgQuoteQty * 5
  );

  return bigTrades.slice(0, 3).map((t, i) => {
    const price     = parseFloat(t.price);
    const quoteQty  = parseFloat(t.quoteQty);
    const strength  = Math.min(Math.round((quoteQty / avgQuoteQty) * 8), 100);
    const bandHalf  = price * ZONE_BAND_PCT;
    const distPct   = Math.abs(currentPrice - price) / currentPrice;
    return {
      id:         `absorb_${i}`,
      type:       "absorption" as ZoneType,
      priceHigh:  price + bandHalf,
      priceLow:   price - bandHalf,
      midPrice:   price,
      strength,
      volume:     quoteQty,
      touchCount: 1,
      isActive:   distPct < 0.01,
      label:      t.isBuyerMaker
        ? `Sell Absorption $${price.toFixed(2)}`
        : `Buy Absorption $${price.toFixed(2)}`,
    };
  });
}

// ─── Sniper Entry Generator ───────────────────────────────────────────────────

/**
 * Generate sniper entry setups from detected liquidity zones.
 * A sniper entry is a precise limit order entry near a high-probability zone.
 */
export function generateSniperEntries(
  symbol: string,
  zones: LiquidityZone[],
  book: OrderBook,
  sparkline: number[]
): SniperEntry[] {
  const entries: SniperEntry[] = [];
  const currentPrice = book.midPrice;
  const atrApprox    = computeApproxATR(sparkline) || currentPrice * 0.005;

  // Only arm snipers within SNIPER_MAX_DISTANCE of current price
  const nearZones = zones.filter((z) => {
    const dist = Math.abs(z.midPrice - currentPrice) / currentPrice;
    return dist < SNIPER_MAX_DISTANCE && z.strength >= 35;
  });

  for (const zone of nearZones.slice(0, 6)) {
    const isBuyZone = zone.type === "demand" || zone.type === "support" || zone.type === "absorption";
    const side: "BUY" | "SELL" = isBuyZone ? "BUY" : "SELL";

    if (side === "BUY") {
      const entryPrice  = zone.priceLow + (zone.priceHigh - zone.priceLow) * 0.3; // 30% into zone
      const stopLoss    = zone.priceLow - atrApprox * 1.5;
      const riskPts     = entryPrice - stopLoss;
      const targetPrice = entryPrice + riskPts * 2.5; // 2.5R target
      const riskReward  = riskPts > 0 ? (targetPrice - entryPrice) / riskPts : 0;
      const confidence  = computeSniperConfidence(zone, book, side, sparkline);

      if (riskReward < 1.5) continue; // skip bad R:R

      entries.push({
        id:          `sniper_${zone.id}_buy`,
        symbol,
        side:        "BUY",
        entryPrice,
        targetPrice,
        stopLoss,
        riskReward,
        confidence,
        zone,
        status:      "ARMED",
        reason:      buildSniperReason(zone, side, riskReward, book),
        indicators:  buildSniperIndicators(zone, book, sparkline, side),
        timestamp:   new Date(),
        expiresAt:   new Date(Date.now() + 4 * 60 * 60 * 1000), // 4h expiry
      });
    } else {
      const entryPrice  = zone.priceHigh - (zone.priceHigh - zone.priceLow) * 0.3;
      const stopLoss    = zone.priceHigh + atrApprox * 1.5;
      const riskPts     = stopLoss - entryPrice;
      const targetPrice = entryPrice - riskPts * 2.5;
      const riskReward  = riskPts > 0 ? (entryPrice - targetPrice) / riskPts : 0;
      const confidence  = computeSniperConfidence(zone, book, side, sparkline);

      if (riskReward < 1.5) continue;

      entries.push({
        id:          `sniper_${zone.id}_sell`,
        symbol,
        side:        "SELL",
        entryPrice,
        targetPrice,
        stopLoss,
        riskReward,
        confidence,
        zone,
        status:      "ARMED",
        reason:      buildSniperReason(zone, side, riskReward, book),
        indicators:  buildSniperIndicators(zone, book, sparkline, side),
        timestamp:   new Date(),
        expiresAt:   new Date(Date.now() + 4 * 60 * 60 * 1000),
      });
    }
  }

  return entries.sort((a, b) => b.confidence - a.confidence);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeApproxATR(sparkline: number[]): number {
  if (sparkline.length < 2) return 0;
  const slice = sparkline.slice(-14);
  const raw = slice.reduce((s, v, i) => {
    if (i === 0) return s;
    return s + Math.abs(v - slice[i - 1]!);
  }, 0) / (slice.length - 1);
  // Phase 12.1: reject implausible ATR — return 0 to trigger the
  // caller's fallback (currentPrice * 0.005) instead of a bad value.
  const lastPrice = slice[slice.length - 1] ?? 0;
  if (lastPrice > 0 && raw / lastPrice > 0.20) return 0;
  return raw;
}

function computeSniperConfidence(
  zone: LiquidityZone,
  book: OrderBook,
  side: "BUY" | "SELL",
  sparkline: number[]
): number {
  let score = zone.strength * 0.4; // zone strength up to 40pts

  // Spread health (tight spread = more liquid = higher confidence)
  const spreadScore = Math.max(0, 20 - book.spreadPct * 100);
  score += spreadScore;

  // Touch count bonus
  score += Math.min(zone.touchCount * 5, 15);

  // Trend alignment bonus
  if (sparkline.length >= 5) {
    const recent = sparkline.slice(-5);
    const isTrendingUp = recent[recent.length - 1] > recent[0];
    if ((side === "BUY" && isTrendingUp) || (side === "SELL" && !isTrendingUp)) {
      score += 15;
    }
  }

  // Wall presence bonus (deeper liquidity)
  const walls = side === "BUY" ? book.bids.filter((b) => b.isWall) : book.asks.filter((a) => a.isWall);
  if (walls.length > 0) score += 10;

  return Math.min(Math.round(score), 100);
}

function buildSniperReason(
  zone: LiquidityZone,
  side: "BUY" | "SELL",
  rr: number,
  book: OrderBook
): string {
  const action = side === "BUY" ? "buying" : "selling";
  const zoneDesc = zone.label;
  const rrStr  = rr.toFixed(1);
  const wallCnt = side === "BUY"
    ? book.bids.filter((b) => b.isWall).length
    : book.asks.filter((a) => a.isWall).length;

  return `Precision ${action} opportunity at ${zoneDesc}. ` +
    `${wallCnt > 0 ? `${wallCnt} liquidity wall${wallCnt > 1 ? "s" : ""} detected below. ` : ""}` +
    `${zone.touchCount > 1 ? `Zone tested ${zone.touchCount}× on sparkline. ` : ""}` +
    `R:R = ${rrStr}:1. Spread: ${book.spreadPct.toFixed(3)}%.`;
}

function buildSniperIndicators(
  zone: LiquidityZone,
  book: OrderBook,
  sparkline: number[],
  side: "BUY" | "SELL"
): string[] {
  const indicators: string[] = [];

  indicators.push(`${zone.label} (strength ${zone.strength}%)`);

  const walls = side === "BUY" ? book.bids.filter((b) => b.isWall) : book.asks.filter((a) => a.isWall);
  if (walls.length > 0) {
    const wallVol = walls.reduce((s, w) => s + w.total, 0);
    indicators.push(`${walls.length} order wall${walls.length > 1 ? "s" : ""} ($${(wallVol / 1000).toFixed(0)}K)`);
  }

  if (zone.touchCount > 1) {
    indicators.push(`Tested ${zone.touchCount}× historically`);
  }

  if (sparkline.length >= 5) {
    const recent   = sparkline.slice(-5);
    const trendUp  = recent[recent.length - 1] > recent[0];
    indicators.push(trendUp ? "Short-term uptrend" : "Short-term downtrend");
  }

  const imbalance = computeOrderBookImbalance(book);
  if (imbalance > 60) indicators.push(`Buy-side imbalance ${imbalance.toFixed(0)}%`);
  if (imbalance < 40) indicators.push(`Sell-side imbalance ${(100 - imbalance).toFixed(0)}%`);

  return indicators;
}

// ─── Order Book Analytics ─────────────────────────────────────────────────────

/**
 * Compute bid/ask imbalance percentage.
 * >50 = more buying pressure, <50 = more selling pressure.
 */
export function computeOrderBookImbalance(book: OrderBook): number {
  const bidVol = book.bids.slice(0, 10).reduce((s, l) => s + l.total, 0);
  const askVol = book.asks.slice(0, 10).reduce((s, l) => s + l.total, 0);
  const total  = bidVol + askVol;
  if (total === 0) return 50;
  return (bidVol / total) * 100;
}

/**
 * Find the largest single resting wall in bids or asks.
 */
export function findLargestWall(book: OrderBook): { side: "bid" | "ask"; level: OrderBookLevel } | null {
  const allWalls = [
    ...book.bids.filter((b) => b.isWall).map((b) => ({ side: "bid" as const, level: b })),
    ...book.asks.filter((a) => a.isWall).map((a) => ({ side: "ask" as const, level: a })),
  ];
  if (allWalls.length === 0) return null;
  return allWalls.reduce((max, w) => w.level.total > max.level.total ? w : max);
}

/**
 * Compute cumulative depth at a given % away from mid.
 */
export function depthAtPercent(book: OrderBook, pct: number): { bidDepth: number; askDepth: number } {
  const low  = book.midPrice * (1 - pct / 100);
  const high = book.midPrice * (1 + pct / 100);
  const bidDepth = book.bids.filter((b) => b.price >= low).reduce((s, b) => s + b.total, 0);
  const askDepth = book.asks.filter((a) => a.price <= high).reduce((s, a) => s + a.total, 0);
  return { bidDepth, askDepth };
}

// ─── Mock Order Book (fallback when no real API) ──────────────────────────────

/**
 * Generate a realistic mock order book for a given coin price.
 * Used when Binance API is not connected.
 */
export function generateMockOrderBook(_symbol: string, price: number): BinanceOrderBookRaw {
  const levels = 30;
  const bids: [string, string][] = [];
  const asks: [string, string][] = [];
  const tickSize = price < 1 ? 0.0001 : price < 10 ? 0.001 : price < 100 ? 0.01 : price < 1000 ? 0.1 : 1;

  for (let i = 0; i < levels; i++) {
    const bidPrice = price - tickSize * (i + 1) * (1 + Math.random() * 0.5);
    const askPrice = price + tickSize * (i + 1) * (1 + Math.random() * 0.5);

    // Random base qty with occasional walls
    const isWall  = i > 2 && Math.random() < 0.12;
    const baseQty = (1 / price) * (Math.random() * 50_000 + 5_000);
    const wallMul = isWall ? 6 + Math.random() * 8 : 1;

    bids.push([bidPrice.toFixed(price < 1 ? 4 : 2), (baseQty * wallMul).toFixed(4)]);
    asks.push([askPrice.toFixed(price < 1 ? 4 : 2), (baseQty * wallMul * (Math.random() < 0.12 ? 7 : 1)).toFixed(4)]);
  }

  // Seed at least one big wall on each side
  const bigWallIdx = 4 + Math.floor(Math.random() * 5);
  const bigQty     = (1 / price) * 800_000;
  bids[bigWallIdx] = [bids[bigWallIdx][0], bigQty.toFixed(4)];
  asks[bigWallIdx] = [asks[bigWallIdx][0], bigQty.toFixed(4)];

  return { lastUpdateId: Date.now(), bids, asks };
}

/**
 * Generate mock recent trades for absorption detection fallback.
 */
export function generateMockTrades(price: number): BinanceRecentTrade[] {
  return Array.from({ length: 50 }, (_, i) => {
    const tradePrice = price * (1 + (Math.random() - 0.5) * 0.002);
    const qty        = (Math.random() < 0.1 ? 5 + Math.random() * 10 : Math.random() * 0.5 + 0.01);
    return {
      id:           i,
      price:        tradePrice.toFixed(2),
      qty:          qty.toFixed(4),
      quoteQty:     (tradePrice * qty).toFixed(2),
      time:         Date.now() - i * 1200,
      isBuyerMaker: Math.random() < 0.5,
    };
  });
}
