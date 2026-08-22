import { useState } from "react";
import { SERVER_URL } from "../config/urls";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";
import { RefreshCw, Play, Clock, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";

interface WalkForwardWindow {
  windowIndex:     number;
  trainStart:      string;
  trainEnd:        string;
  validateStart:   string;
  validateEnd:     string;
  trainReturn:     number;
  validateReturn:  number;
  trainTrades:     number;
  validateTrades:  number;
  trainWinRate:    number;
  validateWinRate: number;
  passed:          boolean;
}

interface WalkForwardResult {
  strategyId:        string;
  symbol:            string;
  trainSplitPct:     number;
  windows:           WalkForwardWindow[];
  avgTrainReturn:    number;
  avgValidateReturn: number;
  robustnessScore:   number;
  consistencyScore:  number;
  passRate:          number;
  verdict:           "robust" | "moderate" | "overfit" | "insufficient_data";
  computedAt:        string;
}

const VERDICT_STYLES: Record<string, string> = {
  robust:             "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  moderate:           "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  overfit:            "text-rose-400 bg-rose-500/10 border-rose-500/30",
  insufficient_data:  "text-slate-400 bg-slate-500/10 border-slate-500/30",
};

export function WalkForwardPanel() {
  const [strategyId,  setStrategyId]  = useState("swing");
  const [symbol,      setSymbol]      = useState("BTC/USDT");
  const [timeframe,   setTimeframe]   = useState("1h");
  const [trainSplit,  setTrainSplit]  = useState<60 | 70 | 80>(70);
  const [result,      setResult]      = useState<WalkForwardResult | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const token = localStorage.getItem("pcb_jwt") ?? "";
      const res   = await fetch(`${SERVER_URL}/api/walk-forward/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ strategyId, symbol, timeframe, trainSplit, limit: 600 }),
      });
      const d = await res.json() as { ok: boolean; data?: WalkForwardResult; error?: string };
      if (d.ok && d.data) setResult(d.data);
      else setError(d.error ?? "Failed");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-50 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-cyan-400" />
          Walk-Forward Testing
        </h2>
        <p className="text-sm text-slate-400 mt-0.5">Prevents overfitting by validating strategy on unseen data</p>
      </div>

      {/* Controls */}
      <PremiumCard>
        <PremiumCardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Strategy</label>
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 focus:ring-1 focus:ring-cyan-500 outline-none">
              {["scalping","day-trading","swing","dca","grid"].map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Symbol</label>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 focus:ring-1 focus:ring-cyan-500 outline-none">
              {["BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Timeframe</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 focus:ring-1 focus:ring-cyan-500 outline-none">
              {["15m","1h","4h","1d"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Train Split</label>
            <select value={trainSplit} onChange={(e) => setTrainSplit(Number(e.target.value) as 60|70|80)}
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 focus:ring-1 focus:ring-cyan-500 outline-none">
              <option value={60}>60% Train</option>
              <option value={70}>70% Train</option>
              <option value={80}>80% Train</option>
            </select>
          </div>
        </PremiumCardContent>
      </PremiumCard>

      <button onClick={() => void run()} disabled={loading}
        className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(8,145,178,0.4)]">
        {loading ? (
          <><RefreshCw className="w-4 h-4 animate-spin" /> Running Walk-Forward Analysis…</>
        ) : (
          <><Play className="w-4 h-4 fill-current" /> Run Walk-Forward Test</>
        )}
      </button>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Robustness",   value: `${result.robustnessScore}/100`, color: result.robustnessScore >= 70 ? "text-emerald-400" : result.robustnessScore >= 40 ? "text-yellow-400" : "text-rose-400" },
              { label: "Consistency",  value: `${result.consistencyScore}/100`, color: result.consistencyScore >= 70 ? "text-emerald-400" : result.consistencyScore >= 40 ? "text-yellow-400" : "text-rose-400" },
              { label: "Pass Rate",    value: `${result.passRate.toFixed(0)}%`, color: result.passRate >= 70 ? "text-emerald-400" : result.passRate >= 40 ? "text-yellow-400" : "text-rose-400" },
              { label: "Verdict",      value: result.verdict.replace("_", " ").toUpperCase(), color: VERDICT_STYLES[result.verdict]?.split(" ")[0] ?? "text-slate-400" },
            ].map((m) => (
              <PremiumCard key={m.label}>
                <PremiumCardContent className="p-3 text-center">
                  <p className="text-[13px] font-bold text-slate-400 mb-1 uppercase tracking-wider">{m.label}</p>
                  <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
                </PremiumCardContent>
              </PremiumCard>
            ))}
          </div>

          {/* Avg returns */}
          <PremiumCard>
            <PremiumCardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-slate-50 uppercase tracking-widest">Return Comparison</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${VERDICT_STYLES[result.verdict]}`}>
                  {result.verdict.replace("_", " ").toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900/50 p-3 rounded-lg border border-white/5">
                  <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Avg Train Return</p>
                  <p className={`text-xl font-bold mt-1 ${result.avgTrainReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {result.avgTrainReturn >= 0 ? "+" : ""}{result.avgTrainReturn.toFixed(2)}%
                  </p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-white/5">
                  <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Avg Validate Return</p>
                  <p className={`text-xl font-bold mt-1 ${result.avgValidateReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {result.avgValidateReturn >= 0 ? "+" : ""}{result.avgValidateReturn.toFixed(2)}%
                  </p>
                </div>
              </div>
            </PremiumCardContent>
          </PremiumCard>

          {/* Windows */}
          <PremiumCard className="overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 bg-slate-900/40">
              <span className="text-sm font-semibold text-slate-50 tracking-wide">Windows ({result.windows.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-slate-400 bg-slate-900/20">
                    <th className="px-4 py-3 text-left font-bold uppercase tracking-wider font-sans">#</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Train Return</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Train Trades</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Validate Return</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Validate Trades</th>
                    <th className="px-4 py-3 text-center font-bold uppercase tracking-wider font-sans">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {result.windows.map((w) => (
                    <tr key={w.windowIndex} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-slate-400 font-sans font-medium">W{w.windowIndex + 1}</td>
                      <td className={`px-4 py-3 text-right ${w.trainReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {w.trainReturn >= 0 ? "+" : ""}{w.trainReturn.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300 font-sans font-medium">{w.trainTrades}</td>
                      <td className={`px-4 py-3 text-right ${w.validateReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {w.validateReturn >= 0 ? "+" : ""}{w.validateReturn.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300 font-sans font-medium">{w.validateTrades}</td>
                      <td className="px-4 py-3 text-center font-medium">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${w.passed ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"}`}>
                          {w.passed ? "PASS" : "FAIL"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PremiumCard>
        </motion.div>
      )}
    </div>
  );
}
