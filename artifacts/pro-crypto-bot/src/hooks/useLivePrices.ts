/**
 * useLivePrices
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads live Gate.io spot tickers through the server-side market proxy.
 * The browser never calls Gate.io directly and never invents prices while the
 * exchange or API server is unavailable.
 */

import { useState, useEffect, useCallback } from "react";
import { CoinPrice } from "../types/crypto";
import { SERVER_URL } from "../config/urls";

interface GateTicker {
  currency_pair: string;
  last: string;
  change_percentage: string;
  base_volume: string;
  quote_volume: string;
  high_24h?: string;
  low_24h?: string;
}

export function useLivePrices() {
  const [prices, setPrices] = useState<CoinPrice[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date(0));
  const [totalMarketCap, setTotalMarketCap] = useState(0);
  const [fearGreedIndex, setFearGreedIndex] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<"connecting" | "live" | "simulated">("connecting");

  const fetchMarketData = useCallback(async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/market/tickers`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Market proxy returned ${response.status}`);

      const payload = await response.json() as GateTicker[] | { error?: string };
      if (!Array.isArray(payload)) {
        throw new Error(payload.error ?? "Market data unavailable");
      }

      const liveRows = payload
        .filter(t => t.currency_pair.endsWith("_USDT") && Number(t.last) > 0)
        .map(t => {
          const symbol = t.currency_pair.split("_")[0] ?? "";
          return {
            id: symbol.toLowerCase(),
            symbol,
            name: symbol,
            price: Number(t.last),
            change24h: Number(t.last) * (Number(t.change_percentage) || 0) / 100,
            changePercent24h: Number(t.change_percentage) || 0,
            volume24h: Number(t.quote_volume) || Number(t.base_volume) || 0,
            // Gate.io does not provide market-cap data on this endpoint. Keep
            // it unavailable rather than carrying authored metadata into the
            // live dashboard.
            marketCap: 0,
            sparkline: [],
            high24h: Number(t.high_24h) || 0,
            low24h: Number(t.low_24h) || 0,
          } satisfies CoinPrice;
        });

      setPrices(liveRows);
      setLastUpdate(new Date());
      setIsLive(true);
      setApiError(null);
      setConnectionStatus("live");
    } catch (err) {
      setIsLive(false);
      setConnectionStatus("connecting");
      setApiError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    setConnectionStatus("connecting");
    void fetchMarketData();
    const interval = setInterval(() => void fetchMarketData(), 15_000);
    return () => clearInterval(interval);
  }, [fetchMarketData]);

  // Sentiment is independent from trading prices; it is unavailable rather
  // than fabricated if the public service cannot be reached.
  useEffect(() => {
    const fetchFng = async () => {
      try {
        const res = await fetch("https://api.alternative.me/fng/?limit=1", { cache: "no-store" });
        const json = await res.json() as { data?: Array<{ value: string }> };
        const value = Number.parseInt(json.data?.[0]?.value ?? "", 10);
        if (Number.isFinite(value)) setFearGreedIndex(value);
      } catch {
        setFearGreedIndex(0);
      }
    };
    void fetchFng();
    const interval = setInterval(() => void fetchFng(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setTotalMarketCap(prices.reduce((sum, coin) => sum + coin.marketCap, 0));
  }, [prices]);

  return {
    prices,
    lastUpdate,
    totalMarketCap,
    fearGreedIndex,
    isLive,
    apiError,
    connectionStatus,
  };
}