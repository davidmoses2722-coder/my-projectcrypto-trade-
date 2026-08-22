/**
 * useSmartMoney — SMC analysis hook
 * Runs full Smart Money Concepts analysis on live price sparklines.
 * Re-runs whenever prices update.
 */

import { useState, useEffect, useMemo } from "react";
import { CoinPrice } from "../types/crypto";
import { SMCAnalysis, analyzeSMC } from "../utils/smartMoney";

export interface UseSmartMoneyReturn {
  selectedSymbol: string;
  setSymbol:      (s: string) => void;
  analysis:       SMCAnalysis | null;
  allAnalyses:    Record<string, SMCAnalysis>;
  isLoading:      boolean;
  lastUpdate:     Date;
}

export function useSmartMoney(prices: CoinPrice[]): UseSmartMoneyReturn {
  const [selectedSymbol, setSelectedSymbol] = useState("BTC");
  const [lastUpdate,     setLastUpdate]     = useState(new Date());

  // Run SMC on all coins whenever prices update
  const allAnalyses = useMemo<Record<string, SMCAnalysis>>(() => {
    const result: Record<string, SMCAnalysis> = {};
    prices.forEach((p) => {
      if (p.sparkline && p.sparkline.length >= 10) {
        result[p.symbol] = analyzeSMC(p.sparkline, p.symbol);
      }
    });
    return result;
  }, [prices]);

  const analysis = useMemo(
    () => allAnalyses[selectedSymbol] ?? null,
    [allAnalyses, selectedSymbol]
  );

  useEffect(() => {
    setLastUpdate(new Date());
  }, [allAnalyses]);

  const isLoading = prices.length === 0;

  return { selectedSymbol, setSymbol: setSelectedSymbol, analysis, allAnalyses, isLoading, lastUpdate };
}
