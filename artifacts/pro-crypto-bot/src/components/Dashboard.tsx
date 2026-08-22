import { useState, useEffect, useCallback } from "react";
import { CoinPrice, Signal, Trade, PortfolioAsset } from "../types/crypto";
import { PriceCard } from "./PriceCard";
import { SignalCard } from "./SignalCard";
import { MarketOverview } from "./MarketOverview";
import { SERVER_URL } from "../config/urls";
import { PositionActionButtons } from "./PositionActionButtons";
import { OpenPositionCard } from "./OpenPositionCard";
import { useAnalytics } from "../hooks/useAnalytics";
import { PremiumStatCard } from "./premium/PremiumStatCard";
import { StatusBadge } from "./premium/StatusBadge";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Wallet, Activity, Target, BarChart2, Bot, Server, Wifi, TrendingUp, TrendingDown, Microscope } from "lucide-react";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DashboardProps {
  prices: CoinPrice[];
  signals: Signal[];
  trades: Trade[];
  portfolio: PortfolioAsset[];
  totalPnL: number;
  fearGreedIndex: number;
  isBotRunning: boolean;
  activeStrategy?: string;
  onTabChange: (tab: string) => void;
  connectionStatus?: "connecting" | "live" | "simulated";
}

// ─── Equity Curve Chart ───────────────────────────────────────────────────────

