/**
 * useOrderBook
 * ─────────────────────────────────────────────────────────────────────────────
 * Polls Binance order book depth every 2 seconds.
 * Falls back to mock data when API not connected.
 * Computes liquidity zones, absorption events, and sniper entries.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { OrderBook, LiquidityZone, SniperEntry } from "../types/crypto";
import { CoinPrice } from "../types/crypto";
import { fetchOrderBook, fetchRecentTrades, hasValidBinanceKeys } from "../services/binance";
import {
  parseOrderBook,
  detectLiquidityZones,
  detectAbsorption,
  generateSniperEntries,
  generateMockOrderBook,
  generateMockTrades,
  computeOrderBookImbalance,
  findLargestWall,
  depthAtPercent,
} from "../utils/liquidity";

const POLL_INTERVAL   = 2500;  // ms between real API polls
const MOCK_INTERVAL   = 1800;  // ms between mock refreshes

export interface OrderBookAnalytics {
  imbalance:   number;          // 0–100, >50 = bid heavy
  largestWall: ReturnType<typeof findLargestWall>;
  depth1pct:   { bidDepth: number; askDepth: number };
  depth2pct:   { bidDepth: number; askDepth: number };
  totalBidVol: number;
  totalAskVol: number;
}

export interface UseOrderBookReturn {
  selectedSymbol:  string;
  setSymbol:       (s: string) => void;
  orderBook:       OrderBook | null;
  zones:           LiquidityZone[];
  snipers:         SniperEntry[];
  analytics:       OrderBookAnalytics | null;
  isLoading:       boolean;
  isLive:          boolean;
  error:           string | null;
  lastUpdate:      Date;
}

const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE"];

export function useOrderBook(prices: CoinPrice[]): UseOrderBookReturn {
  const [selectedSymbol, setSelectedSymbol] = useState("BTC");
  const [orderBook,  setOrderBook]          = useState<OrderBook | null>(null);
  const [zones,      setZones]              = useState<LiquidityZone[]>([]);
  const [snipers,    setSnipers]            = useState<SniperEntry[]>([]);
  const [analytics,  setAnalytics]          = useState<OrderBookAnalytics | null>(null);
  const [isLoading,  setIsLoading]          = useState(true);
  const [isLive,     setIsLive]             = useState(false);
  const [error,      setError]              = useState<string | null>(null);
  const [lastUpdate, setLastUpdate]         = useState(new Date());

  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFetchingRef = useRef(false);

  const getCurrentPrice = useCallback(
    (symbol: string) => prices.find((p) => p.symbol === symbol)?.price ?? 0,
    [prices]
  );

  const getSparkline = useCallback(
    (symbol: string) => prices.find((p) => p.symbol === symbol)?.sparkline ?? [],
    [prices]
  );

  // ── Process order book data → zones, snipers, analytics ─────────────────
  const processBook = useCallback(
    (book: OrderBook, sparkline: number[]) => {
      const currentPrice = book.midPrice;

      // Detect liquidity zones
      const liqZones = detectLiquidityZones(book, sparkline, currentPrice);
      setZones(liqZones);

      // Sniper entries
      const snipeEntries = generateSniperEntries(book.symbol, liqZones, book, sparkline);
      setSnipers(snipeEntries);

      // Analytics
      setAnalytics({
        imbalance:   computeOrderBookImbalance(book),
        largestWall: findLargestWall(book),
        depth1pct:   depthAtPercent(book, 1),
        depth2pct:   depthAtPercent(book, 2),
        totalBidVol: book.bids.reduce((s, l) => s + l.total, 0),
        totalAskVol: book.asks.reduce((s, l) => s + l.total, 0),
      });

      setLastUpdate(new Date());
    },
    []
  );

  // ── Real Binance fetch ───────────────────────────────────────────────────
  const fetchReal = useCallback(
    async (symbol: string) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      try {
        const [rawBook, trades] = await Promise.all([
          fetchOrderBook(symbol, 50),
          fetchRecentTrades(symbol, 100).catch(() => []),
        ]);

        const currentPrice = getCurrentPrice(symbol);
        const sparkline    = getSparkline(symbol);
        const book         = parseOrderBook(symbol, rawBook, currentPrice || rawBook.bids[0] ? parseFloat(rawBook.bids[0][0]) : 0);

        // Absorptions from real trades
        const absorptions = detectAbsorption(trades, book.midPrice);
        const allZones    = detectLiquidityZones(book, sparkline, book.midPrice);
        const merged      = [...allZones, ...absorptions]
          .sort((a, b) => b.strength - a.strength)
          .slice(0, 12);

        setOrderBook(book);
        setZones(merged);
        setSnipers(generateSniperEntries(symbol, merged, book, sparkline));
        setAnalytics({
          imbalance:   computeOrderBookImbalance(book),
          largestWall: findLargestWall(book),
          depth1pct:   depthAtPercent(book, 1),
          depth2pct:   depthAtPercent(book, 2),
          totalBidVol: book.bids.reduce((s, l) => s + l.total, 0),
          totalAskVol: book.asks.reduce((s, l) => s + l.total, 0),
        });

        setIsLive(true);
        setError(null);
        setLastUpdate(new Date());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setIsLive(false);
        // Fall back to mock on error
        fetchMock(symbol);
      } finally {
        isFetchingRef.current = false;
        setIsLoading(false);
      }
    },
    [getCurrentPrice, getSparkline, processBook]
  );

  // ── Mock data generation ─────────────────────────────────────────────────
  const fetchMock = useCallback(
    (symbol: string) => {
      const price     = getCurrentPrice(symbol) || 67000;
      const sparkline = getSparkline(symbol);
      const rawBook   = generateMockOrderBook(symbol, price);
      const book      = parseOrderBook(symbol, rawBook, price);
      const trades    = generateMockTrades(price);
      const absorb    = detectAbsorption(trades, price);
      const liqZones  = detectLiquidityZones(book, sparkline, price);
      const merged    = [...liqZones, ...absorb]
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 12);

      setOrderBook(book);
      processBook(book, sparkline);
      setZones(merged);
      setSnipers(generateSniperEntries(symbol, merged, book, sparkline));
      setAnalytics({
        imbalance:   computeOrderBookImbalance(book),
        largestWall: findLargestWall(book),
        depth1pct:   depthAtPercent(book, 1),
        depth2pct:   depthAtPercent(book, 2),
        totalBidVol: book.bids.reduce((s, l) => s + l.total, 0),
        totalAskVol: book.asks.reduce((s, l) => s + l.total, 0),
      });
      setIsLoading(false);
    },
    [getCurrentPrice, getSparkline, processBook]
  );

  // ── Poll loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsLoading(true);

    const tick = () => {
      if (hasValidBinanceKeys) {
        fetchReal(selectedSymbol);
      } else {
        fetchMock(selectedSymbol);
      }
    };

    tick(); // immediate first call
    intervalRef.current = setInterval(tick, hasValidBinanceKeys ? POLL_INTERVAL : MOCK_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [selectedSymbol, fetchReal, fetchMock]);

  // ── Re-run mock when prices change (live price tick → refresh zones) ────
  useEffect(() => {
    if (!isLive && !isLoading) {
      fetchMock(selectedSymbol);
    }
  }, [prices]);

  return {
    selectedSymbol,
    setSymbol:  setSelectedSymbol,
    orderBook,
    zones,
    snipers,
    analytics,
    isLoading,
    isLive,
    error,
    lastUpdate,
  };
}

export { SYMBOLS };
