import { useState } from "react";
import { SERVER_URL } from "../config/urls";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import { Settings, Play, RefreshCw, AlertTriangle, Crown } from "lucide-react";
import { motion } from "framer-motion";

interface ParameterSet { rsi: number; ema1: number; ema2: number; tp: number; sl: number; atr: number; }
interface SimResult { returnPct: number; winRate: number; profitFactor: number; sharpeRatio: number; maxDrawdown: number; totalTrades: number; }
interface RankedConfig { rank: number; params: ParameterSet; metrics: SimResult; score: number; }
interface OptimizerResult {
  strategyId:  string; symbol: string;
  bestConfig:  RankedConfig; top20: RankedConfig[];
  totalTested: number; searchSpace: number; computedAt: string;
}

export function OptimizerPanel() {
  const [strategyId, setStrategyId] = useState("swing");
  const [symbol,     setSymbol]     = useState("BTC/USDT");
  const [timeframe,  setTimeframe]  = useState("1h");
  const [maxComb,    setMaxComb]    = useState(200);
  const [result,     setResult]     = useState<OptimizerResult | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [showAll,    setShowAll]    = useState(false);

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const token = localStorage.getItem("pcb_jwt") ?? "";
      const res   = await fetch(`${SERVER_URL}/api/optimizer/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ strategyId, symbol, timeframe, maxCombinations: maxComb, limit: 500 }),
      });
      const d = await res.json() as { ok: boolean; data?: OptimizerResult; error?: string };
      if (d.ok && d.data) setResult(d.data);
      else setError(d.error ?? "Failed");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const configs = result ? (showAll ? result.top20 : result.top20.slice(0, 5)) : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-50 flex items-center gap-2">
          <Settings className="w-5 h-5 text-cyan-400" />
          Strategy Optimizer
        </h2>
        <p className="text-sm text-slate-400 mt-0.5">Grid-search over RSI, EMA, TP/SL and ATR parameters</p>
      </div>

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
            <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Max Combinations</label>
            <select value={maxComb} onChange={(e) => setMaxComb(Number(e.target.value))}
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 focus:ring-1 focus:ring-cyan-500 outline-none">
              <option value={100}>100 (Fast)</option>
              <option value={200}>200 (Normal)</option>
              <option value={400}>400 (Thorough)</option>
            </select>
          </div>
        </PremiumCardContent>
      </PremiumCard>

      <button onClick={() => void run()} disabled={loading}
        className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(8,145,178,0.4)]">
        {loading ? (
          <><RefreshCw className="w-4 h-4 animate-spin" /> Running Grid Search…</>
        ) : (
          <><Play className="w-4 h-4 fill-current" /> Run Optimizer</>
        )}
      </button>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <PremiumCard>
              <PremiumCardContent className="p-3">
                <p className="text-[13px] font-bold text-slate-400 uppercase tracking-wider mb-1">Combinations Tested</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-xl font-bold text-slate-50">{result.totalTested.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">/ {result.searchSpace.toLocaleString()}</p>
                </div>
              </PremiumCardContent>
            </PremiumCard>
            <PremiumCard>
              <PremiumCardContent className="p-3">
                <p className="text-[13px] font-bold text-slate-400 uppercase tracking-wider mb-1">Best Score</p>
                <p className="text-xl font-bold text-yellow-400">{result.bestConfig.score}<span className="text-xs text-yellow-600">/100</span></p>
              </PremiumCardContent>
            </PremiumCard>
            <PremiumCard>
              <PremiumCardContent className="p-3">
                <p className="text-[13px] font-bold text-slate-400 uppercase tracking-wider mb-1">Best Return</p>
                <p className={`text-xl font-bold ${result.bestConfig.metrics.returnPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {result.bestConfig.metrics.returnPct >= 0 ? "+" : ""}{result.bestConfig.metrics.returnPct.toFixed(2)}%
                </p>
              </PremiumCardContent>
            </PremiumCard>
          </div>

          {/* Best config */}
          <PremiumCard animatedBorder className="bg-slate-900/80">
            <PremiumCardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Crown className="w-5 h-5 text-yellow-400" />
                <span className="text-sm font-bold text-yellow-400 uppercase tracking-wider">Optimal Configuration</span>
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                  Score: {result.bestConfig.score}
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                {Object.entries(result.bestConfig.params).map(([k, v]) => (
                  <div key={k} className="bg-slate-950/50 rounded-lg p-2 text-center border border-white/5">
                    <p className="text-[13px] font-bold text-slate-500 uppercase tracking-widest mb-1">{k}</p>
                    <p className="text-sm font-bold text-cyan-400">
                      {typeof v === "number" ? v.toFixed(k === "rsi" || k === "ema1" || k === "ema2" ? 0 : 2) : v}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: "Win Rate",      value: `${result.bestConfig.metrics.winRate.toFixed(1)}%` },
                  { label: "Profit Factor", value: result.bestConfig.metrics.profitFactor.toFixed(2) },
                  { label: "Sharpe",        value: result.bestConfig.metrics.sharpeRatio.toFixed(2) },
                  { label: "Max DD",        value: `${result.bestConfig.metrics.maxDrawdown.toFixed(1)}%` },
                  { label: "Trades",        value: result.bestConfig.metrics.totalTrades },
                ].map((m) => (
                  <div key={m.label} className="bg-slate-950/50 rounded-lg p-2 text-center border border-white/5">
                    <p className="text-[13px] font-bold text-slate-500 uppercase tracking-widest mb-1">{m.label}</p>
                    <p className="text-sm font-bold text-slate-200">{m.value}</p>
                  </div>
                ))}
              </div>
            </PremiumCardContent>
          </PremiumCard>

          {/* Top 20 table */}
          <PremiumCard className="overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 bg-slate-900/40 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-50 tracking-wide">Top {showAll ? 20 : 5} Configurations</span>
              <button onClick={() => setShowAll((v) => !v)} className="text-xs text-cyan-400 hover:text-cyan-300 font-medium">
                {showAll ? "Show less" : "Show all 20"}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-slate-400 bg-slate-900/20">
                    <th className="px-4 py-3 text-left font-bold uppercase tracking-wider font-sans">#</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Score</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Return</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">Win%</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">PF</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">RSI</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">EMA1</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">EMA2</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">TP%</th>
                    <th className="px-4 py-3 text-right font-bold uppercase tracking-wider font-sans">SL%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {configs.map((c) => (
                    <tr key={c.rank} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-slate-400">#{c.rank}</td>
                      <td className="px-4 py-3 text-right font-bold text-yellow-400">{c.score}</td>
                      <td className={`px-4 py-3 text-right ${c.metrics.returnPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {c.metrics.returnPct >= 0 ? "+" : ""}{c.metrics.returnPct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">{c.metrics.winRate.toFixed(0)}%</td>
                      <td className="px-4 py-3 text-right text-slate-300">{c.metrics.profitFactor.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-cyan-400">{c.params.rsi}</td>
                      <td className="px-4 py-3 text-right text-cyan-400">{c.params.ema1}</td>
                      <td className="px-4 py-3 text-right text-cyan-400">{c.params.ema2}</td>
                      <td className="px-4 py-3 text-right text-emerald-400">{c.params.tp.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-right text-rose-400">{c.params.sl.toFixed(1)}%</td>
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
