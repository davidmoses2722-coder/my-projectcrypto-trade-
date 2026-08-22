/**
 * SignalsView — Backend-wired live entry signals from /api/opportunities
 * Displays confidence, entry price, SL, TP, strategy, time, reason,
 * conditions met/missing, signal lifetime, and a recent signal history list.
 */
import { useState, useEffect } from "react";
import { useOpportunities, OpportunityResult } from "../hooks/useOpportunities";
import { PremiumCard } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";
import { Target, Clock, AlertTriangle, ShieldCheck, Zap, Server, Activity } from "lucide-react";
import { motion } from "framer-motion";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(p: number): string {
  if (!p) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(4);
  return p.toFixed(6);
}

function timeAgo(iso: string): string {
  if (!iso) return "—";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 0)    return "just now";
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function signalLifetime(iso: string, staleMs = 5 * 60 * 1000): { age: string; pct: number; stale: boolean } {
  if (!iso) return { age: "—", pct: 0, stale: false };
  const elapsed = Date.now() - new Date(iso).getTime();
  const pct     = Math.min(100, (elapsed / staleMs) * 100);
  const stale   = elapsed >= staleMs;
  const s       = Math.floor(elapsed / 1000);
  const age     = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  return { age, pct, stale };
}

function confidenceColor(c: number): string {
  if (c >= 75) return "text-emerald-400";
  if (c >= 50) return "text-yellow-400";
  return "text-rose-400";
}

function actionBadge(action: string, direction: string | null) {
  const dir = direction ?? action;
  if (dir === "LONG"  || action === "BUY")   return "bg-emerald-500/20 border-emerald-500/40 text-emerald-300";
  if (dir === "SHORT" || action === "SHORT") return "bg-red-500/20 border-red-500/40 text-red-300";
  return "bg-slate-700/40 border-gray-600/40 text-slate-400";
}

// ─── Regime badge ─────────────────────────────────────────────────────────────

const REGIME_LABELS: Record<string, string> = {
  strong_trend:           "Strong Trend",
  weak_trend:             "Weak Trend",
  range:                  "Range",
  breakout:               "Breakout",
  volatility_expansion:   "Vol Expansion",
  volatility_compression: "Vol Compression",
  unknown:                "Unknown",
};

const REGIME_COLORS: Record<string, string> = {
  strong_trend:           "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
  weak_trend:             "bg-yellow-500/20 border-yellow-500/40 text-yellow-300",
  range:                  "bg-blue-500/20 border-blue-500/40 text-blue-300",
  breakout:               "bg-purple-500/20 border-purple-500/40 text-purple-300",
  volatility_expansion:   "bg-orange-500/20 border-orange-500/40 text-orange-300",
  volatility_compression: "bg-cyan-500/20 border-cyan-500/40 text-cyan-300",
  unknown:                "bg-slate-700/40 border-gray-600/40 text-slate-400",
};

// ─── Opportunity Signal Card ───────────────────────────────────────────────────

