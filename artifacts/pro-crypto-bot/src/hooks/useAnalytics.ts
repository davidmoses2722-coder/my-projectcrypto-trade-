import { useState, useEffect, useCallback, useRef } from "react";
import { SERVER_URL } from "../config/urls";

// ─── Types (mirror backend AnalyticsSnapshot) ─────────────────────────────────

export interface AnalyticsMetrics {
  totalTrades:     number;
  wins:            number;
  losses:          number;
  breakevens:      number;
  winRate:         number;
  lossRate:        number;
  profitFactor:    number;
  expectancy:      number;
  avgWin:          number;
  avgLoss:         number;
  largestWin:      number;
  largestLoss:     number;
  avgHoldMins:     number;
  riskRewardRatio: number;
  sharpeRatio:     number;
  maxDrawdownPct:  number;
  totalPnlUsd:     number;
  grossWin:        number;
  grossLoss:       number;
}

export interface EquityPoint {
  time:   string;
  date:   string;
  pnlUsd: number;
  cumPnl: number;
}

export interface DailyEquity {
  date:     string;
  dailyPnl: number;
  cumPnl:   number;
  trades:   number;
  wins:     number;
}

export interface BreakdownSlice {
  label:    string;
  trades:   number;
  wins:     number;
  totalPnl: number;
  winRate:  number;
  avgPnl:   number;
}

export interface RollingPoint {
  date:       string;
  rolling7d:  number;
  rolling30d: number;
}

export interface HeatmapCell {
  date:   string;
  pnl:    number;
  trades: number;
}

export interface AiSnapshot {
  version:      number;
  timestamp:    string;
  metrics:      AnalyticsMetrics;
  topSymbols:   { symbol: string; pnl: number }[];
  topReasons:   { reason: string; count: number; pnl: number }[];
  recentTrades: { time: string; pnl: number; symbol: string; reason: string }[];
  equityCurve:  { date: string; cumPnl: number }[];
}

export interface AnalyticsSnapshot {
  metrics:           AnalyticsMetrics;
  equityCurve:       EquityPoint[];
  dailyEquity:       DailyEquity[];
  strategyBreakdown: BreakdownSlice[];
  symbolBreakdown:   BreakdownSlice[];
  rollingPnl:        RollingPoint[];
  heatmap:           HeatmapCell[];
  aiSnapshot:        AiSnapshot;
  tradeCount:        number;
  computedAt:        string;
}

// ─── Execution Analytics Types ────────────────────────────────────────────────

export interface ExecutionRecord {
  tradeId:        string;
  symbol:         string;
  side:           "buy" | "sell";
  intendedPrice:  number;
  filledPrice:    number;
  slippagePct:    number;
  slippageUsdt:   number;
  spread:         number;
  spreadPct:      number;
  fillQuality:    number;
  latencyMs:      number;
  executionCostPct: number;
  feePct:         number;
  notionalUsdt:   number;
  timestamp:      string;
}

export interface ExecutionSummary {
  totalTrades:          number;
  avgSlippagePct:       number;
  avgSpreadPct:         number;
  avgFillQuality:       number;
  avgLatencyMs:         number;
  avgExecutionCostPct:  number;
  totalSlippageCost:    number;
  totalFeeCost:         number;
  bestFill:             ExecutionRecord | null;
  worstFill:            ExecutionRecord | null;
  recent:               ExecutionRecord[];
}

// ─── Portfolio Manager Types ──────────────────────────────────────────────────

export interface PortfolioAllocation {
  strategyId:     string;
  strategyName:   string;
  allocationPct:  number;
  maxPositionPct: number;
  enabled:        boolean;
}

export interface PortfolioManagerEntry {
  id:                string;
  name:              string;
  description:       string;
  riskPreset:        string;
  totalCapitalUsdt:  number;
  allocations:       PortfolioAllocation[];
  maxDailyLossPct:   number;
  maxDrawdownPct:    number;
  maxOpenTrades:     number;
  active:            boolean;
}

