/** useTradFiPrices
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches TradFi/Stock/Gold tickers from the server's /api/market/tradfi proxy.
 * Falls back to safe static prices when the feed is unavailable.
 */

import { useState, useEffect, useCallback } from "react";
import { CoinPrice } from "../types/crypto";
import { SERVER_URL } from "../config/urls";

// ── Safe fallback prices (used when TradFi feed is inactive) ──────────────────
const FALLBACK_TRADFI: CoinPrice[] = [
  { id: "AAPL", symbol: "AAPL", name: "Apple Inc.", price: 228.45, change24h: 1.24, changePercent24h: 1.24, volume24h: 52_340_000_000, marketCap: 3_500_000_000_000, high24h: 231.10, low24h: 225.30, sparkline: [225, 226, 224, 227, 228, 227, 229, 228, 230, 228, 229, 230, 228, 229, 228.45] },
  { id: "TSLA", symbol: "TSLA", name: "Tesla Inc.", price: 248.70, change24h: -0.85, changePercent24h: -0.85, volume24h: 8_920_000_000, marketCap: 790_000_000_000, high24h: 254.20, low24h: 245.10, sparkline: [252, 251, 250, 249, 248, 247, 248, 249, 248, 247, 246, 247, 248, 248.5, 248.7] },
  { id: "AMZN", symbol: "AMZN", name: "Amazon.com", price: 198.42, change24h: 0.67, changePercent24h: 0.67, volume24h: 28_450_000_000, marketCap: 2_050_000_000_000, high24h: 199.80, low24h: 196.50, sparkline: [196, 197, 196.5, 197.5, 198, 197.8, 198.2, 198.5, 198.1, 198.4, 198.6, 198.3, 198.5, 198.4, 198.42] },
  { id: "GOOGL", symbol: "GOOGL", name: "Alphabet Inc.", price: 178.30, change24h: 0.42, changePercent24h: 0.42, volume24h: 12_670_000_000, marketCap: 2_180_000_000_000, high24h: 179.50, low24h: 176.80, sparkline: [177, 177.5, 177, 178, 177.8, 178.2, 178, 178.5, 178.3, 178.1, 178.4, 178.2, 178.5, 178.3, 178.3] },
  { id: "MSFT", symbol: "MSFT", name: "Microsoft Corp.", price: 425.60, change24h: 0.89, changePercent24h: 0.89, volume24h: 18_230_000_000, marketCap: 3_180_000_000_000, high24h: 427.10, low24h: 422.30, sparkline: [422, 423, 422.5, 424, 423.5, 424.5, 425, 424.8, 425.5, 425.2, 425.8, 425.3, 425.6, 425.4, 425.6] },
  { id: "NVDA", symbol: "NVDA", name: "NVIDIA Corp.", price: 128.50, change24h: 2.15, changePercent24h: 2.15, volume24h: 42_100_000_000, marketCap: 3_150_000_000_000, high24h: 130.20, low24h: 125.80, sparkline: [126, 126.5, 127, 126.8, 127.5, 128, 127.8, 128.2, 128.5, 128.3, 128.7, 128.4, 128.6, 128.5, 128.5] },
  { id: "META", symbol: "META", name: "Meta Platforms", price: 582.40, change24h: 1.56, changePercent24h: 1.56, volume24h: 15_340_000_000, marketCap: 1_430_000_000_000, high24h: 586.00, low24h: 576.20, sparkline: [576, 578, 577, 580, 579, 581, 580.5, 582, 581.5, 582.2, 582, 582.5, 582.3, 582.4, 582.4] },
  { id: "JPM", symbol: "JPM", name: "JPMorgan Chase", price: 215.80, change24h: -0.32, changePercent24h: -0.32, volume24h: 4_560_000_000, marketCap: 625_000_000_000, high24h: 217.50, low24h: 214.20, sparkline: [217, 216.5, 216, 215.5, 216, 215.8, 215.2, 215.5, 215.7, 215.3, 215.8, 215.5, 215.6, 215.7, 215.8] },
  { id: "GOLD", symbol: "GOLD", name: "Gold Spot (XAU/USD)", price: 2648.30, change24h: 0.78, changePercent24h: 0.78, volume24h: 280_000_000_000, marketCap: 0, high24h: 2655.00, low24h: 2635.50, sparkline: [2635, 2638, 2636, 2640, 2638, 2642, 2640, 2645, 2643, 2646, 2644, 2648, 2646, 2647, 2648.3] },
  { id: "OIL", symbol: "OIL", name: "Brent Crude", price: 82.45, change24h: -0.53, changePercent24h: -0.53, volume24h: 0, marketCap: 0, high24h: 83.80, low24h: 81.20, sparkline: [83, 82.8, 83.2, 82.5, 83, 82.8, 82.2, 82.5, 82, 82.3, 82.1, 82.4, 82.2, 82.3, 82.45] },
  { id: "NASDAQ100", symbol: "NDX", name: "NASDAQ 100 Index", price: 20850.00, change24h: 0.52, changePercent24h: 0.52, volume24h: 0, marketCap: 0, high24h: 20920.00, low24h: 20780.00, sparkline: [20780, 20800, 20790, 20810, 20800, 20820, 20810, 20830, 20820, 20840, 20830, 20850, 20840, 20845, 20850] },
  { id: "SPX", symbol: "SPX", name: "S&P 500 Index", price: 5832.00, change24h: 0.28, changePercent24h: 0.28, volume24h: 0, marketCap: 0, high24h: 5850.00, low24h: 5810.00, sparkline: [5810, 5820, 5815, 5828, 5822, 5830, 5825, 5832, 5828, 5835, 5832, 5838, 5835, 5833, 5832] },
];

export function useTradFiPrices() {
  const [prices, setPrices] = useState<CoinPrice[]>(FALLBACK_TRADFI);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTradFi = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/market/tradfi`, { cache: "no-store" });
      if (!res.ok) throw new Error(`TradFi proxy returned ${res.status}`);
      const data = await res.json() as Array<{
        currency_pair: string;
        last: string;
        change_percentage: string;
        quote_volume: string;
        base_volume: string;
      }>;
      if (!Array.isArray(data) || data.length === 0) {
        setPrices(FALLBACK_TRADFI);
        return;
      }
      const mapped: CoinPrice[] = data.map((t) => {
        const base = t.currency_pair.split("_")[0];
        const clean = base.replace(/G$|ON$|X$/, "");
        return {
          id: clean.toLowerCase(),
          symbol: clean.toUpperCase(),
          name: clean.toUpperCase(),
          price: Number(t.last),
          change24h: Number(t.last) * (Number(t.change_percentage) || 0) / 100,
          changePercent24h: Number(t.change_percentage) || 0,
          volume24h: Number(t.quote_volume) || Number(t.base_volume) || 0,
          marketCap: 0,
          high24h: 0,
          low24h: 0,
          sparkline: [],
        };
      });
      setPrices(mapped);
      setIsLive(true);
      setError(null);
    } catch (err) {
      setPrices(FALLBACK_TRADFI);
      setIsLive(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void fetchTradFi();
    const interval = setInterval(() => void fetchTradFi(), 20_000);
    return () => clearInterval(interval);
  }, [fetchTradFi]);

  return { prices, isLive, error };
}
