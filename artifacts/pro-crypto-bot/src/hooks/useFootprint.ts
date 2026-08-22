/**
 * useFootprint — Live footprint chart data hook
 * Polls Binance recent trades to build real footprint candles.
 * Falls back to generated mock data when no API keys.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { CoinPrice } from "../types/crypto";
import { fetchRecentTrades, hasValidBinanceKeys } from "../services/binance";
import {
  FootprintData,
  FootprintCandle,
  TradeEvent,
  buildFootprintCandle,
  generateMockFootprint,
  detectDeltaDivergence,
  findAbsorptionZones,
  cvdTrend,
} from "../utils/footprint";

export interface FootprintAnalytics {
  cvdTrend:      "bullish" | "bearish" | "flat";
  divergence:    { type: "bearish" | "bullish" | "none"; strength: number };
  absorptionZones: FootprintCandle[];
  buyPressure:   number;   // 0–100
  sellPressure:  number;   // 0–100
  deltaBias:     "buying" | "selling" | "balanced";
}

export interface UseFootprintReturn {
  selectedSymbol: string;
  setSymbol:      (s: string) => void;
  footprint:      FootprintData | null;
  analytics:      FootprintAnalytics | null;
  isLoading:      boolean;
  isLive:         boolean;
  lastUpdate:     Date;
}

const POLL_INTERVAL = 5000;  // 5s — trades endpoint
const MOCK_INTERVAL = 3000;

export function useFootprint(prices: CoinPrice[]): UseFootprintReturn {
  const [selectedSymbol, setSelectedSymbol] = useState("BTC");
  const [footprint,   setFootprint]         = useState<FootprintData | null>(null);
  const [analytics,   setAnalytics]         = useState<FootprintAnalytics | null>(null);
  const [isLoading,   setIsLoading]         = useState(true);
  const [isLive,      setIsLive]            = useState(false);
  const [lastUpdate,  setLastUpdate]        = useState(new Date());

  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const tradeBufferRef = useRef<TradeEvent[]>([]);
  const candlesRef    = useRef<FootprintCandle[]>([]);
  const cvdRef        = useRef(0);

  const getSparkline = useCallback(
    (symbol: string) => prices.find((p) => p.symbol === symbol)?.sparkline ?? [],
    [prices]
  );

  const computeAnalytics = useCallback((data: FootprintData): FootprintAnalytics => {
    const candles = data.candles;
    const totalBuyVol  = candles.reduce((s, c) =>
      s + c.clusters.reduce((cs, cl) => cs + cl.askVol, 0), 0);
    const totalSellVol = candles.reduce((s, c) =>
      s + c.clusters.reduce((cs, cl) => cs + cl.bidVol, 0), 0);
    const totalVol = totalBuyVol + totalSellVol || 1;

    const buyPct  = Math.round((totalBuyVol  / totalVol) * 100);
    const sellPct = Math.round((totalSellVol / totalVol) * 100);

    return {
      cvdTrend:        cvdTrend(candles),
      divergence:      detectDeltaDivergence(candles),
      absorptionZones: findAbsorptionZones(candles),
      buyPressure:     buyPct,
      sellPressure:    sellPct,
      deltaBias:       buyPct > sellPct + 10 ? "buying" : sellPct > buyPct + 10 ? "selling" : "balanced",
    };
  }, []);

  // ── Mock refresh ─────────────────────────────────────────────────────────
  const refreshMock = useCallback(() => {
    const sparkline = getSparkline(selectedSymbol);
    const data      = generateMockFootprint(sparkline, selectedSymbol);
    setFootprint(data);
    setAnalytics(computeAnalytics(data));
    setIsLoading(false);
    setIsLive(false);
    setLastUpdate(new Date());
  }, [selectedSymbol, getSparkline, computeAnalytics]);

  // ── Live refresh (Binance recent trades) ─────────────────────────────────
  const refreshLive = useCallback(async () => {
    try {
      const raw   = await fetchRecentTrades(selectedSymbol, 200);
      const trades: TradeEvent[] = raw.map((t: {
        price: string; qty: string; isBuyerMaker: boolean; time: number;
      }) => ({
        price:    parseFloat(t.price),
        qty:      parseFloat(t.qty),
        isBuyer:  !t.isBuyerMaker,  // taker is buyer when not buyer-maker
        time:     t.time,
      }));

      // Group into 5-candle time buckets (1 min each)
      const bucketMs = 60_000;
      const buckets  = new Map<number, TradeEvent[]>();

      trades.forEach((t) => {
        const bucket = Math.floor(t.time / bucketMs) * bucketMs;
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        buckets.get(bucket)!.push(t);
      });

      const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
      let runCVD = 0;
      const candles: FootprintCandle[] = sortedBuckets.slice(-20).map(([ts, tradeList]) => {
        const candle = buildFootprintCandle(tradeList, selectedSymbol, ts, runCVD);
        runCVD = candle.cvd;
        return candle;
      });

      const allDeltas = candles.map((c) => c.totalDelta);
      const avgDelta  = allDeltas.reduce((s, d) => s + d, 0) / (allDeltas.length || 1);
      const maxAbsVol = Math.max(...candles.map((c) => c.totalVol), 1);

      const data: FootprintData = { symbol: selectedSymbol, candles, currentCVD: runCVD, avgDelta, maxAbsVol };
      setFootprint(data);
      setAnalytics(computeAnalytics(data));
      setIsLive(true);
      setIsLoading(false);
      setLastUpdate(new Date());
    } catch {
      refreshMock();
    }
  }, [selectedSymbol, computeAnalytics, refreshMock]);

  // ── Effect: start polling ────────────────────────────────────────────────
  useEffect(() => {
    setIsLoading(true);
    tradeBufferRef.current = [];
    candlesRef.current     = [];
    cvdRef.current         = 0;

    if (hasValidBinanceKeys) {
      refreshLive();
      intervalRef.current = setInterval(refreshLive, POLL_INTERVAL);
    } else {
      refreshMock();
      intervalRef.current = setInterval(refreshMock, MOCK_INTERVAL);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [selectedSymbol, hasValidBinanceKeys, refreshLive, refreshMock]);

  return { selectedSymbol, setSymbol: setSelectedSymbol, footprint, analytics, isLoading, isLive, lastUpdate };
}
