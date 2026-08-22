/**
 * BacktestView — Full backtesting dashboard.
 * Tabs: Run, Results (with replay + side-by-side compare), History
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine, LineChart, Line, Legend,
} from "recharts";
import { SERVER_URL } from "../config/urls";
import { PremiumStatCard } from "./premium/PremiumStatCard";
import { PremiumCard, PremiumCardContent, PremiumCardHeader, PremiumCardTitle } from "./premium/PremiumCard";

function authHeaders() {
  const token = localStorage.getItem("pcb_jwt");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface BacktestMetrics {
  totalReturnPct: number; netProfit: number; winRate: number;
  profitFactor: number; sharpeRatio: number; sortinoRatio: number;
  maxDrawdownPct: number; avgTrade: number; avgWin: number; avgLoss: number;
  largestWin: number; largestLoss: number; expectancy: number;
  riskRewardRatio: number; avgHoldMins: number; totalTrades: number;
  wins: number; losses: number; totalFees: number; finalBalance: number;
}

interface EquityPoint     { time: string; balance: number; drawdown: number; }
interface MonthlyReturn   { month: string; returnPct: number; trades: number; }
interface TradeDistBucket { bucket: string; count: number; }

interface BacktestCharts {
  equityCurve: EquityPoint[]; drawdownCurve: EquityPoint[];
  monthlyReturns: MonthlyReturn[]; tradeDistribution: TradeDistBucket[];
}

interface BtTrade {
  entryTime: string; exitTime: string; entryPrice: number; exitPrice: number;
  qty: number; notionalUsdt: number; pnlUsd: number; pnlPct: number;
  holdMins: number; exitReason: string; fees: number;
}

interface BacktestResult {
  params: Record<string, unknown>; metrics: BacktestMetrics;
  charts: BacktestCharts; trades: BtTrade[];
  candlesUsed: number; durationMs: number;
}

interface HistoryRow {
  id: number; strategy: string; symbol: string; timeframe: string;
  startDate: string; endDate: string; initialBalance: string;
  finalBalance: string | null; riskProfile: string; status: string;
  metrics: BacktestMetrics | null; durationMs: number | null;
  candlesUsed: number | null; createdAt: string;
}

interface FormParams {
  strategy: string; symbol: string; timeframe: string;
  startDate: string; endDate: string; initialBalance: number;
  tradingFeesPct: number; slippagePct: number;
  riskProfile: string; positionSizing: boolean;
}

const STRATEGIES = ["scalping", "day-trading", "swing", "dca", "grid"];
const SYMBOLS    = ["BTC_USDT", "ETH_USDT", "SOL_USDT", "BNB_USDT", "XRP_USDT", "ADA_USDT"];
const TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"];

function defaultParams(): FormParams {
  const now   = new Date();
  const end   = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  return {
    strategy: "swing", symbol: "BTC_USDT", timeframe: "1h",
    startDate: start, endDate: end, initialBalance: 1000,
    tradingFeesPct: 0.1, slippagePct: 0.05,
    riskProfile: "medium", positionSizing: true,
  };
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color = "text-white" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <PremiumStatCard
      title={label}
      value={value}
      subtitle={sub}
      valueColor={color.replace("text-white", "text-slate-50")}
    />
  );
}

function metricColor(val: number) {
  if (val > 0) return "text-green-400";
  if (val < 0) return "text-red-400";
  return "text-gray-300";
}

function fmt(n: number, dp = 2) { return n.toFixed(dp); }
function fmtUsd(n: number)      { return `$${Math.abs(n).toFixed(2)}`; }

// ─── Metrics grid ─────────────────────────────────────────────────────────────

function MetricsGrid({ m, initial }: { m: BacktestMetrics; initial: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      <MetricCard label="Net Profit"      value={`${m.netProfit >= 0 ? "+" : ""}$${fmt(m.netProfit)}`}  color={metricColor(m.netProfit)} />
      <MetricCard label="Total Return"    value={`${m.totalReturnPct >= 0 ? "+" : ""}${fmt(m.totalReturnPct)}%`} color={metricColor(m.totalReturnPct)} />
      <MetricCard label="Win Rate"        value={`${fmt(m.winRate)}%`}       sub={`${m.wins}W / ${m.losses}L`} color={m.winRate >= 50 ? "text-green-400" : "text-orange-400"} />
      <MetricCard label="Profit Factor"   value={fmt(m.profitFactor, 3)}    color={m.profitFactor >= 1 ? "text-green-400" : "text-red-400"} />
      <MetricCard label="Sharpe Ratio"    value={fmt(m.sharpeRatio, 3)}     color={m.sharpeRatio >= 1 ? "text-green-400" : m.sharpeRatio >= 0 ? "text-yellow-400" : "text-red-400"} />
      <MetricCard label="Sortino Ratio"   value={fmt(m.sortinoRatio, 3)}    color={m.sortinoRatio >= 1 ? "text-green-400" : "text-yellow-400"} />
      <MetricCard label="Max Drawdown"    value={`-${fmt(m.maxDrawdownPct)}%`} color="text-red-400" />
      <MetricCard label="Total Trades"    value={String(m.totalTrades)}     sub={`${fmt(m.avgHoldMins / 60, 1)}h avg hold`} />
      <MetricCard label="Avg Trade"       value={`${m.avgTrade >= 0 ? "+" : ""}$${fmt(m.avgTrade)}`} color={metricColor(m.avgTrade)} />
      <MetricCard label="Avg Win"         value={fmtUsd(m.avgWin)}          color="text-green-400" />
      <MetricCard label="Avg Loss"        value={`-${fmtUsd(m.avgLoss)}`}   color="text-red-400" />
      <MetricCard label="Expectancy"      value={`${m.expectancy >= 0 ? "+" : ""}$${fmt(m.expectancy)}`} color={metricColor(m.expectancy)} />
      <MetricCard label="Risk/Reward"     value={`1 : ${fmt(m.riskRewardRatio, 2)}`} />
      <MetricCard label="Largest Win"     value={fmtUsd(m.largestWin)}      color="text-green-400" />
      <MetricCard label="Largest Loss"    value={`-${fmtUsd(Math.abs(m.largestLoss))}`} color="text-red-400" />
      <MetricCard label="Total Fees"      value={fmtUsd(m.totalFees)}       color="text-yellow-400" />
      <MetricCard label="Final Balance"   value={`$${fmt(m.finalBalance)}`} color={m.finalBalance >= initial ? "text-green-400" : "text-red-400"} sub={`Started $${fmt(initial)}`} />
    </div>
  );
}

// ─── Equity chart ─────────────────────────────────────────────────────────────

function EquityChart({ data }: { data: EquityPoint[] }) {
  return (
    <PremiumCard hoverGlow>
      <PremiumCardContent className="p-4">
        <h3 className="text-base font-bold text-white mb-3">Equity Curve</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}   />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="time" tickFormatter={(v: string) => v.slice(0, 10)} tick={{ fill: "#6b7280", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8", fontSize: 11 }}
              formatter={(v: number) => [`${v.toFixed(2)}`, "Balance"]}
            />
            <Area type="monotone" dataKey="balance" stroke="#06b6d4" fill="url(#eqGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </PremiumCardContent>
    </PremiumCard>
  );
}

function DrawdownChart({ data }: { data: EquityPoint[] }) {
  return (
    <PremiumCard hoverGlow>
      <PremiumCardContent className="p-4">
        <h3 className="text-base font-bold text-white mb-3">Drawdown Curve</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0}   />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="time" tickFormatter={(v: string) => v.slice(0, 10)} tick={{ fill: "#6b7280", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={(v: number) => `-${v.toFixed(1)}%`} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8", fontSize: 11 }}
              formatter={(v: number) => [`${v.toFixed(2)}%`, "Drawdown"]}
            />
            <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="url(#ddGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </PremiumCardContent>
    </PremiumCard>
  );
}

function MonthlyChart({ data }: { data: MonthlyReturn[] }) {
  return (
    <PremiumCard hoverGlow>
      <PremiumCardContent className="p-4">
        <h3 className="text-base font-bold text-white mb-3">Monthly Returns</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 10 }} />
            <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8", fontSize: 11 }}
              formatter={(v: number) => [`${v.toFixed(2)}%`, "Return"]}
            />
            <ReferenceLine y={0} stroke="#374151" />
            <Bar dataKey="returnPct" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.returnPct >= 0 ? "#22c55e" : "#ef4444"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </PremiumCardContent>
    </PremiumCard>
  );
}

function DistChart({ data }: { data: TradeDistBucket[] }) {
  return (
    <PremiumCard hoverGlow>
      <PremiumCardContent className="p-4">
        <h3 className="text-base font-bold text-white mb-3">Trade P&L Distribution</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="bucket" tick={{ fill: "#6b7280", fontSize: 10 }} />
            <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8", fontSize: 11 }}
              formatter={(v: number) => [v, "Trades"]}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.bucket.startsWith("+") ? "#22c55e" : "#ef4444"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </PremiumCardContent>
    </PremiumCard>
  );
}

// ─── Trades table ─────────────────────────────────────────────────────────────

function TradesTable({ trades }: { trades: BtTrade[] }) {
  const [page, setPage] = useState(0);
  const PER   = 20;
  const total = Math.ceil(trades.length / PER);
  const slice = trades.slice(page * PER, page * PER + PER);

  return (
    <PremiumCard>
      <div className="px-4 py-4 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-base font-bold text-white">Trade Log <span className="text-slate-400 font-normal text-sm">({trades.length} trades)</span></h3>
        {total > 1 && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2 py-1 rounded bg-gray-800 disabled:opacity-30">prev</button>
            <span>{page + 1}/{total}</span>
            <button onClick={() => setPage((p) => Math.min(total - 1, p + 1))} disabled={page >= total - 1}
              className="px-2 py-1 rounded bg-gray-800 disabled:opacity-30">next</button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              {["Entry","Exit","Entry $","Exit $","Notional","P&L $","P&L %","Hold","Exit Reason","Fees"].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-gray-500 font-bold uppercase tracking-wider font-sans">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((t, i) => (
              <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{t.entryTime.slice(0,16).replace("T"," ")}</td>
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{t.exitTime.slice(0,16).replace("T"," ")}</td>
                <td className="px-3 py-2">${t.entryPrice.toFixed(2)}</td>
                <td className="px-3 py-2">${t.exitPrice.toFixed(2)}</td>
                <td className="px-3 py-2">${t.notionalUsdt.toFixed(2)}</td>
                <td className={`px-3 py-2 font-bold ${t.pnlUsd > 0 ? "text-green-400" : "text-red-400"}`}>
                  {t.pnlUsd > 0 ? "+" : ""}${t.pnlUsd.toFixed(2)}
                </td>
                <td className={`px-3 py-2 ${t.pnlPct > 0 ? "text-green-400" : "text-red-400"}`}>
                  {(t.pnlPct * 100).toFixed(2)}%
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {t.holdMins < 60 ? `${t.holdMins}m` : `${(t.holdMins/60).toFixed(1)}h`}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-sm font-medium ${
                    t.exitReason === "tp"     ? "bg-green-500/20 text-green-400" :
                    t.exitReason === "sl"     ? "bg-red-500/20 text-red-400" :
                    t.exitReason === "signal" ? "bg-blue-500/20 text-blue-400" :
                                               "bg-gray-500/20 text-gray-400"
                  }`}>{t.exitReason.toUpperCase()}</span>
                </td>
                <td className="px-3 py-2 text-yellow-400">${t.fees.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PremiumCard>
  );
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function exportJSON(result: BacktestResult, id: number) {
  const blob = new Blob([JSON.stringify({ id, ...result }, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a"); a.href = url;
  a.download = `backtest-${result.params.strategy as string}-${result.params.symbol as string}-${id}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function exportCSV(trades: BtTrade[], id: number) {
  const headers = ["entryTime","exitTime","entryPrice","exitPrice","qty","notionalUsdt","pnlUsd","pnlPct","holdMins","exitReason","fees"];
  const rows    = trades.map((t) => headers.map((h) => String(t[h as keyof BtTrade])).join(","));
  const csv     = [headers.join(","), ...rows].join("\n");
  const blob    = new Blob([csv], { type: "text/csv" });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement("a"); a.href = url;
  a.download    = `backtest-trades-${id}.csv`; a.click(); URL.revokeObjectURL(url);
}

// ─── Equity Replay Player ─────────────────────────────────────────────────────

const SPEEDS = [0.5, 1, 2, 4, 8];

function ReplayPlayer({ data }: { data: EquityPoint[] }) {
  const [frame,   setFrame]   = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed,   setSpeed]   = useState(1);
  const [jumpTo,  setJumpTo]  = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalFrames = data.length;

  const clearTimer = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  useEffect(() => {
    clearTimer();
    if (!playing) return;
    intervalRef.current = setInterval(() => {
      setFrame((f) => {
        if (f >= totalFrames - 1) { setPlaying(false); return f; }
        return f + 1;
      });
    }, Math.round(60 / speed));
    return clearTimer;
  }, [playing, speed, totalFrames]);

  // Jump to date
  const handleJump = () => {
    if (!jumpTo) return;
    const idx = data.findIndex((d) => d.time.startsWith(jumpTo));
    if (idx >= 0) setFrame(idx);
  };

  const visible = data.slice(0, Math.max(1, frame + 1));
  const current = data[frame];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-300">Equity Replay</h3>
        {current && (
          <span className="text-xs text-gray-400">
            {current.time.slice(0,10)} — <span className="text-cyan-400">${current.balance.toFixed(2)}</span>
            {" "}(<span className={current.drawdown > 0 ? "text-red-400" : "text-gray-500"}>-{current.drawdown.toFixed(1)}% DD</span>)
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={visible}>
          <defs>
            <linearGradient id="rpGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}   />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="time" tickFormatter={(v: string) => v.slice(0,10)} tick={{ fill: "#6b7280", fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
          <Tooltip
            contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
            labelStyle={{ color: "#9ca3af", fontSize: 11 }}
            formatter={(v: number) => [`$${v.toFixed(2)}`, "Balance"]}
          />
          <Area type="monotone" dataKey="balance" stroke="#06b6d4" fill="url(#rpGrad)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>

      {/* Scrubber */}
      <input
        type="range" min={0} max={Math.max(0, totalFrames - 1)} value={frame}
        onChange={(e) => { setFrame(Number(e.target.value)); setPlaying(false); }}
        className="w-full accent-cyan-500"
      />

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => { setFrame(0); setPlaying(false); }}
          className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700">
          Reset
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className={`text-xs px-3 py-1 rounded-lg font-semibold border transition-colors ${
            playing ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300" : "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
          }`}
        >
          {playing ? "Pause" : "Play"}
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Speed:</span>
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => setSpeed(s)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                speed === s ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300" : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <input
            type="date" value={jumpTo}
            onChange={(e) => setJumpTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white"
          />
          <button onClick={handleJump}
            className="text-xs px-2.5 py-1 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600">
            Jump
          </button>
        </div>

        <span className="text-xs text-gray-600 ml-auto">
          Frame {frame + 1} / {totalFrames}
        </span>
      </div>
    </div>
  );
}

