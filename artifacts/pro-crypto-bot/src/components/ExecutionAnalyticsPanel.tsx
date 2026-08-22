import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";
import { Zap, RefreshCw, AlertTriangle, TrendingDown, Clock, Percent, Activity, Shield, Info } from "lucide-react";
import { motion } from "framer-motion";

interface ExecutionRecord {
  tradeId: string; symbol: string; side: "buy" | "sell";
  intendedPrice: number; filledPrice: number;
  slippagePct: number; slippageUsdt: number;
  spread: number; spreadPct: number; fillQuality: number;
  latencyMs: number; executionCostPct: number; feePct: number;
  notionalUsdt: number; timestamp: string;
}

interface ExecutionSummary {
  totalTrades: number; avgSlippagePct: number; avgSpreadPct: number;
  avgFillQuality: number; avgLatencyMs: number; avgExecutionCostPct: number;
  totalSlippageCost: number; totalFeeCost: number;
  bestFill: ExecutionRecord | null; worstFill: ExecutionRecord | null;
  recent: ExecutionRecord[];
}

function QualityBadge({ score }: { score: number }) {
  const cls = score >= 80 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
              score >= 60 ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
              "bg-rose-500/10 text-rose-400 border-rose-500/20";
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${cls}`}>{score}/100</span>;
}

export function ExecutionAnalyticsPanel() {
  const [summary, setSummary] = useState<ExecutionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("pcb_jwt") ?? ""}` });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/execution-analytics/summary`, { headers: auth() });
      const d   = await res.json() as { ok: boolean; data?: ExecutionSummary; error?: string };
      if (d.ok && d.data) setSummary(d.data);
      else if (!d.ok) setError(d.error ?? "Failed to load execution analytics");
    } catch (e) {
      setError(String(e));
    } finally { 
      setLoading(false); 
    }
  }, []);

  useEffect(() => { void load(); const id = setInterval(() => void load(), 15_000); return () => clearInterval(id); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-50 flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-400" />
            Execution Analytics
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">Slippage, spread, fill quality, and execution cost tracking</p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25 flex items-center gap-1.5 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {summary && summary.totalTrades === 0 && (
        <PremiumCard>
          <PremiumCardContent className="p-8 text-center flex flex-col items-center">
            <Activity className="w-12 h-12 text-slate-600 mb-3 opacity-50" />
            <p className="text-slate-400 text-sm font-medium">No execution records yet.</p>
            <p className="text-slate-500 text-xs mt-1">Records will appear after your first live/paper trade.</p>
          </PremiumCardContent>
        </PremiumCard>
      )}

      {summary && summary.totalTrades > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Avg Slippage",      value: `${summary.avgSlippagePct.toFixed(3)}%`,  color: summary.avgSlippagePct < 0.1 ? "text-emerald-400" : summary.avgSlippagePct < 0.3 ? "text-yellow-400" : "text-rose-400", icon: TrendingDown },
              { label: "Avg Fill Quality",  value: `${summary.avgFillQuality}/100`,           color: summary.avgFillQuality >= 80 ? "text-emerald-400" : summary.avgFillQuality >= 60 ? "text-yellow-400" : "text-rose-400", icon: Shield },
              { label: "Avg Latency",       value: `${summary.avgLatencyMs.toFixed(0)}ms`,   color: summary.avgLatencyMs < 200 ? "text-emerald-400" : summary.avgLatencyMs < 500 ? "text-yellow-400" : "text-rose-400", icon: Clock },
              { label: "Avg Spread",        value: `${summary.avgSpreadPct.toFixed(3)}%`,    color: "text-cyan-400", icon: Percent },
            ].map((m) => {
              const Icon = m.icon;
              return (
                <PremiumCard key={m.label}>
                  <PremiumCardContent className="p-4 flex flex-col justify-between h-full">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">{m.label}</p>
                      <Icon className="w-3.5 h-3.5 text-slate-500" />
                    </div>
                    <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
                  </PremiumCardContent>
                </PremiumCard>
              );
            })}
          </div>

          {/* Cost summary */}
          <div className="grid grid-cols-2 gap-3">
            <PremiumCard>
              <PremiumCardContent className="p-5">
                <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Slippage Cost</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-extrabold text-rose-400">-${summary.totalSlippageCost.toFixed(2)}</p>
                  <p className="text-xs text-slate-500 font-medium">Across {summary.totalTrades} trades</p>
                </div>
              </PremiumCardContent>
            </PremiumCard>
            <PremiumCard>
              <PremiumCardContent className="p-5">
                <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Fee Cost</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-extrabold text-orange-400">-${summary.totalFeeCost.toFixed(2)}</p>
                  <p className="text-xs text-slate-500 font-medium">Combined execution drag</p>
                </div>
              </PremiumCardContent>
            </PremiumCard>
          </div>

          {/* Best / worst fills */}
          {(summary.bestFill || summary.worstFill) && (
            <div className="grid grid-cols-2 gap-3">
              {summary.bestFill && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[13px] font-bold text-emerald-400 font-bold uppercase tracking-wider">Best Fill</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-50">{summary.bestFill.symbol}</p>
                      <p className="text-sm text-slate-400 mt-1">Slippage: {summary.bestFill.slippagePct.toFixed(3)}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-bold text-slate-500 uppercase tracking-widest mb-1">Quality</p>
                      <p className="text-emerald-400 font-bold">{summary.bestFill.fillQuality}<span className="text-emerald-500/50 text-xs">/100</span></p>
                    </div>
                  </div>
                </div>
              )}
              {summary.worstFill && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span className="text-[13px] font-bold text-rose-400 font-bold uppercase tracking-wider">Worst Fill</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-50">{summary.worstFill.symbol}</p>
                      <p className="text-sm text-slate-400 mt-1">Slippage: {summary.worstFill.slippagePct.toFixed(3)}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-bold text-slate-500 uppercase tracking-widest mb-1">Quality</p>
                      <p className="text-rose-400 font-bold">{summary.worstFill.fillQuality}<span className="text-rose-500/50 text-xs">/100</span></p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recent executions */}
          {summary.recent.length > 0 && (
            <PremiumCard className="overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 bg-slate-900/40">
                <span className="text-sm font-semibold text-slate-50 tracking-wide">Recent Executions</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-slate-400 bg-slate-900/20">
                      <th className="px-4 py-3 text-left font-bold uppercase tracking-wider font-sans">Symbol</th>
                      <th className="px-4 py-3 text-left font-bold uppercase tracking-wider font-sans">Side</th>
                      <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Slippage</th>
                      <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Spread</th>
                      <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Latency</th>
                      <th className="px-4 py-3 text-center font-bold uppercase tracking-wider font-sans">Quality</th>
                      <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {summary.recent.map((r) => (
                      <tr key={`${r.tradeId}-${r.timestamp}`} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-50">{r.symbol}</td>
                        <td className="px-4 py-3">
                          <StatusBadge variant={r.side === "buy" ? "buy" : "sell"} label={r.side.toUpperCase()} />
                        </td>
                        <td className={`px-4 py-3 text-right ${Math.abs(r.slippagePct) < 0.1 ? "text-emerald-400" : "text-rose-400"}`}>
                          {r.slippagePct > 0 ? "+" : ""}{r.slippagePct.toFixed(3)}%
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">{r.spreadPct.toFixed(3)}%</td>
                        <td className="px-4 py-3 text-right text-slate-300">{r.latencyMs}ms</td>
                        <td className="px-4 py-3 text-center"><QualityBadge score={r.fillQuality} /></td>
                        <td className="px-4 py-3 text-right text-orange-400">{r.executionCostPct.toFixed(3)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PremiumCard>
          )}
        </motion.div>
      )}
    </div>
  );
}
