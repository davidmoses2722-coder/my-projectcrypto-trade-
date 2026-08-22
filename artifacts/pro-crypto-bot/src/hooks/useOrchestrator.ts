import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Regime =
  | "trending" | "ranging" | "high_volatility" | "low_volatility"
  | "breakout" | "reversal" | "unknown";

export interface StrategyEntry {
  id:         string;
  name:       string;
  enabled:    boolean;
  weight:     number;
  allocation: number;
  reason:     string;
  suitable:   Regime[];
}

export interface IntelligenceRule {
  id:          string;
  name:        string;
  description: string;
  triggered:   boolean;
  action:      string;
  severity:    "info" | "warning" | "critical";
}

export interface OrchestratorStatus {
  regime:           Regime;
  regimeConfidence: number;
  regimeReason:     string;
  marketConfidence: number;
  strategies:       StrategyEntry[];
  rules:            IntelligenceRule[];
  totalAllocPct:    number;
  activeStrategyId: string;
  lossStreak:       number;
  volRatio:         number;
  lastComputed:     string;
  log:              { ts: string; level: string; msg: string }[];
}

export interface OrchestratorConfig {
  autoEnabled:           boolean;
  volHighThreshold:      number;
  volLowThreshold:       number;
  emaGapTrendPct:        number;
  losingStreakThreshold: number;
  maxSingleAllocPct:     number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOrchestrator(serverUrl: string) {
  const [status,  setStatus]  = useState<OrchestratorStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const mounted = useRef(true);

  const fetchStatus = useCallback(async () => {
    if (!mounted.current) return;
    setLoading(true);
    try {
      const jwt = localStorage.getItem("pcb_jwt");
      const res = await fetch(`${serverUrl}/api/orchestrator/status`, {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OrchestratorStatus & { ok: boolean };
      if (mounted.current) {
        const { ok: _ok, ...rest } = data as any;
        setStatus(rest as OrchestratorStatus);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [serverUrl]);

  const sendOverride = useCallback(async (
    strategyId: string,
    patch: Partial<StrategyEntry>,
    clear = false,
  ) => {
    const jwt = localStorage.getItem("pcb_jwt");
    const res = await fetch(`${serverUrl}/api/orchestrator/override`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify({ strategyId, patch, clear }),
    });
    const data = await res.json();
    if (data.ok) await fetchStatus();
    return data;
  }, [serverUrl, fetchStatus]);

  const updateConfig = useCallback(async (patch: Partial<OrchestratorConfig>) => {
    const jwt = localStorage.getItem("pcb_jwt");
    const res = await fetch(`${serverUrl}/api/orchestrator/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.ok) await fetchStatus();
    return data;
  }, [serverUrl, fetchStatus]);

  useEffect(() => {
    mounted.current = true;
    void fetchStatus();
    const id = setInterval(() => { void fetchStatus(); }, 10_000);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [fetchStatus]);

  return { status, loading, error, refresh: fetchStatus, sendOverride, updateConfig };
}
