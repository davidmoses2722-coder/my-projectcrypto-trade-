import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import { Activity, Plus, RefreshCw, AlertTriangle, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";

interface DriftReport {
  strategyId: string; period: string;
  backtestReturn: number | null; paperReturn: number | null; liveReturn: number | null;
  btToLiveDrift: number | null; paperToLiveDrift: number | null;
  slippageImpact: number | null;
  degradationRisk: "none" | "low" | "moderate" | "high" | "critical";
  alerts: string[];
}

interface VerificationReport {
  driftReport: DriftReport[];
  overallHealth: "excellent" | "good" | "degrading" | "critical";
  computedAt: string;
}

const RISK_STYLES: Record<string, string> = {
  none:     "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  low:      "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
  moderate: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  high:     "text-orange-400 bg-orange-500/10 border-orange-500/30",
  critical: "text-rose-400 bg-rose-500/10 border-rose-500/30",
};

const HEALTH_STYLES: Record<string, string> = {
  excellent: "text-emerald-400",
  good:      "text-cyan-400",
  degrading: "text-orange-400",
  critical:  "text-rose-400",
};

function ReturnCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-600 text-xs">N/A</span>;
  return <span className={`text-xs font-bold ${value >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{value >= 0 ? "+" : ""}{value.toFixed(2)}%</span>;
}

function DriftCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-600 text-xs">N/A</span>;
  return <span className={`text-xs font-bold ${value >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{value >= 0 ? "+" : ""}{value.toFixed(2)}pp</span>;
}

export function LivePerformancePanel() {
  const [report,  setReport]  = useState<VerificationReport | null>(null);
  const [period,  setPeriod]  = useState("30d");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [showSnap, setShowSnap] = useState(false);
  const [newSnap, setNewSnap]  = useState({ strategyId: "swing", layer: "backtest", period: "30d", totalTrades: 0, winRate: 0, netReturnPct: 0, profitFactor: 1, sharpeRatio: 0, maxDrawdownPct: 0, avgSlippagePct: 0 });

  const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("pcb_jwt") ?? ""}` });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${SERVER_URL}/api/live-performance/report?period=${period}`, { headers: auth() });
      const data = await res.json() as { ok: boolean; data?: VerificationReport; error?: string };
      if (data.ok && data.data) setReport(data.data);
      else if (!data.ok) setError(data.error ?? "Failed to load verification report");
    } catch (e) {
      setError(String(e));
    } finally { 
      setLoading(false); 
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const addSnapshot = async () => {
    try {
      await fetch(`${SERVER_URL}/api/live-performance/snapshot`, {
        method: "POST", headers: auth(), body: JSON.stringify(newSnap),
      });
      setShowSnap(false);
      void load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-50 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            Live Performance Verification
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">Compare backtest ↔ paper ↔ live — detect strategy degradation and drift</p>
        </div>
        <div className="flex gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="bg-slate-900/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-50 focus:ring-1 focus:ring-cyan-500 outline-none">
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="90d">90 days</option>
          </select>
          <button onClick={() => setShowSnap(true)} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 flex items-center gap-1 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Snapshot
          </button>
          <button onClick={() => void load()} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25 transition-colors flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Add snapshot form */}
      {showSnap && (
        <PremiumCard animatedBorder>
          <PremiumCardContent className="p-5 space-y-4">
            <p className="text-sm font-bold text-slate-50 flex items-center gap-2">
              <Plus className="w-4 h-4 text-cyan-400" /> Record Performance Snapshot
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Strategy</label>
                <select value={newSnap.strategyId} onChange={(e) => setNewSnap((p) => ({ ...p, strategyId: e.target.value }))}
                  className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 outline-none">
                  {["scalping","day-trading","swing","dca","grid"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Layer</label>
                <select value={newSnap.layer} onChange={(e) => setNewSnap((p) => ({ ...p, layer: e.target.value }))}
                  className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 outline-none">
                  <option value="backtest">Backtest</option>
                  <option value="paper">Paper</option>
                  <option value="live">Live</option>
                </select>
              </div>
              <div>
                <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Net Return %</label>
                <input type="number" value={newSnap.netReturnPct} onChange={(e) => setNewSnap((p) => ({ ...p, netReturnPct: Number(e.target.value) }))}
                  className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 outline-none" />
              </div>
              <div>
                <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Win Rate %</label>
                <input type="number" value={newSnap.winRate} onChange={(e) => setNewSnap((p) => ({ ...p, winRate: Number(e.target.value) }))}
                  className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 outline-none" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => void addSnapshot()} className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold rounded-lg transition-colors">Save Snapshot</button>
              <button onClick={() => setShowSnap(false)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded-lg transition-colors">Cancel</button>
            </div>
          </PremiumCardContent>
        </PremiumCard>
      )}

      {/* Overall health */}
      {report && (
        <PremiumCard>
          <PremiumCardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Overall Portfolio Health ({period})</p>
              <p className={`text-2xl font-black mt-1 flex items-center gap-2 ${HEALTH_STYLES[report.overallHealth]}`}>
                {report.overallHealth === "excellent" && <ShieldAlert className="w-6 h-6 text-emerald-400" />}
                {report.overallHealth === "good" && <ShieldAlert className="w-6 h-6 text-cyan-400" />}
                {report.overallHealth === "degrading" && <AlertTriangle className="w-6 h-6 text-orange-400" />}
                {report.overallHealth === "critical" && <AlertTriangle className="w-6 h-6 text-rose-400" />}
                {report.overallHealth.charAt(0).toUpperCase() + report.overallHealth.slice(1)}
              </p>
            </div>
            <p className="text-[13px] font-bold text-slate-500 font-sans tracking-widest uppercase">{new Date(report.computedAt).toLocaleString()}</p>
          </PremiumCardContent>
        </PremiumCard>
      )}

      {/* Drift table */}
      {report && (
        <PremiumCard className="overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 bg-slate-900/40">
            <span className="text-sm font-semibold text-slate-50 tracking-wide">Strategy Performance Drift</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-slate-400 bg-slate-900/20">
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider font-sans">Strategy</th>
                  <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Backtest</th>
                  <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Paper</th>
                  <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Live</th>
                  <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">BT→Live Drift</th>
                  <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Slippage Impact</th>
                  <th className="px-4 py-3 text-center font-bold uppercase tracking-wider font-sans">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {report.driftReport.map((d) => (
                  <tr key={d.strategyId} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-50 capitalize">{d.strategyId}</td>
                    <td className="px-4 py-3 text-right"><ReturnCell value={d.backtestReturn} /></td>
                    <td className="px-4 py-3 text-right"><ReturnCell value={d.paperReturn} /></td>
                    <td className="px-4 py-3 text-right"><ReturnCell value={d.liveReturn} /></td>
                    <td className="px-4 py-3 text-right"><DriftCell value={d.btToLiveDrift} /></td>
                    <td className="px-4 py-3 text-right"><DriftCell value={d.slippageImpact} /></td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[13px] font-bold px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${RISK_STYLES[d.degradationRisk]}`}>
                        {d.degradationRisk}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PremiumCard>
      )}

      {/* Alerts */}
      {report && report.driftReport.some((d) => d.alerts.length > 0) && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-50 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            Active Alerts
          </p>
          {report.driftReport.flatMap((d) => d.alerts.map((a, i) => (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} key={`${d.strategyId}-${i}`}>
              <PremiumCard className="border-orange-500/20 bg-orange-500/5">
                <PremiumCardContent className="p-3 text-xs text-orange-200 flex items-start gap-2">
                  <span className="shrink-0 capitalize font-bold text-orange-400">{d.strategyId}:</span> {a}
                </PremiumCardContent>
              </PremiumCard>
            </motion.div>
          )))}
        </div>
      )}

      {/* Empty state */}
      {report && report.driftReport.every((d) => d.backtestReturn === null && d.liveReturn === null) && (
        <PremiumCard>
          <PremiumCardContent className="p-8 text-center flex flex-col items-center">
            <Activity className="w-12 h-12 text-slate-600 mb-3 opacity-50" />
            <p className="text-slate-400 text-sm font-medium">No performance snapshots recorded yet.</p>
            <p className="text-slate-500 text-xs mt-1">Click "<Plus className="inline w-3 h-3" /> Snapshot" to record backtest, paper, or live results for comparison.</p>
          </PremiumCardContent>
        </PremiumCard>
      )}
    </div>
  );
}
