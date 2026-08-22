import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import { PremiumStatCard } from "./premium/PremiumStatCard";
import { Trophy, Crown, Zap, BarChart2, AlertTriangle, XCircle, RefreshCw, Clock } from "lucide-react";
import { motion } from "framer-motion";

interface StrategyMetrics {
  strategyId:    string;
  strategyName:  string;
  totalTrades:   number;
  winRate:       number;
  profitFactor:  number;
  sharpeRatio:   number;
  netPnl:        number;
  maxDrawdown:   number;
  pnl30d:        number;
  pnl90d:        number;
  rankScore:     number;
  tier:          "elite" | "strong" | "average" | "weak" | "poor";
  allocationMod: number;
  lastTrade:     string | null;
}

interface RankingResult {
  rankings:      StrategyMetrics[];
  computedAt:    string;
  totalTrades:   number;
  bestStrategy:  string | null;
  worstStrategy: string | null;
}

const TIER_STYLES: Record<string, string> = {
  elite:   "bg-yellow-500/15 border-yellow-500/40 text-yellow-300",
  strong:  "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  average: "bg-cyan-500/15 border-cyan-500/40 text-cyan-300",
  weak:    "bg-orange-500/15 border-orange-500/40 text-orange-300",
  poor:    "bg-rose-500/15 border-rose-500/40 text-rose-300",
};

const TIER_ICONS: Record<string, React.ElementType> = {
  elite: Crown, strong: Zap, average: BarChart2, weak: AlertTriangle, poor: XCircle,
};

function ScoreBar({ score, tier }: { score: number; tier: string }) {
  const color =
    tier === "elite"   ? "bg-yellow-400" :
    tier === "strong"  ? "bg-emerald-400"  :
    tier === "average" ? "bg-cyan-400"   :
    tier === "weak"    ? "bg-orange-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={`h-full rounded-full ${color}`} 
        />
      </div>
      <span className="text-xs text-slate-300 w-8 text-right">{score}</span>
    </div>
  );
}

export function StrategyRankingPanel() {
  const [data, setData]       = useState<RankingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("pcb_jwt") ?? "";
      const res   = await fetch(`${SERVER_URL}/api/strategy-ranking`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json() as { ok: boolean; data?: RankingResult; error?: string };
      if (d.ok && d.data) setData(d.data);
      else setError(d.error ?? "Failed to load rankings");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-50 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-cyan-400" />
            Strategy Rankings
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">Ranked by composite performance score across all metrics</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      {data && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-3 gap-3"
        >
          <PremiumCard>
            <PremiumCardContent className="p-3">
              <p className="text-[13px] font-bold text-slate-400 uppercase tracking-wider">Total Trades Analysed</p>
              <p className="text-xl font-bold text-slate-50 mt-1">{data.totalTrades}</p>
            </PremiumCardContent>
          </PremiumCard>
          <PremiumCard>
            <PremiumCardContent className="p-3">
              <p className="text-[13px] font-bold text-slate-400 uppercase tracking-wider">Best Strategy</p>
              <p className="text-sm font-bold text-yellow-400 mt-1">{data.bestStrategy ?? "—"}</p>
            </PremiumCardContent>
          </PremiumCard>
          <PremiumCard>
            <PremiumCardContent className="p-3">
              <p className="text-[13px] font-bold text-slate-400 uppercase tracking-wider">Weakest Strategy</p>
              <p className="text-sm font-bold text-rose-400 mt-1">{data.worstStrategy ?? "—"}</p>
            </PremiumCardContent>
          </PremiumCard>
        </motion.div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Rankings table */}
      {loading && !data && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-40 bg-slate-900/50 border border-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {data.rankings.map((s, idx) => {
            const TierIcon = TIER_ICONS[s.tier] || Trophy;
            return (
              <motion.div 
                key={s.strategyId}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1 }}
              >
                <PremiumCard hoverGlow>
                  <PremiumCardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-400 border border-white/5">
                          #{idx + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-50">{s.strategyName}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 ${TIER_STYLES[s.tier]}`}>
                              <TierIcon className="w-3 h-3" />
                              {s.tier.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                            <BarChart2 className="w-3 h-3" />
                            {s.totalTrades} trades · Last: {s.lastTrade ? new Date(s.lastTrade).toLocaleDateString() : "N/A"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Allocation</p>
                        <p className={`text-base font-bold ${s.allocationMod >= 1.2 ? "text-emerald-400" : s.allocationMod < 0.6 ? "text-rose-400" : "text-yellow-400"}`}>
                          ×{s.allocationMod.toFixed(1)}
                        </p>
                      </div>
                    </div>

                    {/* Score bar */}
                    <div className="mb-4 bg-slate-900/50 p-3 rounded-lg border border-white/5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-slate-400 font-medium">Composite Rank Score</span>
                        <span className="text-xs text-slate-300 font-bold">{s.rankScore}/100</span>
                      </div>
                      <ScoreBar score={s.rankScore} tier={s.tier} />
                    </div>

                    {/* Metrics grid */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { label: "Win Rate",     value: `${s.winRate.toFixed(1)}%`,   color: s.winRate >= 55 ? "text-emerald-400" : s.winRate >= 45 ? "text-yellow-400" : "text-rose-400" },
                        { label: "Profit Factor",value: s.profitFactor.toFixed(2),    color: s.profitFactor >= 1.5 ? "text-emerald-400" : s.profitFactor >= 1 ? "text-yellow-400" : "text-rose-400" },
                        { label: "Sharpe",       value: s.sharpeRatio.toFixed(2),     color: s.sharpeRatio >= 1 ? "text-emerald-400" : s.sharpeRatio >= 0 ? "text-yellow-400" : "text-rose-400" },
                        { label: "Net PnL",      value: `$${s.netPnl.toFixed(0)}`,    color: s.netPnl >= 0 ? "text-emerald-400" : "text-rose-400" },
                        { label: "30d PnL",      value: `$${s.pnl30d.toFixed(0)}`,    color: s.pnl30d >= 0 ? "text-emerald-400" : "text-rose-400" },
                        { label: "Max DD",       value: `${s.maxDrawdown.toFixed(1)}%`, color: s.maxDrawdown <= 10 ? "text-emerald-400" : s.maxDrawdown <= 20 ? "text-yellow-400" : "text-rose-400" },
                      ].map((m) => (
                        <div key={m.label} className="bg-slate-800/30 rounded-lg p-2 text-center border border-white/5">
                          <p className="text-[13px] font-bold text-slate-500 mb-0.5 uppercase">{m.label}</p>
                          <p className={`text-xs font-bold ${m.color}`}>{m.value}</p>
                        </div>
                      ))}
                    </div>
                  </PremiumCardContent>
                </PremiumCard>
              </motion.div>
            );
          })}
        </div>
      )}

      {data && (
        <p className="text-xs text-slate-500 text-center flex items-center justify-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Computed: {new Date(data.computedAt).toLocaleString()} · Rankings update every 60s
        </p>
      )}
    </div>
  );
}

// Clock missing in imports, fix needed
