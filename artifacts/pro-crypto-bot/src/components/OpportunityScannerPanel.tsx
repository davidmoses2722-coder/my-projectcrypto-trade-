/**
 * OpportunityScannerPanel — Phase 8.6
 *
 * Displays real-time Active Swing trade opportunities across 10 symbols.
 * Polls GET /api/opportunities/cached and triggers a full scan on demand.
 */

import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpportunityResult {
  symbol:          string;
  displaySymbol:   string;
  strategy:        string;
  conditionsMet:   number;
  conditionsTotal: number;
  readinessScore:  number;
  isReady:         boolean;
  confidence:      number;
  action:          "BUY" | "HOLD";
  trendBullish:    boolean | null;
  rsi:             number | null;
  lastPrice:       number;
  blockReason:     string | null;
  reason:          string;
  scannedAt:       string;
}

interface ScannerData {
  results:   OpportunityResult[];
  scannedAt: string;
  ageMs:     number;
  scanning:  boolean;
  ready:     number;
  total:     number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConditionBar({ met, total }: { met: number; total: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-2 flex-1 rounded-sm ${
            i < met ? "bg-purple-500" : "bg-gray-700"
          }`}
        />
      ))}
    </div>
  );
}

function fmtAge(ms: number): string {
  if (ms < 60_000)  return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OpportunityScannerPanel() {
  const [data,     setData]     = useState<ScannerData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [elapsed,  setElapsed]  = useState(0);

  const token = () => localStorage.getItem("pcb_jwt") ?? "";

  const fetchCached = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/opportunities/cached`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = (await r.json()) as ScannerData & { ok: boolean };
      if (d.ok) setData(d);
    } catch { /* silent */ }
  }, []);

  // Poll cached every 30 s
  useEffect(() => {
    void fetchCached();
    const id = setInterval(() => void fetchCached(), 30_000);
    return () => clearInterval(id);
  }, [fetchCached]);

  // Update elapsed timer every second when data exists
  useEffect(() => {
    if (!data) return;
    const id = setInterval(() => {
      setElapsed(Date.now() - (data.scannedAt ? new Date(data.scannedAt).getTime() : Date.now()));
    }, 1_000);
    return () => clearInterval(id);
  }, [data]);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const r = await fetch(`${SERVER_URL}/api/opportunities?refresh=1`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = (await r.json()) as ScannerData & { ok: boolean; error?: string };
      if (d.ok) {
        setData(d);
        setElapsed(0);
      } else {
        setError(d.error ?? "Scan failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setScanning(false);
    }
  };

  const results = data?.results ?? [];
  const readyCount = results.filter(r => r.isReady).length;

  return (
    <div className="space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-500/20 border border-purple-500/40 text-purple-300">
                🔭 OPPORTUNITY SCANNER
              </span>
              <span className="text-gray-500 text-xs">Active Swing · 4h candles · 10 symbols</span>
            </div>
            <p className="text-gray-400 text-xs">
              {data
                ? `Last scan: ${fmtAge(elapsed || (data.ageMs ?? 0))} · ${readyCount}/${results.length} symbols ready`
                : "No scan data yet — click Scan Now"}
            </p>
          </div>

          <button
            onClick={() => void handleScan()}
            disabled={scanning}
            className="px-4 py-2 rounded-xl font-bold text-sm transition-all bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40 flex items-center gap-2"
          >
            {scanning
              ? <><span className="w-3 h-3 border border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />Scanning…</>
              : "🔭 Scan Now"}
          </button>
        </div>

        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            ❌ {error}
          </div>
        )}

        {scanning && (
          <div className="mt-3 bg-purple-500/5 border border-purple-500/20 rounded-lg px-4 py-3">
            <p className="text-purple-300 text-sm font-semibold animate-pulse">
              Fetching 4h candles from Gate.io for 10 symbols… (~15–30 seconds)
            </p>
          </div>
        )}
      </div>

      {/* ── Summary row ─────────────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-gray-500 text-xs">Symbols Scanned</p>
            <p className="text-white font-bold text-2xl">{results.length}</p>
          </div>
          <div className={`rounded-xl p-4 text-center border ${
            readyCount > 0 ? "border-green-500/30 bg-green-500/5" : "border-gray-800 bg-gray-900"
          }`}>
            <p className="text-gray-500 text-xs">Ready to Trade</p>
            <p className={`font-bold text-2xl ${readyCount > 0 ? "text-green-400" : "text-white"}`}>
              {readyCount}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-gray-500 text-xs">Bullish Trend</p>
            <p className="text-white font-bold text-2xl">
              {results.filter(r => r.trendBullish === true).length}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-gray-500 text-xs">Avg Conditions</p>
            <p className="text-white font-bold text-2xl">
              {results.length > 0
                ? (results.reduce((s, r) => s + r.conditionsMet, 0) / results.length).toFixed(1)
                : "—"}
            </p>
          </div>
        </div>
      )}

      {/* ── Symbol results ───────────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm">Symbol Breakdown</h3>
            <span className="text-gray-500 text-xs">Sorted by readiness · Active Swing 3/5 min to trade</span>
          </div>

          <div className="divide-y divide-gray-800/50">
            {results.map(r => {
              const trendColor = r.trendBullish === true
                ? "text-green-400" : r.trendBullish === false
                ? "text-red-400" : "text-gray-500";
              const trendLabel = r.trendBullish === true
                ? "BULL" : r.trendBullish === false
                ? "BEAR" : "—";

              return (
                <div
                  key={r.symbol}
                  className={`px-5 py-3.5 flex items-center gap-4 ${
                    r.isReady
                      ? "bg-green-500/3 hover:bg-green-500/5"
                      : "hover:bg-gray-800/30"
                  }`}
                >
                  {/* Symbol + status */}
                  <div className="w-28 shrink-0">
                    <div className="flex items-center gap-1.5">
                      {r.isReady && <span className="text-green-400 text-xs">🚀</span>}
                      <span className="text-white font-semibold text-sm">
                        {r.displaySymbol}
                      </span>
                    </div>
                    <span className={`text-xs font-bold ${trendColor}`}>{trendLabel} trend</span>
                  </div>

                  {/* Conditions bar */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-gray-400 text-xs">
                        {r.conditionsMet}/{r.conditionsTotal} conditions
                      </span>
                      {r.isReady && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                          READY
                        </span>
                      )}
                    </div>
                    <ConditionBar met={r.conditionsMet} total={r.conditionsTotal} />
                  </div>

                  {/* Readiness score */}
                  <div className="w-16 text-center shrink-0">
                    <p className="text-gray-500 text-xs">Score</p>
                    <p className={`font-bold text-lg ${
                      r.readinessScore >= 80 ? "text-green-400" :
                      r.readinessScore >= 60 ? "text-yellow-400" :
                      r.readinessScore >= 40 ? "text-orange-400" :
                      "text-gray-500"
                    }`}>
                      {r.readinessScore}%
                    </p>
                  </div>

                  {/* RSI */}
                  <div className="w-16 text-center shrink-0 hidden sm:block">
                    <p className="text-gray-500 text-xs">RSI</p>
                    <p className={`text-sm font-bold ${
                      r.rsi == null ? "text-gray-600" :
                      r.rsi < 30 ? "text-blue-400" :
                      r.rsi > 70 ? "text-red-400" : "text-white"
                    }`}>
                      {r.rsi != null ? r.rsi.toFixed(1) : "—"}
                    </p>
                  </div>

                  {/* Confidence */}
                  <div className="w-16 text-center shrink-0 hidden sm:block">
                    <p className="text-gray-500 text-xs">Confidence</p>
                    <p className={`text-sm font-bold ${
                      r.confidence > 0 ? "text-purple-300" : "text-gray-600"
                    }`}>
                      {r.confidence > 0 ? `${r.confidence}%` : "—"}
                    </p>
                  </div>

                  {/* Price */}
                  <div className="w-24 text-right shrink-0 hidden md:block">
                    <p className="text-gray-500 text-xs">Last Price</p>
                    <p className="text-white text-sm">
                      ${r.lastPrice > 0
                        ? r.lastPrice >= 1000
                          ? r.lastPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })
                          : r.lastPrice >= 1
                          ? r.lastPrice.toFixed(3)
                          : r.lastPrice.toFixed(5)
                        : "—"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Strategy info ────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-3">Active Swing Entry Conditions</h3>
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          {[
            { n: 1, label: "Trend Entry",  desc: "EMA20 > EMA50 (4h) — short-term momentum aligned" },
            { n: 2, label: "RSI Range",    desc: "RSI 30–70 — not overbought, not oversold" },
            { n: 3, label: "Volume OK",    desc: "Current vol ≥ 0.5× 20-period average" },
            { n: 4, label: "ATR In Range", desc: "ATR 0.15%–2.0% of price — sufficient volatility" },
            { n: 5, label: "Pullback",     desc: "Price within 1 ATR of EMA20 or EMA50" },
          ].map(c => (
            <div key={c.n} className="flex items-start gap-2 bg-gray-800/50 rounded-lg px-3 py-2">
              <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {c.n}
              </span>
              <div>
                <p className="text-white font-semibold">{c.label}</p>
                <p className="text-gray-500">{c.desc}</p>
              </div>
            </div>
          ))}
          <div className="flex items-start gap-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
            <span className="text-purple-400 text-sm shrink-0 mt-0.5">⚡</span>
            <div>
              <p className="text-purple-300 font-semibold">Strict Trend Gate</p>
              <p className="text-gray-500">EMA50 &gt; EMA200 (4h) must be true — ALL longs blocked in bear market</p>
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-2 text-xs flex-wrap">
          <span className="px-2 py-0.5 rounded border border-gray-700 text-gray-400">Min 3/5 to trade</span>
          <span className="px-2 py-0.5 rounded border border-gray-700 text-gray-400">SL 1.2% / TP 2.0%</span>
          <span className="px-2 py-0.5 rounded border border-gray-700 text-gray-400">Daily cap 2 / Monthly cap 25</span>
          <span className="px-2 py-0.5 rounded border border-gray-700 text-gray-400">10 approved symbols</span>
          <span className="px-2 py-0.5 rounded border border-purple-500/30 text-purple-400/70">Phase 8.6</span>
        </div>
      </div>
    </div>
  );
}
