/**
 * useOpportunities — polls GET /api/opportunities/cached (fast, no scan triggered)
 * and GET /api/regime-intelligence/last for market regime state.
 *
 * Refetch interval: 15 s (opportunities are cached 5 min server-side).
 * Follows the exact pattern established in useAnalytics.ts / useOrchestrator.ts.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { SERVER_URL } from "../config/urls";

// ─── Types mirroring OpportunityResult from the API server ───────────────────

export interface OpportunityResult {
  symbol:             string;   // Gate.io format: BTC_USDT
  displaySymbol:      string;   // CCXT/UI format: BTC/USDT
  strategy:           string;
  conditionsMet:      number;
  conditionsTotal:    number;
  readinessScore:     number;   // 0–100
  isReady:            boolean;
  confidence:         number;   // 0–100
  action:             "BUY" | "SHORT" | "HOLD";
  direction:          "LONG" | "SHORT" | null;
  trendBullish:       boolean | null;
  rsi:                number | null;
  lastPrice:          number;
  blockReason:        string | null;
  missingConditions:  string[] | null;
  reason:             string;
  scannedAt:          string;
}

// ─── Types mirroring EnhancedRegimeResult from the API server ────────────────

export type EnhancedRegime =
  | "strong_trend"
  | "weak_trend"
  | "range"
  | "breakout"
  | "volatility_expansion"
  | "volatility_compression"
  | "unknown";

export interface RegimeIndicators {
  adx:                number;
  adxDi14Plus:        number;
  adxDi14Minus:       number;
  bollingerWidth:     number;
  atrCurrent:         number;
  atrAverage:         number;
  atrRatio:           number;
  trendStrengthScore: number;
  rsi:                number;
  ema50:              number;
  ema200:             number;
  priceAboveEma200:   boolean;
}

export interface EnhancedRegimeResult {
  regime:          EnhancedRegime;
  confidence:      number;
  indicators:      RegimeIndicators;
  description:     string;
  strategyWeights: Record<string, number>;
  tradingBias:     "bullish" | "bearish" | "neutral";
  computedAt:      string;
}

// ─── Opportunities response ───────────────────────────────────────────────────

interface OpportunitiesResponse {
  ok:        boolean;
  results:   OpportunityResult[];
  scannedAt: string;
  ageMs:     number;
  scanning:  boolean;
  ready:     number;
  total:     number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 15_000;  // 15 s — server caches for 5 min

export function useOpportunities() {
  const [results,    setResults]    = useState<OpportunityResult[]>([]);
  const [scannedAt,  setScannedAt]  = useState<string>("");
  const [ageMs,      setAgeMs]      = useState<number>(0);
  const [scanning,   setScanning]   = useState<boolean>(false);
  const [ready,      setReady]      = useState<number>(0);
  const [total,      setTotal]      = useState<number>(0);
  const [loading,    setLoading]    = useState<boolean>(true);
  const [error,      setError]      = useState<string | null>(null);

  const [regime,     setRegime]     = useState<EnhancedRegimeResult | null>(null);
  const [regimeErr,  setRegimeErr]  = useState<string | null>(null);

  const mounted = useRef(true);

  // ── Client-side signal history (retained in memory) ──────────────────────
  const signalHistory = useRef<OpportunityResult[]>([]);

  const fetchOpportunities = useCallback(async () => {
    if (!mounted.current) return;
    try {
      const jwt = localStorage.getItem("pcb_jwt");
      const res = await fetch(`${SERVER_URL}/api/opportunities/cached`, {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OpportunitiesResponse;
      if (!mounted.current) return;
      if (data.ok !== false) {
        setResults(data.results ?? []);
        setScannedAt(data.scannedAt ?? "");
        setAgeMs(data.ageMs ?? 0);
        setScanning(data.scanning ?? false);
        setReady(data.ready ?? 0);
        setTotal(data.total ?? 0);
        setError(null);

        // Accumulate history: add new ready signals not already tracked
        const nowReady = (data.results ?? []).filter(r => r.isReady);
        nowReady.forEach(sig => {
          const alreadyIn = signalHistory.current.some(
            h => h.symbol === sig.symbol && h.scannedAt === sig.scannedAt,
          );
          if (!alreadyIn) {
            signalHistory.current = [sig, ...signalHistory.current].slice(0, 50);
          }
        });
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const fetchRegime = useCallback(async () => {
    if (!mounted.current) return;
    try {
      const jwt = localStorage.getItem("pcb_jwt");
      const res = await fetch(`${SERVER_URL}/api/regime-intelligence/last`, {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      });
      if (!res.ok) {
        if (res.status === 404) return; // not computed yet — silently skip
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { ok: boolean; data: EnhancedRegimeResult };
      if (mounted.current && data.ok && data.data) {
        setRegime(data.data);
        setRegimeErr(null);
      }
    } catch (e) {
      if (mounted.current) setRegimeErr(String(e));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void fetchOpportunities();
    void fetchRegime();

    const id1 = setInterval(() => { void fetchOpportunities(); }, POLL_INTERVAL);
    const id2 = setInterval(() => { void fetchRegime(); },        POLL_INTERVAL);

    return () => {
      mounted.current = false;
      clearInterval(id1);
      clearInterval(id2);
    };
  }, [fetchOpportunities, fetchRegime]);

  return {
    results,
    scannedAt,
    ageMs,
    scanning,
    ready,
    total,
    loading,
    error,
    regime,
    regimeErr,
    signalHistory: signalHistory.current,
    refresh: fetchOpportunities,
  };
}