// ─── Side-by-side compare chart ───────────────────────────────────────────────

function SideBySideChart({ resultA, resultB }: { resultA: BacktestResult; resultB: BacktestResult }) {
  // Build aligned equity data by index
  const maxLen = Math.max(resultA.charts.equityCurve.length, resultB.charts.equityCurve.length);
  const combined = Array.from({ length: maxLen }, (_, i) => ({
    idx: i,
    a:   resultA.charts.equityCurve[i]?.balance ?? null,
    b:   resultB.charts.equityCurve[i]?.balance ?? null,
  }));

  const labelA = `${String(resultA.params.strategy)} / ${String(resultA.params.symbol)}`;
  const labelB = `${String(resultB.params.strategy)} / ${String(resultB.params.symbol)}`;

  const metricsRows: Array<{ label: string; a: string | number; b: string | number; aGood?: boolean }> = [
    { label: "Total Return",  a: `${fmt(resultA.metrics.totalReturnPct)}%`,  b: `${fmt(resultB.metrics.totalReturnPct)}%`,  aGood: resultA.metrics.totalReturnPct >= resultB.metrics.totalReturnPct },
    { label: "Win Rate",      a: `${fmt(resultA.metrics.winRate)}%`,          b: `${fmt(resultB.metrics.winRate)}%`,          aGood: resultA.metrics.winRate >= resultB.metrics.winRate },
    { label: "Sharpe",        a: fmt(resultA.metrics.sharpeRatio, 3),          b: fmt(resultB.metrics.sharpeRatio, 3),          aGood: resultA.metrics.sharpeRatio >= resultB.metrics.sharpeRatio },
    { label: "Max DD",        a: `-${fmt(resultA.metrics.maxDrawdownPct)}%`,   b: `-${fmt(resultB.metrics.maxDrawdownPct)}%`,   aGood: resultA.metrics.maxDrawdownPct <= resultB.metrics.maxDrawdownPct },
    { label: "Profit Factor", a: fmt(resultA.metrics.profitFactor, 3),          b: fmt(resultB.metrics.profitFactor, 3),          aGood: resultA.metrics.profitFactor >= resultB.metrics.profitFactor },
    { label: "Total Trades",  a: resultA.metrics.totalTrades,                   b: resultB.metrics.totalTrades },
    { label: "Expectancy",    a: `$${fmt(resultA.metrics.expectancy)}`,          b: `$${fmt(resultB.metrics.expectancy)}`,          aGood: resultA.metrics.expectancy >= resultB.metrics.expectancy },
    { label: "Final Balance", a: `$${fmt(resultA.metrics.finalBalance)}`,        b: `$${fmt(resultB.metrics.finalBalance)}`,        aGood: resultA.metrics.finalBalance >= resultB.metrics.finalBalance },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Equity Comparison</h3>
        <div className="flex gap-4 mb-2 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-cyan-400 inline-block rounded"/>{labelA}</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-orange-400 inline-block rounded"/>{labelB}</span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={combined}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="idx" tick={{ fill: "#6b7280", fontSize: 10 }} />
            <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
              labelStyle={{ color: "#9ca3af", fontSize: 11 }}
              formatter={(v: number, name: string) => [`$${v.toFixed(2)}`, name === "a" ? labelA : labelB]}
            />
            <Legend formatter={(v) => v === "a" ? labelA : labelB} />
            <Line type="monotone" dataKey="a" stroke="#06b6d4" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="b" stroke="#f97316" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Metrics comparison table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <span className="text-sm font-semibold text-gray-300">Metrics Comparison</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="px-4 py-2 text-left uppercase tracking-wider font-sans font-bold">Metric</th>
                <th className="px-4 py-2 text-right text-cyan-400 uppercase tracking-wider font-sans font-bold">{labelA}</th>
                <th className="px-4 py-2 text-right text-orange-400 uppercase tracking-wider font-sans font-bold">{labelB}</th>
                <th className="px-4 py-2 text-center uppercase tracking-wider font-sans font-bold">Better</th>
              </tr>
            </thead>
            <tbody>
              {metricsRows.map((row) => (
                <tr key={row.label} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                  <td className="px-4 py-2.5 text-gray-400">{row.label}</td>
                  <td className={`px-4 py-2.5 text-right ${row.aGood === true ? "text-green-400 font-bold" : "text-gray-300"}`}>{row.a}</td>
                  <td className={`px-4 py-2.5 text-right ${row.aGood === false ? "text-green-400 font-bold" : "text-gray-300"}`}>{row.b}</td>
                  <td className="px-4 py-2.5 text-center">
                    {row.aGood === true  && <span className="text-xs text-cyan-400">A</span>}
                    {row.aGood === false && <span className="text-xs text-orange-400">B</span>}
                    {row.aGood === undefined && <span className="text-xs text-gray-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Results panel ────────────────────────────────────────────────────────────

function ResultsPanel({
  result, id, initial,
  compareResult, onClearCompare, onLoadCompare,
}: {
  result: BacktestResult; id: number; initial: number;
  compareResult: BacktestResult | null;
  onClearCompare: () => void;
  onLoadCompare: () => void;
}) {
  const [tab, setTab] = useState<"metrics" | "charts" | "replay" | "trades" | "compare">("metrics");
  const { metrics, charts, trades } = result;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-green-400 text-lg">+</span>
          <div>
            <p className="text-white font-bold capitalize">
              {result.params.strategy as string} · {result.params.symbol as string} · {result.params.timeframe as string}
            </p>
            <p className="text-gray-500 text-xs">
              {result.params.startDate as string} to {result.params.endDate as string} · {result.candlesUsed.toLocaleString()} candles · {(result.durationMs/1000).toFixed(1)}s
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => exportJSON(result, id)}
            className="px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 text-sm font-medium hover:bg-blue-500/25 transition-colors">
            JSON
          </button>
          <button onClick={() => exportCSV(trades, id)}
            className="px-3 py-1.5 rounded-lg bg-green-500/15 border border-green-500/30 text-green-400 text-sm font-medium hover:bg-green-500/25 transition-colors">
            CSV
          </button>
          {compareResult ? (
            <button onClick={onClearCompare}
              className="px-3 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/30 text-orange-400 text-sm font-medium hover:bg-orange-500/25">
              Clear Compare
            </button>
          ) : (
            <button onClick={onLoadCompare}
              className="px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 text-sm font-medium hover:bg-purple-500/25">
              + Compare
            </button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 overflow-x-auto">
        {(["metrics","charts","replay","trades","compare"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 min-w-16 py-1.5 rounded-lg text-sm font-semibold capitalize transition-all whitespace-nowrap ${
              tab === t ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "text-gray-500 hover:text-gray-300"
            }`}>{t}</button>
        ))}
      </div>

      {tab === "metrics" && <MetricsGrid m={metrics} initial={initial} />}

      {tab === "charts" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <EquityChart   data={charts.equityCurve}       />
          <DrawdownChart data={charts.drawdownCurve}     />
          <MonthlyChart  data={charts.monthlyReturns}    />
          <DistChart     data={charts.tradeDistribution} />
        </div>
      )}

      {tab === "replay" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Animate the equity curve candle-by-candle. Use Play/Pause, scrubber, speed controls, or jump directly to a date.</p>
          <ReplayPlayer data={charts.equityCurve} />
        </div>
      )}

      {tab === "trades" && <TradesTable trades={trades} />}

      {tab === "compare" && (
        compareResult
          ? <SideBySideChart resultA={result} resultB={compareResult} />
          : (
            <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-10 text-center space-y-3">
              <p className="text-gray-400 text-sm font-medium">No comparison loaded</p>
              <p className="text-gray-600 text-xs">Run a second backtest, then click &quot;Compare&quot; from the History tab to compare results side-by-side.</p>
              <button onClick={onLoadCompare}
                className="mx-auto px-5 py-2 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-400 text-sm font-semibold hover:bg-purple-500/30 transition-colors">
                Load from History
              </button>
            </div>
          )
      )}
    </div>
  );
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({
  onLoad, onCompare,
}: {
  onLoad: (id: number) => void;
  onCompare: (id: number) => void;
}) {
  const [rows,    setRows]    = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${SERVER_URL}/api/backtest/history?limit=50`, { headers: authHeaders() });
      const d = await r.json() as { ok: boolean; backtests: HistoryRow[] };
      if (d.ok) setRows(d.backtests);
    } finally { setLoading(false); setLoaded(true); }
  }, []);

  if (!loaded) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <p className="text-gray-500 text-sm">Load your past backtest runs</p>
        <button onClick={fetch_} disabled={loading}
          className="px-6 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-semibold text-sm hover:bg-cyan-500/30 transition-colors disabled:opacity-50">
          {loading ? "Loading..." : "Load History"}
        </button>
      </div>
    );
  }

  if (!rows.length) {
    return <div className="text-center py-16 text-gray-500 text-sm">No completed backtests yet. Run one to see it here.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-sm">{rows.length} past run{rows.length !== 1 ? "s" : ""}</p>
        <button onClick={fetch_} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Refresh</button>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                {["#","Strategy","Symbol","TF","Period","Balance","Return","Win Rate","Sharpe","DD","Trades","Status",""].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-gray-500 font-bold whitespace-nowrap uppercase tracking-wider font-sans">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const m = row.metrics;
                const ret = m ? m.totalReturnPct : null;
                return (
                  <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-3 py-2.5 text-gray-500">#{row.id}</td>
                    <td className="px-3 py-2.5 font-medium capitalize text-white">{row.strategy}</td>
                    <td className="px-3 py-2.5 text-cyan-400">{row.symbol}</td>
                    <td className="px-3 py-2.5 text-gray-400">{row.timeframe}</td>
                    <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">{row.startDate} to {row.endDate}</td>
                    <td className="px-3 py-2.5">${Number(row.initialBalance).toFixed(0)}</td>
                    <td className={`px-3 py-2.5 font-bold ${ret != null ? (ret >= 0 ? "text-green-400" : "text-red-400") : "text-gray-500"}`}>
                      {ret != null ? `${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5">{m ? `${m.winRate.toFixed(1)}%` : "—"}</td>
                    <td className="px-3 py-2.5">{m ? m.sharpeRatio.toFixed(2) : "—"}</td>
                    <td className={`px-3 py-2.5 ${m ? "text-red-400" : ""}`}>{m ? `-${m.maxDrawdownPct.toFixed(1)}%` : "—"}</td>
                    <td className="px-3 py-2.5">{m ? m.totalTrades : "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-sm font-medium ${
                        row.status === "completed" ? "bg-green-500/20 text-green-400" :
                        row.status === "running"   ? "bg-yellow-500/20 text-yellow-400" :
                                                     "bg-red-500/20 text-red-400"
                      }`}>{row.status}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {row.status === "completed" && (
                        <div className="flex gap-1">
                          <button onClick={() => onLoad(row.id)}
                            className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors text-sm font-medium">
                            View
                          </button>
                          <button onClick={() => onCompare(row.id)}
                            className="px-2 py-1 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors text-sm font-medium">
                            Compare
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main BacktestView ────────────────────────────────────────────────────────

export function BacktestView() {
  const [activeTab,     setActiveTab]     = useState<"run" | "results" | "history">("run");
  const [params,        setParams]        = useState<FormParams>(defaultParams());
  const [running,       setRunning]       = useState(false);
  const [progress,      setProgress]      = useState("");
  const [error,         setError]         = useState<string | null>(null);
  const [result,        setResult]        = useState<BacktestResult | null>(null);
  const [resultId,      setResultId]      = useState<number>(0);
  const [compareResult, setCompareResult] = useState<BacktestResult | null>(null);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const set = (key: keyof FormParams, val: unknown) =>
    setParams((p) => ({ ...p, [key]: val }));

  const handleRun = async () => {
    setError(null); setRunning(true);
    setProgress("Fetching historical candles from Gate.io...");
    abortRef.current = new AbortController();
    try {
      const body = { ...params, symbol: params.symbol.replace("/","_") };
      const res  = await fetch(`${SERVER_URL}/api/backtest/run`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify(body), signal: abortRef.current.signal,
      });
      const data = await res.json() as { ok: boolean; id?: number; result?: BacktestResult; error?: string };
      if (!data.ok || !data.result) { setError(data.error ?? "Unknown error"); }
      else { setResult(data.result); setResultId(data.id ?? 0); setActiveTab("results"); }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally { setRunning(false); setProgress(""); }
  };

  const loadResult = async (id: number): Promise<BacktestResult | null> => {
    try {
      const res = await fetch(`${SERVER_URL}/api/backtest/results/${id}`, { headers: authHeaders() });
      const d   = await res.json() as { ok: boolean; backtest?: Record<string, unknown> };
      if (d.ok && d.backtest) {
        const bt = d.backtest as {
          metrics: BacktestMetrics; charts: BacktestCharts; trades: BtTrade[];
          durationMs: number; candlesUsed: number;
          strategy: string; symbol: string; timeframe: string;
          startDate: string; endDate: string; initialBalance: string;
        };
        return {
          params: { strategy: bt.strategy, symbol: bt.symbol, timeframe: bt.timeframe, startDate: bt.startDate, endDate: bt.endDate },
          metrics: bt.metrics, charts: bt.charts, trades: bt.trades,
          durationMs: bt.durationMs ?? 0, candlesUsed: bt.candlesUsed ?? 0,
        };
      }
    } catch { /* ignore */ }
    return null;
  };

  const handleLoadResult = async (id: number) => {
    const r = await loadResult(id);
    if (r) { setResult(r); setResultId(id); setActiveTab("results"); }
  };

  const handleLoadCompare = async (id: number) => {
    const r = await loadResult(id);
    if (r) { setCompareResult(r); setShowCompareModal(false); setActiveTab("results"); }
  };

  const inputCls  = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors";
  const labelCls  = "text-sm font-medium text-gray-400 mb-1 block";
  const selectCls = inputCls;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-white">Backtesting Engine</h1>
          <p className="text-gray-500 text-sm">Simulate strategies on historical Gate.io data</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          Simulation Only — No Live Trading
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {([
          { id: "run" as const,     label: "Configure & Run" },
          { id: "results" as const, label: "Results" + (result ? "" : "") },
          { id: "history" as const, label: "History" },
        ]).map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === t.id
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                : "text-gray-500 hover:text-gray-300"
            }`}>{t.label}</button>
        ))}
      </div>

      {/* ── RUN TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "run" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Strategy & Market</h3>
              <div>
                <label className={labelCls}>Strategy</label>
                <select value={params.strategy} onChange={(e) => set("strategy", e.target.value)} className={selectCls}>
                  {STRATEGIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace("-"," ")}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Symbol</label>
                <select value={params.symbol} onChange={(e) => set("symbol", e.target.value)} className={selectCls}>
                  {SYMBOLS.map((s) => <option key={s} value={s}>{s.replace("_","/")}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Timeframe</label>
                <select value={params.timeframe} onChange={(e) => set("timeframe", e.target.value)} className={selectCls}>
                  {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                </select>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Date Range & Capital</h3>
              <div>
                <label className={labelCls}>Start Date</label>
                <input type="date" value={params.startDate} onChange={(e) => set("startDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>End Date</label>
                <input type="date" value={params.endDate} onChange={(e) => set("endDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Initial Balance (USDT)</label>
                <input type="number" min={10} value={params.initialBalance}
                  onChange={(e) => set("initialBalance", Number(e.target.value))} className={inputCls} />
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Risk & Fees</h3>
              <div>
                <label className={labelCls}>Risk Profile</label>
                <select value={params.riskProfile} onChange={(e) => set("riskProfile", e.target.value)} className={selectCls}>
                  <option value="low">Low (0.5%)</option>
                  <option value="medium">Medium (1%)</option>
                  <option value="high">High (2%)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Trading Fees (%)</label>
                <input type="number" step={0.01} min={0} max={5} value={params.tradingFeesPct}
                  onChange={(e) => set("tradingFeesPct", Number(e.target.value))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Slippage (%)</label>
                <input type="number" step={0.01} min={0} max={5} value={params.slippagePct}
                  onChange={(e) => set("slippagePct", Number(e.target.value))} className={inputCls} />
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-medium text-gray-400">Dynamic Position Sizing</span>
                <button onClick={() => set("positionSizing", !params.positionSizing)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${params.positionSizing ? "bg-cyan-500" : "bg-gray-700"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${params.positionSizing ? "left-5" : "left-0.5"}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            {error && (
              <div className="w-full max-w-lg bg-red-900/30 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm text-center">
                {error}
              </div>
            )}
            <button onClick={() => void handleRun()} disabled={running}
              className="px-10 py-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/20">
              {running ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {progress || "Running simulation..."}
                </span>
              ) : "Run Backtest"}
            </button>
            {running && (
              <button onClick={() => abortRef.current?.abort()}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors">
                Cancel
              </button>
            )}
            <p className="text-gray-600 text-xs">
              Uses {params.strategy} strategy on {params.symbol} · {params.timeframe} candles
            </p>
          </div>
        </div>
      )}

      {/* ── RESULTS TAB ─────────────────────────────────────────────────── */}
      {activeTab === "results" && (
        result
          ? <ResultsPanel
              result={result}
              id={resultId}
              initial={params.initialBalance}
              compareResult={compareResult}
              onClearCompare={() => setCompareResult(null)}
              onLoadCompare={() => setShowCompareModal(true)}
            />
          : (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-gray-500 text-sm font-medium">No results yet</p>
              <p className="text-gray-600 text-sm">Configure and run a backtest to see results here</p>
              <button onClick={() => setActiveTab("run")}
                className="mt-2 px-6 py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-sm font-medium hover:bg-cyan-500/30 transition-colors">
                Go to Run
              </button>
            </div>
          )
      )}

      {/* ── HISTORY TAB ─────────────────────────────────────────────────── */}
      {activeTab === "history" && (
        <HistoryTab
          onLoad={(id) => void handleLoadResult(id)}
          onCompare={(id) => void handleLoadCompare(id)}
        />
      )}

      {/* Compare-load modal overlay */}
      {showCompareModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold">Load Comparison Backtest</h3>
              <button onClick={() => setShowCompareModal(false)} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
            </div>
            <p className="text-gray-400 text-sm">Select a completed backtest from history to compare side-by-side.</p>
            <HistoryTab
              onLoad={(id) => void handleLoadResult(id)}
              onCompare={(id) => void handleLoadCompare(id)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
