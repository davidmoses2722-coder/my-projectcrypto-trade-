import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import { Brain, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, ArrowRightLeft, Zap, Target, Activity } from "lucide-react";
import { motion } from "framer-motion";

interface RegimeIndicators {
  adx: number; adxDi14Plus: number; adxDi14Minus: number;
  bollingerWidth: number; atrCurrent: number; atrAverage: number; atrRatio: number;
  trendStrengthScore: number; rsi: number; ema50: number; ema200: number; priceAboveEma200: boolean;
}

interface EnhancedRegimeResult {
  regime: string; confidence: number; indicators: RegimeIndicators;
  description: string; strategyWeights: Record<string, number>;
  tradingBias: "bullish" | "bearish" | "neutral"; computedAt: string;
}

const REGIME_STYLES: Record<string, string> = {
  strong_trend:           "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  weak_trend:             "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  range:                  "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
  breakout:               "text-orange-400 bg-orange-500/10 border-orange-500/30",
  volatility_expansion:   "text-rose-400 bg-rose-500/10 border-rose-500/30",
  volatility_compression: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  unknown:                "text-slate-400 bg-slate-500/10 border-slate-500/30",
};

const REGIME_ICONS: Record<string, React.ElementType> = {
  strong_trend: TrendingUp, weak_trend: Activity, range: ArrowRightLeft, breakout: Zap,
  volatility_expansion: Target, volatility_compression: AlertTriangle, unknown: AlertTriangle,
};