function EquityCurveChart({ serverUrl }: { serverUrl: string }) {
  const { snapshot, loading, error } = useAnalytics(serverUrl);

  const data = snapshot?.equityCurve ?? [];

  // Format x-axis date labels
  const fmt = (d: string) => {
    try {
      return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return d;
    }
  };

  const minPnl = data.length > 0 ? Math.min(...data.map((d) => d.cumPnl)) : 0;
  const maxPnl = data.length > 0 ? Math.max(...data.map((d) => d.cumPnl)) : 0;
  const latestPnl = data.length > 0 ? data[data.length - 1].cumPnl : null;
  const isPositive = (latestPnl ?? 0) >= 0;

  return (
    <PremiumCard>
      <PremiumCardContent className="p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-semibold text-sm tracking-wide uppercase">Equity Curve</h3>
            <p className="text-slate-500 text-xs">Cumulative P&amp;L</p>
          </div>
          {latestPnl !== null && (
            <span className={`text-sm font-bold ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
              {isPositive ? "+" : ""}${latestPnl.toFixed(2)}
            </span>
          )}
        </div>

        {loading && data.length === 0 && (
          <div className="h-48 flex items-center justify-center">
            <span className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        )}

        {!loading && error && data.length === 0 && (
          <div className="h-48 flex items-center justify-center text-slate-500 text-xs">
            No equity data yet — start trading to build a curve.
          </div>
        )}

        {!loading && !error && data.length === 0 && (
          <div className="h-48 flex items-center justify-center text-slate-500 text-xs">
            No trades recorded yet.
          </div>
        )}

        {data.length > 0 && (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickFormatter={fmt}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  dy={10}
                />
                <YAxis
                  domain={[Math.min(minPnl * 1.1, minPnl - 1), Math.max(maxPnl * 1.1, maxPnl + 1)]}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  width={40}
                  dx={-10}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#090a0f", border: "1px solid #0ea5e9", borderRadius: 8, fontSize: 13, fontFamily: "Inter, sans-serif" }}
                  labelFormatter={(l: string) => fmt(l)}
                  formatter={(v: number) => [`$${v.toFixed(2)}`, "Cum. P&L"]}
                />
                <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="cumPnl"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  fill="url(#equityGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#0ea5e9", stroke: "#090a0f", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </PremiumCardContent>
    </PremiumCard>
  );
}

// ─── Account Metrics Panel ────────────────────────────────────────────────────

interface AccountMetricsProps {
  trades: Trade[];
  totalPnL: number;
  isBotRunning: boolean;
  activeStrategy?: string;
  connectionStatus?: "connecting" | "live" | "simulated";
  serverStatus: {
    balanceUSDT: number;
    winRate: string;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    performance?: {
      totalPnlUsd: number;
      weekly7dPnl: number;
      monthly30dPnl: number;
      riskRewardRatio?: number;
      avgHoldMins?: number;
    } | null;
    portfolio?: {
      openCount: number;
      totalUnrealizedPnl: number;
    } | null;
    mode: string;
    activeStrategy?: string;
    connection: "disconnected" | "connecting" | "connected" | "error";
  };
}

function AccountMetrics({ trades, totalPnL, isBotRunning, connectionStatus, serverStatus }: AccountMetricsProps) {
  const closedTrades  = trades.filter((t) => t.status === "closed");
  const openTrades    = trades.filter((t) => t.status === "open");
  const wins          = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const losses        = closedTrades.filter((t) => (t.pnl ?? 0) < 0).length;
  const totalClosed   = closedTrades.length;
  const winRate       = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;
  const lossRate      = totalClosed > 0 ? (losses / totalClosed) * 100 : 0;

  // Today's trades (last 24h)
  const now           = Date.now();
  const todayTrades   = trades.filter((t) => {
    try { return now - new Date(t.timestamp).getTime() < 86_400_000; } catch { return false; }
  }).length;

  const perf          = serverStatus.performance;
  const port          = serverStatus.portfolio;

  const realizedPnL   = perf?.totalPnlUsd ?? totalPnL;
  const unrealizedPnL = port?.totalUnrealizedPnl ?? 0;
  const equity        = (serverStatus.balanceUSDT || 0) + unrealizedPnL;
  const weekly        = perf?.weekly7dPnl;
  const monthly       = perf?.monthly30dPnl;

  const serverUp      = serverStatus.connection === "connected";
  const wsOk          = connectionStatus === "live" || connectionStatus === "simulated";

  return (
    <div className="space-y-4">
      {/* Connection health row */}
      <PremiumCard>
        <PremiumCardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="text-cyan-400" size={16} />
            <p className="text-slate-400 text-[13px] font-bold uppercase tracking-wider tracking-widest">System Health</p>
          </div>
          <div className="space-y-2 mb-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-400"><Server size={14}/> API Server</span>
              <StatusBadge variant={serverUp ? "live" : "offline"} label={serverUp ? "CONNECTED" : "OFFLINE"} pulse={serverUp} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-400"><Wifi size={14}/> WebSocket Feed</span>
              <StatusBadge variant={wsOk ? (connectionStatus === "live" ? "live" : "simulated") : "connecting"} label={wsOk ? (connectionStatus === "live" ? "LIVE" : "SIM") : "WAITING"} pulse={wsOk} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-400"><Bot size={14}/> Bot Engine</span>
              <StatusBadge variant={isBotRunning ? "live" : "offline"} label={isBotRunning ? "RUNNING" : "STOPPED"} pulse={isBotRunning} />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-white/5">
            <span className="text-slate-500 text-[13px] font-bold uppercase tracking-wider">Mode</span>
            <StatusBadge 
              variant={serverStatus.mode === "LIVE" ? "live" : serverStatus.mode === "PAPER" ? "simulated" : "offline"} 
              label={serverStatus.mode}
            />
          </div>
          {serverStatus.activeStrategy && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-slate-500 text-[13px] font-bold uppercase tracking-wider">Strategy</span>
              <span className="text-sm font-semibold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">{serverStatus.activeStrategy}</span>
            </div>
          )}
        </PremiumCardContent>
      </PremiumCard>

      {/* Account equity + balance */}
      <div className="grid grid-cols-2 gap-3">
        <PremiumCard>
          <PremiumCardContent className="p-4">
            <p className="text-slate-500 text-[13px] font-bold mb-1 uppercase tracking-wide">Balance (USDT)</p>
            <p className="text-white font-bold text-lg">
              {serverStatus.balanceUSDT > 0
                ? `$${serverStatus.balanceUSDT.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : "—"}
            </p>
            <p className="text-slate-500 text-[13px] font-bold uppercase mt-1 tracking-wider">Available</p>
          </PremiumCardContent>
        </PremiumCard>
        <PremiumCard>
          <PremiumCardContent className="p-4">
            <p className="text-slate-500 text-[13px] font-bold mb-1 uppercase tracking-wide">Equity</p>
            <p className={`font-bold text-lg ${equity > 0 ? "text-white" : "text-slate-500"}`}>
              {equity > 0 ? `$${equity.toFixed(2)}` : "—"}
            </p>
            <p className="text-slate-500 text-[13px] font-bold uppercase mt-1 tracking-wider">Total Value</p>
          </PremiumCardContent>
        </PremiumCard>
      </div>

      {/* P&L breakdown */}
      <PremiumCard>
        <PremiumCardContent className="p-4 space-y-3">
          <p className="text-slate-400 text-[13px] font-bold uppercase tracking-wider tracking-widest flex items-center gap-1.5"><Activity size={14}/> P&amp;L Breakdown</p>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Realized P&amp;L</span>
            <span className={`font-bold ${realizedPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {realizedPnL >= 0 ? "+" : ""}${realizedPnL.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Unrealized P&amp;L</span>
            <span className={`font-bold ${unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {unrealizedPnL >= 0 ? "+" : ""}${unrealizedPnL.toFixed(2)}
            </span>
          </div>
          {weekly !== undefined && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Weekly (7d)</span>
              <span className={`font-bold ${(weekly ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {(weekly ?? 0) >= 0 ? "+" : ""}${(weekly ?? 0).toFixed(2)}
              </span>
            </div>
          )}
          {monthly !== undefined && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Monthly (30d)</span>
              <span className={`font-bold ${(monthly ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {(monthly ?? 0) >= 0 ? "+" : ""}${(monthly ?? 0).toFixed(2)}
              </span>
            </div>
          )}
        </PremiumCardContent>
      </PremiumCard>

      {/* Trade stats */}
      <PremiumCard>
        <PremiumCardContent className="p-4 space-y-3">
          <p className="text-slate-400 text-[13px] font-bold uppercase tracking-wider tracking-widest flex items-center gap-1.5"><BarChart2 size={14}/> Trade Statistics</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider">Total Trades</p>
              <p className="text-white font-bold">{serverStatus.totalTrades || totalClosed}</p>
            </div>
            <div>
              <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider">Active Positions</p>
              <p className="text-white font-bold">{port?.openCount ?? openTrades.length}</p>
            </div>
            <div>
              <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider">Today's Trades</p>
              <p className="text-white font-bold">{todayTrades}</p>
            </div>
            <div>
              <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider">Win Rate</p>
              <p className={`font-bold ${winRate >= 55 ? "text-emerald-400" : winRate >= 40 ? "text-amber-400" : "text-rose-400"}`}>
                {serverStatus.winRate !== "0" ? `${serverStatus.winRate}%` : `${winRate.toFixed(1)}%`}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider">Loss Rate</p>
              <p className={`font-bold ${lossRate <= 45 ? "text-emerald-400" : "text-rose-400"}`}>
                {lossRate.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider">Wins / Losses</p>
              <p className="text-white font-bold">
                <span className="text-emerald-400">{serverStatus.winningTrades || wins}</span>
                <span className="text-slate-500 mx-1">/</span>
                <span className="text-rose-400">{serverStatus.losingTrades || losses}</span>
              </p>
            </div>
          </div>
        </PremiumCardContent>
      </PremiumCard>
    </div>
  );
}

// ─── Heatmap cell ─────────────────────────────────────────────────────────────

function HeatmapCell({ coin }: { coin: CoinPrice }) {
  const pct  = coin.changePercent24h;
  const abs  = Math.abs(pct);
  const intensity = Math.min(abs / 5, 1);
  const isUp = pct >= 0;
  const bg = isUp
    ? `rgba(16, 185, 129, ${0.1 + intensity * 0.4})`
    : `rgba(244, 63, 94, ${0.1 + intensity * 0.4})`;

  return (
    <div
      className="rounded-lg p-3 flex flex-col items-center justify-center border border-transparent hover:border-slate-600 transition-all cursor-default"
      style={{ backgroundColor: bg }}
    >
      <p className="text-white text-xs font-bold">{coin.symbol}</p>
      <p className={`text-sm font-semibold ${isUp ? "text-emerald-300" : "text-rose-300"}`}>
        {isUp ? "+" : ""}{pct.toFixed(2)}%
      </p>
    </div>
  );
}

// ─── Conservative Scalping v2 Status Panel ────────────────────────────────────

interface CSCounters {
  ok: boolean;
  version: string;
  month: string;
  monthlyTotal: number;
  monthlyCap: number;
  dailyTotal: number;
  dailyCap: number;
  bySymbol: Record<string, number>;
  symbolMonthlyCap: number;
  projection: number;
  targetMin: number;
  targetMax: number;
  approvedSymbols: string[];
  params: {
    trendframe: string;
    entryframe: string;
    rsiBuyLow: number;
    rsiBuyHigh: number;
    volumeRatio: number;
    atrMinPct: number;
    atrMaxPct: number;
    stopLossPct: number;
    takeProfitPct: number;
    minConditions: number;
  };
}

function ConservativeScalpingPanel() {
  const [data, setData] = useState<CSCounters | null>(null);

  const fetchData = useCallback(() => {
    const token = localStorage.getItem("pcb_jwt") ?? "";
    fetch(`${SERVER_URL}/api/strategy/conservative-scalping/counters`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d as CSCounters); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const monthPct   = data ? (data.monthlyTotal / data.monthlyCap) * 100 : 0;
  const onTarget   = data ? data.projection >= data.targetMin && data.projection <= data.targetMax : null;
  const topSymbols = data
    ? Object.entries(data.bySymbol).sort(([,a],[,b]) => b - a).slice(0, 5)
    : [];

  return (
    <PremiumCard animatedBorder>
      <PremiumCardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusBadge variant="live" label="CONSERVATIVE SCALPING v2" glow pulse />
            <span className="text-slate-500 text-sm font-semibold tracking-wider">Phase 8.4</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded text-slate-300 bg-slate-800 font-sans font-semibold">15m trend</span>
            <span className="text-slate-500">→</span>
            <span className="px-2 py-0.5 rounded text-slate-300 bg-slate-800 font-sans font-semibold">15m entry</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 text-center border border-white/5">
            <p className="text-slate-400 text-[13px] font-bold uppercase tracking-wider mb-1">This Month</p>
            <p className="text-white font-black text-2xl">{data?.monthlyTotal ?? "—"}</p>
            <p className="text-slate-500 text-xs mt-1">/ {data?.monthlyCap ?? 60} cap</p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 text-center border border-white/5">
            <p className="text-slate-400 text-[13px] font-bold uppercase tracking-wider mb-1">Today</p>
            <p className="text-white font-black text-2xl">{data?.dailyTotal ?? "—"}</p>
            <p className="text-slate-500 text-xs mt-1">/ {data?.dailyCap ?? 6} cap</p>
          </div>
          <div className={`rounded-xl p-4 text-center border ${
            onTarget === null ? "bg-slate-800/50 border-white/5" :
            onTarget ? "bg-emerald-500/10 border-emerald-500/30" : "bg-amber-500/10 border-amber-500/30"
          }`}>
            <p className="text-slate-400 text-[13px] font-bold uppercase tracking-wider mb-1">Projection</p>
            <p className={`font-black text-2xl ${onTarget ? "text-emerald-400" : "text-amber-400"}`}>
              {data ? `~${data.projection}` : "—"}
            </p>
            <p className="text-slate-500 text-xs mt-1">target 30–60</p>
          </div>
        </div>
        {data && (
          <div>
            <div className="flex justify-between text-[13px] font-bold text-slate-400 mb-2 uppercase tracking-wide font-medium">
              <span>Monthly Progress: {data.monthlyTotal}</span>
              <span>{monthPct.toFixed(0)}% of cap</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  monthPct >= 100 ? "bg-rose-500" : monthPct >= 67 ? "bg-amber-500" : "bg-cyan-500"
                }`}
                style={{ width: `${Math.min(monthPct, 100)}%` }}
              />
            </div>
          </div>
        )}
        {topSymbols.length > 0 && (
          <div className="pt-2">
            <p className="text-slate-400 text-[13px] font-bold mb-3 uppercase tracking-wide font-medium">Trades by symbol this month</p>
            <div className="space-y-2.5">
              {topSymbols.map(([sym, count]) => (
                <div key={sym} className="flex items-center gap-3">
                  <span className="text-slate-300 text-sm font-semibold font-bold w-16 shrink-0">{sym}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 rounded-full"
                      style={{ width: `${Math.min((count / (data?.symbolMonthlyCap ?? 15)) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-slate-400 text-sm font-semibold w-10 text-right">{count}/{data?.symbolMonthlyCap ?? 15}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 flex-wrap text-xs pt-2">
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">EMA50/200 trend (15m)</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">EMA9/21 entry (15m)</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">RSI 38–68</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">Vol ≥0.7×</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">SL 0.7% / TP 1.2%</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">Min 4/6 conditions</span>
        </div>
      </PremiumCardContent>
    </PremiumCard>
  );
}

// ─── Active Swing Status Panel ────────────────────────────────────────────────

interface ASCounters {
  month: string;
  monthlyTotal: number;
  monthlyCap: number;
  dailyTotal: number;
  dailyCap: number;
  bySymbol: Record<string, number>;
  symbolMonthlyCap: number;
  projection: number;
  targetMin: number;
  targetMax: number;
  approvedSymbols: string[];
}

function ActiveSwingPanel() {
  const [data, setData] = useState<ASCounters | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("pcb_jwt") ?? "";
    fetch(`${SERVER_URL}/api/strategy/active-swing/counters`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d as ASCounters); })
      .catch(() => {});

    const id = setInterval(() => {
      const tok = localStorage.getItem("pcb_jwt") ?? "";
      fetch(`${SERVER_URL}/api/strategy/active-swing/counters`, {
        headers: { Authorization: `Bearer ${tok}` },
      })
        .then(r => r.json())
        .then(d => { if (d.ok) setData(d as ASCounters); })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const monthPct  = data ? (data.monthlyTotal / data.monthlyCap) * 100 : 0;
  const onTarget  = data ? data.projection >= data.targetMin && data.projection <= data.targetMax : null;
  const topSymbols = data
    ? Object.entries(data.bySymbol).sort(([,a],[,b]) => b - a).slice(0, 5)
    : [];

  return (
    <PremiumCard animatedBorder>
      <PremiumCardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusBadge variant="live" label="ACTIVE SWING" className="!bg-purple-500/20 !text-purple-300 !border-purple-500/40" />
            <span className="text-slate-500 text-sm font-semibold tracking-wider">Phase 8.5</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded text-slate-300 bg-slate-800 font-sans font-semibold">4h trend</span>
            <span className="text-slate-500">→</span>
            <span className="px-2 py-0.5 rounded text-slate-300 bg-slate-800 font-sans font-semibold">4h entry</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 text-center border border-white/5">
            <p className="text-slate-400 text-[13px] font-bold uppercase tracking-wider mb-1">This Month</p>
            <p className="text-white font-black text-2xl">{data?.monthlyTotal ?? "—"}</p>
            <p className="text-slate-500 text-xs mt-1">/ {data?.monthlyCap ?? 25} cap</p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 text-center border border-white/5">
            <p className="text-slate-400 text-[13px] font-bold uppercase tracking-wider mb-1">Today</p>
            <p className="text-white font-black text-2xl">{data?.dailyTotal ?? "—"}</p>
            <p className="text-slate-500 text-xs mt-1">/ {data?.dailyCap ?? 2} cap</p>
          </div>
          <div className={`rounded-xl p-4 text-center border ${
            onTarget === null ? "bg-slate-800/50 border-white/5" :
            onTarget ? "bg-emerald-500/10 border-emerald-500/30" : "bg-amber-500/10 border-amber-500/30"
          }`}>
            <p className="text-slate-400 text-[13px] font-bold uppercase tracking-wider mb-1">Projection</p>
            <p className={`font-black text-2xl ${onTarget ? "text-emerald-400" : "text-amber-400"}`}>
              {data ? `~${data.projection}` : "—"}
            </p>
            <p className="text-slate-500 text-xs mt-1">target 15–25</p>
          </div>
        </div>
        {data && (
          <div>
            <div className="flex justify-between text-[13px] font-bold text-slate-400 mb-2 uppercase tracking-wide font-medium">
              <span>Monthly Progress: {data.monthlyTotal}</span>
              <span>{monthPct.toFixed(0)}% of cap</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  monthPct >= 100 ? "bg-rose-500" : monthPct >= 67 ? "bg-amber-500" : "bg-purple-500"
                }`}
                style={{ width: `${Math.min(monthPct, 100)}%` }}
              />
            </div>
          </div>
        )}
        {topSymbols.length > 0 && (
          <div className="pt-2">
            <p className="text-slate-400 text-[13px] font-bold mb-3 uppercase tracking-wide font-medium">Trades by symbol this month</p>
            <div className="space-y-2.5">
              {topSymbols.map(([sym, count]) => (
                <div key={sym} className="flex items-center gap-3">
                  <span className="text-slate-300 text-sm font-semibold font-bold w-16 shrink-0">{sym}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full"
                      style={{ width: `${Math.min((count / (data?.symbolMonthlyCap ?? 10)) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-slate-400 text-sm font-semibold w-10 text-right">{count}/{data?.symbolMonthlyCap ?? 10}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 flex-wrap text-xs pt-2">
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">EMA50/200 trend (4h)</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">EMA20/50 entry (4h)</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">RSI 35–65</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">Vol ≥0.8×</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">SL 1.2% / TP 2.0%</span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">Min 4/5 conditions</span>
        </div>
      </PremiumCardContent>
    </PremiumCard>
  );
}

// ─── Portfolio Allocation Summary ─────────────────────────────────────────────

function PortfolioAllocation({ portfolio }: { portfolio: PortfolioAsset[] }) {
  if (portfolio.length === 0) return null;
  const total = portfolio.reduce((s, a) => s + a.amount * a.currentPrice, 0);
  return (
    <PremiumCard>
      <PremiumCardContent className="p-4 md:p-5">
        <h3 className="text-white font-semibold text-sm mb-4 uppercase tracking-wide">Portfolio Allocation</h3>
        <div className="space-y-3">
          {portfolio.map((a) => {
            const val = a.amount * a.currentPrice;
            const pct = total > 0 ? (val / total) * 100 : 0;
            return (
              <div key={a.id} className="flex items-center gap-3 text-sm">
                <span className="text-slate-300 font-bold w-12 shrink-0">{a.symbol}</span>
                <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: a.color ?? "#0ea5e9" }}
                  />
                </div>
                <span className="text-slate-400 w-12 text-right text-sm font-medium">{pct.toFixed(1)}%</span>
                <span className="text-slate-300 w-20 text-right font-semibold">${val.toFixed(0)}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-white/5 flex justify-between text-sm">
          <span className="text-slate-400 font-medium">Total Value</span>
          <span className="text-white font-bold text-lg">
            ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      </PremiumCardContent>
    </PremiumCard>
  );
}

// ─── Server status hook (lightweight, uses existing /api/status) ──────────────

interface SimpleServerStatus {
  balanceUSDT: number;
  winRate: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  mode: string;
  activeStrategy?: string;
  connection: "disconnected" | "connecting" | "connected" | "error";
  dailyPnL: number;
  isRunning: boolean;
  isKilled: boolean;
  performance?: {
    totalPnlUsd: number;
    weekly7dPnl: number;
    monthly30dPnl: number;
  } | null;
  portfolio?: {
    openCount: number;
    totalUnrealizedPnl: number;
  } | null;
  analytics?: {
    profitFactor: number;
    maxDrawdownPct: number;
  } | null;
}

function useServerStatus(): SimpleServerStatus {
  const [s, setS] = useState<SimpleServerStatus>({
    balanceUSDT: 0,
    winRate: "0",
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    mode: "UNKNOWN",
    connection: "connecting",
    dailyPnL: 0,
    isRunning: false,
    isKilled: false,
  });

  const fetch_ = useCallback(() => {
    const token = localStorage.getItem("pcb_jwt") ?? "";
    const authHeader = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${SERVER_URL}/api/status`, { headers: authHeader }).then(r => r.json()),
      fetch(`${SERVER_URL}/api/analytics`, { headers: authHeader }).then(r => r.json()).catch(() => null),
    ])
      .then(([d, a]: [Record<string, unknown>, Record<string, unknown> | null]) => {
        if (d.ok) {
          const metrics = (a?.metrics as { profitFactor?: number; maxDrawdownPct?: number } | undefined);
          setS({
            balanceUSDT:  (d.balanceUSDT as number) || 0,
            winRate:      (d.winRate as string) || "0",
            totalTrades:  (d.totalTrades as number) || 0,
            winningTrades:(d.winningTrades as number) || 0,
            losingTrades: (d.losingTrades as number) || 0,
            mode:         (d.mode as string) || "UNKNOWN",
            activeStrategy: d.activeStrategy as string | undefined,
            connection:   "connected",
            dailyPnL:     (d.dailyPnL as number) || 0,
            isRunning:    Boolean(d.isRunning),
            isKilled:     Boolean(d.isKilled),
            performance:  (d.performance as SimpleServerStatus["performance"]) ?? null,
            portfolio:    (d.portfolio as SimpleServerStatus["portfolio"]) ?? null,
            analytics:    metrics ? { profitFactor: metrics.profitFactor ?? 0, maxDrawdownPct: metrics.maxDrawdownPct ?? 0 } : null,
          });
        }
      })
      .catch(() => { setS(prev => ({ ...prev, connection: "error" })); });
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 10_000);
    return () => clearInterval(id);
  }, [fetch_]);

  return s;
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function Dashboard({
  prices,
  signals,
  trades,
  portfolio,
  totalPnL,
  fearGreedIndex,
  isBotRunning,
  activeStrategy,
  onTabChange,
  connectionStatus = "connecting",
}: DashboardProps) {
  const topSignals    = signals.slice(0, 3);
  const recentTrades  = trades.slice(0, 5);
  const openPositions = trades.filter(t => t.status === "open");

  const serverStatus  = useServerStatus();

  const isActiveSwing  = (activeStrategy ?? serverStatus.activeStrategy) === "active-swing";
  const isConsScalping = (activeStrategy ?? serverStatus.activeStrategy) === "conservative-scalping";

  const closedTrades  = trades.filter(t => t.status === "closed");
  const wins          = closedTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate       = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
  const displayedWinRate = serverStatus.winRate !== "0"
    ? `${serverStatus.winRate}%`
    : `${winRate.toFixed(1)}%`;

  return (
    <div className="space-y-6">
      {/* Strategy-specific panels */}
      {isActiveSwing  && <ActiveSwingPanel />}
      {isConsScalping && <ConservativeScalpingPanel />}

      {/* Top stats row — real data from /api/status + /api/analytics */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <PremiumStatCard
          title="Balance (USDT)"
          value={serverStatus.balanceUSDT > 0 ? serverStatus.balanceUSDT : "—"}
          valuePrefix={serverStatus.balanceUSDT > 0 ? "$" : undefined}
          subtitle={`${serverStatus.mode} mode`}
          icon={<Wallet size={16} />}
        />
        <PremiumStatCard
          title="Unrealized P&L"
          value={Math.abs(serverStatus.portfolio?.totalUnrealizedPnl ?? 0)}
          valuePrefix={(serverStatus.portfolio?.totalUnrealizedPnl ?? 0) >= 0 ? "+$" : "-$"}
          valueColor={(serverStatus.portfolio?.totalUnrealizedPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}
          subtitle={`${serverStatus.portfolio?.openCount ?? 0} open position${serverStatus.portfolio?.openCount === 1 ? "" : "s"}`}
          icon={<TrendingUp size={16} />}
        />
        <PremiumStatCard
          title="Today's P&L"
          value={Math.abs(serverStatus.dailyPnL)}
          valuePrefix={serverStatus.dailyPnL >= 0 ? "+$" : "-$"}
          valueColor={serverStatus.dailyPnL >= 0 ? "text-emerald-400" : "text-rose-400"}
          subtitle="Since midnight UTC"
          icon={<Activity size={16} />}
        />
        <PremiumStatCard
          title="Realized P&L"
          value={Math.abs(serverStatus.performance?.totalPnlUsd ?? totalPnL)}
          valuePrefix={(serverStatus.performance?.totalPnlUsd ?? totalPnL) >= 0 ? "+$" : "-$"}
          valueColor={(serverStatus.performance?.totalPnlUsd ?? totalPnL) >= 0 ? "text-emerald-400" : "text-rose-400"}
          subtitle="All-time"
          icon={<Activity size={16} />}
        />
        <PremiumStatCard
          title="Win Rate"
          value={displayedWinRate.replace('%', '')}
          valueSuffix="%"
          subtitle={`${serverStatus.totalTrades || closedTrades.length} total trades`}
          valueColor={parseFloat(displayedWinRate) >= 55 ? "text-emerald-400" : parseFloat(displayedWinRate) >= 40 ? "text-amber-400" : "text-rose-400"}
          icon={<Target size={16} />}
        />
        <PremiumStatCard
          title="Profit Factor"
          value={serverStatus.analytics ? serverStatus.analytics.profitFactor.toFixed(2) : "—"}
          subtitle="Gross win / gross loss"
          valueColor={
            !serverStatus.analytics ? undefined :
            serverStatus.analytics.profitFactor >= 1.5 ? "text-emerald-400" :
            serverStatus.analytics.profitFactor >= 1 ? "text-amber-400" : "text-rose-400"
          }
          icon={<Microscope size={16} />}
        />
        <PremiumStatCard
          title="Max Drawdown"
          value={serverStatus.analytics ? serverStatus.analytics.maxDrawdownPct.toFixed(1) : "—"}
          valueSuffix={serverStatus.analytics ? "%" : undefined}
          subtitle="Peak-to-trough equity"
          valueColor="text-rose-300"
          icon={<TrendingDown size={16} />}
        />
        <PremiumStatCard
          title="Bot Status"
          value={serverStatus.isKilled ? "HALTED" : serverStatus.isRunning ? "RUNNING" : "PAUSED"}
          subtitle={serverStatus.connection === "connected" ? "Gate.io connected" : "Connection issue"}
          valueColor={serverStatus.isKilled ? "text-rose-400" : serverStatus.isRunning ? "text-emerald-400" : "text-slate-400"}
          icon={<Activity size={16} />}
        />
      </div>

      {/* Three-column layout */}
      <div className="grid lg:grid-cols-3 gap-6">

        {/* Left: market data + heatmap */}
        <div className="lg:col-span-2 space-y-4">

          {/* Market Overview table */}
          <MarketOverview prices={prices} connectionStatus={connectionStatus} />

          {/* Live price cards (top 4) */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold uppercase tracking-wide text-sm">Live Prices</h2>
              <button onClick={() => onTabChange("signals")} className="text-cyan-400 text-[13px] font-bold uppercase tracking-wider tracking-wide hover:text-cyan-300">
                View signals →
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {prices.slice(0, 4).map((coin) => (
                <PriceCard key={coin.id} coin={coin} />
              ))}
            </div>
          </div>

          {/* 24h Heatmap */}
          <PremiumCard>
            <PremiumCardContent className="p-4 md:p-5">
              <h3 className="text-white font-semibold text-sm mb-4 uppercase tracking-wide">24h Market Heatmap</h3>
              <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                {prices.map((coin) => <HeatmapCell key={coin.id} coin={coin} />)}
              </div>
            </PremiumCardContent>
          </PremiumCard>

          {/* Equity curve */}
          <EquityCurveChart serverUrl={SERVER_URL} />

          {/* Portfolio allocation */}
          {portfolio.length > 0 && <PortfolioAllocation portfolio={portfolio} />}
        </div>

        {/* Right column: account metrics + positions + signals + trades */}
        <div className="space-y-4">

          {/* Account metrics & system health */}
          <AccountMetrics
            trades={trades}
            totalPnL={totalPnL}
            isBotRunning={isBotRunning}
            connectionStatus={connectionStatus}
            serverStatus={serverStatus}
          />

          {/* Open positions */}
          {openPositions.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold uppercase tracking-wide text-sm">Open Positions</h2>
                <span className="text-xs font-black px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-400 tracking-wider">
                  {openPositions.length} LIVE
                </span>
              </div>
              <div className="space-y-3">
                {openPositions.map(t => (
                  <OpenPositionCard
                    key={t.id}
                    trade={t}
                    prices={prices}
                    calledBy="Dashboard"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Latest signals */}
          <div className="flex items-center justify-between mt-6 mb-4">
            <h2 className="text-white font-semibold uppercase tracking-wide text-sm">Latest Signals</h2>
            <button onClick={() => onTabChange("signals")} className="text-cyan-400 text-[13px] font-bold uppercase tracking-wider tracking-wide hover:text-cyan-300">
              All signals →
            </button>
          </div>
          {topSignals.length > 0
            ? topSignals.map((sig) => <SignalCard key={sig.id} signal={sig} />)
            : <PremiumCard><PremiumCardContent className="p-4"><p className="text-slate-500 text-xs text-center py-4">No signals yet.</p></PremiumCardContent></PremiumCard>
          }

          {/* Recent trades */}
          <div className="flex items-center justify-between mt-6 mb-4">
            <h2 className="text-white font-semibold uppercase tracking-wide text-sm">Recent Trades</h2>
            <button onClick={() => onTabChange("trades")} className="text-cyan-400 text-[13px] font-bold uppercase tracking-wider tracking-wide hover:text-cyan-300">
              All trades →
            </button>
          </div>
          <PremiumCard>
            <PremiumCardContent className="p-0">
              {recentTrades.length === 0 ? (
                <p className="text-slate-500 text-xs text-center py-6">No trades yet — start the bot!</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {recentTrades.map((t) => {
                    const up = (t.pnl || 0) >= 0;
                    return (
                      <div key={t.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-800/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <StatusBadge variant={t.type === "BUY" ? "buy" : "sell"} label={t.type} />
                          <div>
                            <p className="text-white text-sm font-bold">{t.symbol}</p>
                            <p className="text-slate-500 text-sm font-semibold">{t.amount} units</p>
                          </div>
                        </div>
                        <div className="text-right">
                          {t.pnl !== undefined && (
                            <p className={`text-sm font-semibold font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>
                              {up ? "+" : ""}${t.pnl.toFixed(2)}
                            </p>
                          )}
                          <p className="text-slate-500 text-[13px] font-bold uppercase font-bold tracking-wider mt-0.5">{t.status}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </PremiumCardContent>
          </PremiumCard>
        </div>
      </div>
    </div>
  );
}