export interface PortfolioManagerSummary {
  id:               string;
  name:             string;
  riskPreset:       string;
  totalCapitalUsdt: number;
  active:           boolean;
  strategyCount:    number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const jwt = localStorage.getItem("pcb_jwt");
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

// ─── Main Analytics Hook ───────────────────────────────────────────────────────

export function useAnalytics(serverUrl: string = SERVER_URL) {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const mounted = useRef(true);

  const fetchSnapshot = useCallback(async () => {
    if (!mounted.current) return;
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/api/analytics`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AnalyticsSnapshot & { ok: boolean };
      if (mounted.current && data.ok !== false) {
        const { ok: _ok, ...rest } = data as any;
        setSnapshot(rest as AnalyticsSnapshot);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    mounted.current = true;
    void fetchSnapshot();
    const id = setInterval(() => { void fetchSnapshot(); }, 15_000);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [fetchSnapshot]);

  return { snapshot, loading, error, refresh: fetchSnapshot };
}

// ─── Execution Analytics Hook ─────────────────────────────────────────────────

export function useExecutionAnalytics(serverUrl: string = SERVER_URL) {
  const [summary, setSummary] = useState<ExecutionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const mounted = useRef(true);

  const fetch_ = useCallback(async () => {
    if (!mounted.current) return;
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/api/execution-analytics/summary`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { ok: boolean; data?: ExecutionSummary };
      if (mounted.current && data.ok && data.data) {
        setSummary(data.data);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    mounted.current = true;
    void fetch_();
    const id = setInterval(() => { void fetch_(); }, 15_000);
    return () => { mounted.current = false; clearInterval(id); };
  }, [fetch_]);

  return { summary, loading, error, refresh: fetch_ };
}

// ─── Portfolio Manager Hook ───────────────────────────────────────────────────

export function usePortfolioManager(serverUrl: string = SERVER_URL) {
  const [summaries, setSummaries] = useState<PortfolioManagerSummary[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (!mounted.current) return;
    setLoading(true);
    try {
      const res  = await fetch(`${serverUrl}/api/portfolio-manager`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { ok: boolean; data?: PortfolioManagerSummary[] };
      if (mounted.current && data.ok && data.data) {
        setSummaries(data.data);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [serverUrl]);

  const loadDetail = useCallback(async (id: string): Promise<PortfolioManagerEntry | null> => {
    try {
      const res  = await fetch(`${serverUrl}/api/portfolio-manager/${id}`, { headers: authHeaders() });
      const data = await res.json() as { ok: boolean; data?: PortfolioManagerEntry };
      return data.ok && data.data ? data.data : null;
    } catch { return null; }
  }, [serverUrl]);

  const activate = useCallback(async (id: string) => {
    await fetch(`${serverUrl}/api/portfolio-manager/${id}/activate`, {
      method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
    });
    void load();
  }, [serverUrl, load]);

  const applyPreset = useCallback(async (id: string, preset: string): Promise<PortfolioManagerEntry | null> => {
    const res  = await fetch(`${serverUrl}/api/portfolio-manager/${id}/apply-preset`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ preset }),
    });
    const data = await res.json() as { ok: boolean; data?: PortfolioManagerEntry };
    void load();
    return data.ok && data.data ? data.data : null;
  }, [serverUrl, load]);

  const create = useCallback(async (payload: {
    name: string; description: string; riskPreset: string; totalCapitalUsdt: number;
  }): Promise<boolean> => {
    const res  = await fetch(`${serverUrl}/api/portfolio-manager`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json() as { ok: boolean };
    if (data.ok) void load();
    return data.ok;
  }, [serverUrl, load]);

  const deletePortfolio = useCallback(async (id: string) => {
    await fetch(`${serverUrl}/api/portfolio-manager/${id}`, {
      method: "DELETE", headers: authHeaders(),
    });
    void load();
  }, [serverUrl, load]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const id = setInterval(() => { void load(); }, 30_000);
    return () => { mounted.current = false; clearInterval(id); };
  }, [load]);

  return { summaries, loading, error, refresh: load, loadDetail, activate, applyPreset, create, deletePortfolio };
}