function Gauge({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 70 ? "bg-emerald-400" : pct >= 40 ? "bg-yellow-400" : "bg-slate-600";
  return (
    <div className="bg-slate-900/50 p-3 rounded-lg border border-white/5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
        <span className="text-xs font-bold text-slate-200">{typeof value === "number" ? value.toFixed(1) : value}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={`h-full rounded-full ${color}`} 
        />
      </div>
    </div>
  );
}

export function RegimeIntelligencePanel() {
  const [symbol,    setSymbol]    = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [result,    setResult]    = useState<EnhancedRegimeResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("pcb_jwt") ?? ""}` });

  const analyze = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${SERVER_URL}/api/regime-intelligence/analyze`, {
        method: "POST", headers: auth(),
        body: JSON.stringify({ symbol, timeframe, limit: 200 }),
      });
      const data = await res.json() as { ok: boolean; data?: EnhancedRegimeResult; error?: string };
      if (data.ok && data.data) setResult(data.data);
      else setError(data.error ?? "Failed to analyze regime");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [symbol, timeframe]);

  useEffect(() => { void analyze(); }, [analyze]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void analyze(), 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, analyze]);

  const RegimeIcon = result ? (REGIME_ICONS[result.regime] || AlertTriangle) : AlertTriangle;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-50 flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            Regime Intelligence
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">ADX · Bollinger Width · ATR · Trend Strength — advanced regime classification</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-slate-400 cursor-pointer hover:text-slate-300">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} 
              className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900" />
            Auto
          </label>
          <button onClick={() => void analyze()} disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:bg-purple-500/25 flex items-center gap-1.5 transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Analyze
          </button>
        </div>
      </div>

      <PremiumCard>
        <PremiumCardContent className="p-3 flex gap-3">
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}
            className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 focus:ring-1 focus:ring-purple-500 outline-none">
            {["BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT","DOGE/USDT"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}
            className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-50 focus:ring-1 focus:ring-purple-500 outline-none">
            {["15m","1h","4h","1d"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </PremiumCardContent>
      </PremiumCard>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Regime badge */}
          <PremiumCard animatedBorder className={REGIME_STYLES[result.regime] ?? REGIME_STYLES["unknown"]}>
            <PremiumCardContent className="p-5 bg-black/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-black/30 backdrop-blur-sm shadow-inner">
                    <RegimeIcon className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="text-lg font-black uppercase tracking-widest text-white shadow-sm">
                      {result.regime.replace(/_/g, " ")}
                    </p>
                    <p className="text-sm font-medium mt-0.5 text-white/80">{result.description}</p>
                  </div>
                </div>
                <div className="text-right shrink-0 bg-black/20 px-4 py-2 rounded-xl border border-white/10">
                  <p className="text-[13px] font-bold uppercase tracking-wider opacity-80 mb-1">Confidence</p>
                  <p className="text-3xl font-black shadow-sm">{result.confidence}<span className="text-lg opacity-70">%</span></p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[13px] font-bold px-3 py-1 rounded-full font-bold uppercase tracking-widest border shadow-sm flex items-center gap-1.5 ${result.tradingBias === "bullish" ? "text-emerald-400 bg-emerald-500/20 border-emerald-500/30" : result.tradingBias === "bearish" ? "text-rose-400 bg-rose-500/20 border-rose-500/30" : "text-slate-300 bg-slate-500/20 border-slate-500/30"}`}>
                  {result.tradingBias === "bullish" ? <TrendingUp className="w-3 h-3" /> : result.tradingBias === "bearish" ? <TrendingDown className="w-3 h-3" /> : <ArrowRightLeft className="w-3 h-3" />}
                  {result.tradingBias} Bias
                </span>
                <span className={`text-[13px] font-bold px-3 py-1 rounded-full font-bold uppercase tracking-widest border shadow-sm ${result.indicators.priceAboveEma200 ? "text-emerald-400 bg-emerald-500/20 border-emerald-500/30" : "text-rose-400 bg-rose-500/20 border-rose-500/30"}`}>
                  {result.indicators.priceAboveEma200 ? "Price > EMA200" : "Price < EMA200"}
                </span>
              </div>
            </PremiumCardContent>
          </PremiumCard>

          {/* Indicators */}
          <PremiumCard>
            <PremiumCardContent className="p-4">
              <p className="text-[13px] font-bold font-semibold text-slate-50 uppercase tracking-widest mb-4">Technical Indicators</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Gauge value={result.indicators.adx}               max={100} label={`ADX — Trend Strength`} />
                <Gauge value={result.indicators.trendStrengthScore} max={100} label="Trend Strength Score" />
                <Gauge value={result.indicators.bollingerWidth}     max={20}  label={`Bollinger Width (%)`} />
                <Gauge value={result.indicators.atrRatio * 50}      max={100} label={`ATR Ratio (×)`} />
                <Gauge value={result.indicators.rsi}                max={100} label={`RSI`} />
                <div className="bg-slate-900/50 p-3 rounded-lg border border-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">+DI / -DI (Directional)</span>
                    <span className="text-xs font-bold text-slate-200">{result.indicators.adxDi14Plus.toFixed(1)} / {result.indicators.adxDi14Minus.toFixed(1)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, result.indicators.adxDi14Plus)}%` }} transition={{ duration: 1 }} className="h-full bg-emerald-500" />
                    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, result.indicators.adxDi14Minus)}%` }} transition={{ duration: 1 }} className="h-full bg-rose-500" />
                  </div>
                </div>
              </div>
            </PremiumCardContent>
          </PremiumCard>

          {/* Strategy weights */}
          <PremiumCard>
            <PremiumCardContent className="p-4">
              <p className="text-[13px] font-bold font-semibold text-slate-50 uppercase tracking-widest mb-4">Strategy Weight Multipliers</p>
              <div className="space-y-3">
                {Object.entries(result.strategyWeights).sort(([, a], [, b]) => b - a).map(([strat, weight], i) => (
                  <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} key={strat} className="flex items-center gap-4 bg-slate-900/40 p-2.5 rounded-lg border border-white/5">
                    <span className="text-sm font-medium text-slate-200 w-28 capitalize">{strat.replace("-", " ")}</span>
                    <div className="flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, weight * 50)}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className={`h-full rounded-full ${weight >= 1.5 ? "bg-emerald-500" : weight >= 1.0 ? "bg-cyan-500" : "bg-slate-600"}`}
                      />
                    </div>
                    <span className={`text-sm font-bold w-12 text-right ${weight >= 1.5 ? "text-emerald-400" : weight >= 1.0 ? "text-cyan-400" : "text-slate-400"}`}>
                      ×{weight.toFixed(1)}
                    </span>
                  </motion.div>
                ))}
              </div>
            </PremiumCardContent>
          </PremiumCard>
        </motion.div>
      )}

      {loading && !result && (
        <PremiumCard>
          <PremiumCardContent className="py-12 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 text-purple-400 animate-spin mb-4" />
            <p className="text-slate-400 text-sm font-medium">Analyzing market regime…</p>
          </PremiumCardContent>
        </PremiumCard>
      )}
    </div>
  );
}