function OpportunityCard({ opp, index }: { opp: OpportunityResult; index: number }) {
  const lifetime = signalLifetime(opp.scannedAt);
  const ac = actionBadge(opp.action, opp.direction);
  const isLong  = opp.direction === "LONG"  || opp.action === "BUY";
  const isShort = opp.direction === "SHORT" || opp.action === "SHORT";

  // Derive approximate SL/TP from last price (real entry signals don't include SL/TP in this endpoint)
  const slPct = isLong  ? 0.97 : isShort ? 1.03 : null;
  const tpPct = isLong  ? 1.06 : isShort ? 0.94 : null;
  const sl    = slPct ? opp.lastPrice * slPct : null;
  const tp    = tpPct ? opp.lastPrice * tpPct : null;

  return (
    <PremiumCard hoverGlow className={`transition-all hover:scale-[1.01] ${
      opp.isReady
        ? isLong
          ? "bg-emerald-500/8 border-emerald-500/30"
          : "bg-red-500/8 border-red-500/30"
        : "bg-slate-800/40 border-gray-700/40"
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">#{index + 1}</span>
          <div>
            <p className="text-white font-bold text-sm leading-tight">{opp.displaySymbol}</p>
            <p className="text-slate-500 text-sm capitalize">{opp.strategy.replace("-", " ")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {opp.isReady && (
            <span className="text-sm font-bold px-1.5 py-0.5 rounded bg-yellow-400/20 border border-yellow-400/30 text-yellow-300">
              READY
            </span>
          )}
          <span className={`text-sm font-bold px-2 py-0.5 rounded-full border ${ac}`}>
            {opp.direction ?? opp.action}
          </span>
        </div>
      </div>

      {/* Confidence */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-slate-500">Confidence</span>
          <span className={`font-bold ${confidenceColor(opp.confidence)}`}>
            {opp.confidence}%
          </span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              opp.confidence >= 75 ? "bg-emerald-400" :
              opp.confidence >= 50 ? "bg-yellow-400" : "bg-rose-400"
            }`}
            style={{ width: `${opp.confidence}%` }}
          />
        </div>
      </div>

      {/* Conditions readiness */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-slate-500">Conditions Met</span>
          <span className="font-bold text-white">
            {opp.conditionsMet}/{opp.conditionsTotal}
          </span>
        </div>
        <div className="flex gap-1">
          {Array.from({ length: opp.conditionsTotal }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-2 rounded-sm ${
                i < opp.conditionsMet ? "bg-emerald-400" : "bg-slate-700"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Price grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-slate-900/60 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider mb-0.5">Entry</p>
          <p className="text-white font-semibold text-sm">${fmtPrice(opp.lastPrice)}</p>
        </div>
        <div className="bg-slate-900/60 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider mb-0.5">Target</p>
          <p className="text-emerald-400 font-semibold text-sm">
            {tp ? `$${fmtPrice(tp)}` : "—"}
          </p>
        </div>
        <div className="bg-slate-900/60 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider mb-0.5">Stop Loss</p>
          <p className="text-rose-400 font-semibold text-sm">
            {sl ? `$${fmtPrice(sl)}` : "—"}
          </p>
        </div>
      </div>

      {/* RSI */}
      {opp.rsi !== null && (
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-slate-500">RSI (14)</span>
          <span className={`font-bold ${
            opp.rsi > 70 ? "text-rose-400" : opp.rsi < 30 ? "text-emerald-400" : "text-yellow-400"
          }`}>{opp.rsi.toFixed(1)}</span>
        </div>
      )}

      {/* Reason */}
      {opp.reason && (
        <p className="text-slate-400 text-sm italic leading-relaxed mb-2">{opp.reason}</p>
      )}

      {/* Missing conditions */}
      {opp.missingConditions && opp.missingConditions.length > 0 && (
        <div className="mb-2">
          <p className="text-[13px] font-bold text-slate-600 uppercase tracking-wider mb-1">Missing</p>
          <div className="flex flex-wrap gap-1">
            {opp.missingConditions.map((c, i) => (
              <span
                key={i}
                className="text-sm px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Block reason */}
      {opp.blockReason && (
        <p className="text-sm text-amber-400/80 italic mb-2">
          Blocked: {opp.blockReason}
        </p>
      )}

      {/* Signal lifetime bar */}
      <div className="mt-2 pt-2 border-t border-white/5/60">
        <div className="flex items-center justify-between text-sm text-slate-500 mb-1">
          <span>Signal age: {lifetime.age}</span>
          <span className={lifetime.stale ? "text-rose-400" : "text-slate-500"}>
            {lifetime.stale ? "STALE" : `${(100 - lifetime.pct).toFixed(0)}% fresh`}
          </span>
        </div>
        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              lifetime.stale ? "bg-red-500" :
              lifetime.pct > 66 ? "bg-yellow-400" : "bg-emerald-400"
            }`}
            style={{ width: `${lifetime.pct}%` }}
          />
        </div>
        <p className="text-sm text-slate-600 mt-0.5">{timeAgo(opp.scannedAt)}</p>
      </div>
    </PremiumCard>
  );
}

// ─── Signal History Row ────────────────────────────────────────────────────────

function HistoryRow({ opp }: { opp: OpportunityResult }) {
  const isLong = opp.direction === "LONG" || opp.action === "BUY";
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5/60 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isLong ? "bg-emerald-400" : "bg-rose-400"}`} />
        <span className="text-sm text-white">{opp.displaySymbol}</span>
        <span className={`text-sm px-1.5 py-0.5 rounded border ${actionBadge(opp.action, opp.direction)}`}>
          {opp.direction ?? opp.action}
        </span>
      </div>
      <div className="text-right">
        <p className="text-sm text-gray-300">${fmtPrice(opp.lastPrice)}</p>
        <p className="text-sm text-slate-600">{timeAgo(opp.scannedAt)}</p>
      </div>
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-700/40 bg-slate-800/30 p-4 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 w-24 bg-slate-700 rounded" />
        <div className="h-5 w-16 bg-slate-700 rounded-full" />
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full mb-3" />
      <div className="flex gap-1 mb-3">
        {[0,1,2,3,4].map(i => <div key={i} className="flex-1 h-2 bg-slate-700 rounded-sm" />)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[0,1,2].map(i => <div key={i} className="h-12 bg-slate-700/60 rounded-lg" />)}
      </div>
    </div>
  );
}

// ─── Regime panel ─────────────────────────────────────────────────────────────

function RegimePanel({ regime }: { regime: import("../hooks/useOpportunities").EnhancedRegimeResult | null }) {
  if (!regime) {
    return (
      <div className="bg-slate-800/40 border border-gray-700/40 rounded-xl p-4">
        <p className="text-sm text-slate-500 font-bold mb-1">Market Regime</p>
        <p className="text-sm text-slate-600 italic">Not computed yet — regime analysis runs periodically.</p>
      </div>
    );
  }

  const cls = REGIME_COLORS[regime.regime] ?? REGIME_COLORS["unknown"]!;
  const biasColor =
    regime.tradingBias === "bullish" ? "text-emerald-400" :
    regime.tradingBias === "bearish" ? "text-rose-400" : "text-slate-400";

  return (
    <div className="bg-slate-800/40 border border-gray-700/40 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-white">Market Regime</p>
        <span className={`text-sm font-bold px-2 py-0.5 rounded-full border ${cls}`}>
          {REGIME_LABELS[regime.regime] ?? regime.regime}
        </span>
      </div>
      <p className="text-sm text-slate-400 italic mb-3">{regime.description}</p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-slate-600 text-sm">Confidence</p>
          <p className="font-bold text-white">{regime.confidence}%</p>
        </div>
        <div>
          <p className="text-slate-600 text-sm">Bias</p>
          <p className={`font-bold capitalize ${biasColor}`}>{regime.tradingBias}</p>
        </div>
        <div>
          <p className="text-slate-600 text-sm">ADX</p>
          <p className="text-white">{regime.indicators.adx.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-slate-600 text-sm">Trend Strength</p>
          <p className="text-white">{regime.indicators.trendStrengthScore}/100</p>
        </div>
      </div>
      <p className="text-sm text-gray-700 mt-2">
        Computed {timeAgo(regime.computedAt)}
      </p>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

type FilterDir = "ALL" | "LONG" | "SHORT" | "HOLD";

export function SignalsView() {
  const {
    results, scannedAt, ageMs, scanning,
    ready, total, loading, error,
    regime, signalHistory, refresh,
  } = useOpportunities();

  const [filter,    setFilter]    = useState<FilterDir>("ALL");
  const [showHistory, setShowHistory] = useState(false);
  const [ageDisplay, setAgeDisplay]  = useState(0);

  // Live age counter
  useEffect(() => {
    const t = setInterval(() => setAgeDisplay(Math.floor(ageMs / 1000)), 1000);
    return () => clearInterval(t);
  }, [ageMs]);

  const filtered = results.filter(r => {
    if (filter === "LONG")  return r.direction === "LONG"  || r.action === "BUY";
    if (filter === "SHORT") return r.direction === "SHORT" || r.action === "SHORT";
    if (filter === "HOLD")  return r.action === "HOLD";
    return true;
  });

  const readyCount  = results.filter(r => r.isReady).length;
  const longCount   = results.filter(r => r.direction === "LONG"  || r.action === "BUY").length;
  const shortCount  = results.filter(r => r.direction === "SHORT" || r.action === "SHORT").length;
  const avgConf     = results.length
    ? Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length)
    : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-white">Entry Signals</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Active Swing Strategy — 4h candles — {total} symbols scanned
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scanning && (
            <span className="flex items-center gap-1.5 text-sm text-yellow-400">
              <span className="w-3 h-3 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
              Scanning…
            </span>
          )}
          <span className="text-sm text-slate-600">
            {scannedAt ? `Scanned ${timeAgo(scannedAt)}` : "No scan yet"}
          </span>
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-sm rounded-xl bg-slate-800 border border-gray-700 text-gray-300 hover:border-cyan-500/50 hover:text-cyan-400 transition-all"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
          <p className="text-emerald-400 font-black text-2xl">{longCount}</p>
          <p className="text-slate-500 text-sm">Long Signals</p>
        </div>
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-center">
          <p className="text-rose-400 font-black text-2xl">{shortCount}</p>
          <p className="text-slate-500 text-sm">Short Signals</p>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-center">
          <p className="text-yellow-400 font-black text-2xl">{readyCount}</p>
          <p className="text-slate-500 text-sm">Ready to Trade</p>
        </div>
        <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3 text-center">
          <p className="text-cyan-400 font-black text-2xl">{avgConf}%</p>
          <p className="text-slate-500 text-sm">Avg Confidence</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Main signal area */}
        <div className="lg:col-span-3 space-y-4">
          {/* Filter tabs */}
          <div className="flex flex-wrap gap-2">
            {(["ALL", "LONG", "SHORT", "HOLD"] as FilterDir[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-bold border transition-all ${
                  filter === f
                    ? f === "LONG"  ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
                    : f === "SHORT" ? "border-red-500/60 bg-red-500/15 text-rose-400"
                    : f === "HOLD"  ? "border-yellow-500/60 bg-yellow-500/15 text-yellow-400"
                    : "border-cyan-500/60 bg-cyan-500/15 text-cyan-400"
                  : "border-gray-700 bg-slate-900 text-slate-500 hover:border-gray-600"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-rose-500/10 border border-red-500/25 rounded-xl px-4 py-3">
              <p className="text-rose-400 text-sm">{error}</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="grid sm:grid-cols-2 gap-3">
              {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
            </div>
          )}

          {/* Empty state */}
          {!loading && filtered.length === 0 && !error && (
            <div className="bg-slate-900 border border-white/5 rounded-xl p-10 text-center">
              <p className="text-slate-500 text-sm">
                {results.length === 0
                  ? "No scan data yet — server scans every 5 minutes."
                  : "No signals match the current filter."}
              </p>
            </div>
          )}

          {/* Cards */}
          {!loading && filtered.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {filtered.map((opp, i) => (
                <OpportunityCard key={opp.symbol} opp={opp} index={i} />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Regime */}
          <RegimePanel regime={regime} />

          {/* Signal history */}
          <div className="bg-slate-800/40 border border-gray-700/40 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-white">Signal History</p>
              <button
                onClick={() => setShowHistory(s => !s)}
                className="text-sm text-cyan-400 hover:text-cyan-300"
              >
                {showHistory ? "Hide" : "Show"} ({signalHistory.length})
              </button>
            </div>
            {showHistory && (
              signalHistory.length === 0 ? (
                <p className="text-sm text-slate-600 italic">No history yet — generated from ready signals this session.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {signalHistory.map((h, i) => (
                    <HistoryRow key={`${h.symbol}-${h.scannedAt}-${i}`} opp={h} />
                  ))}
                </div>
              )
            )}
            {!showHistory && (
              <p className="text-sm text-slate-600 italic">
                {signalHistory.length === 0
                  ? "No history yet this session."
                  : `${signalHistory.length} signal${signalHistory.length !== 1 ? "s" : ""} recorded this session.`}
              </p>
            )}
          </div>

          {/* Cache info */}
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3">
            <p className="text-[13px] font-bold text-slate-600 uppercase tracking-wider mb-2">Cache Info</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Cache age</span>
                <span className="text-gray-300">{ageDisplay}s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ready signals</span>
                <span className="text-emerald-400">{ready}/{total}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Strategy</span>
                <span className="text-gray-300 text-sm">active-swing 4h</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
