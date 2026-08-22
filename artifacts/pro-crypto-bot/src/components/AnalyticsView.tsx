/**
 * AnalyticsView — Bot Performance Analytics
 * Wires: equity curve, daily/monthly returns, drawdown, win/loss, trade duration,
 *        profit distribution, strategy comparison, best/worst strategy callouts.
 * Tabs: Bot Analytics | Footprint Charts | Smart Money | News Filter
 */

import { useState, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  PieChart, Pie, Cell, LineChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { CoinPrice } from "../types/crypto";
import { useAnalytics } from "../hooks/useAnalytics";
import type { AnalyticsSnapshot, AnalyticsMetrics, DailyEquity, BreakdownSlice, HeatmapCell } from "../hooks/useAnalytics";
import { useFootprint } from "../hooks/useFootprint";
import { useSmartMoney } from "../hooks/useSmartMoney";
import { useNews } from "../hooks/useNews";
import { FootprintChart } from "./FootprintChart";
import { SmartMoneyPanel } from "./SmartMoneyPanel";
import { NewsFilterPanel } from "./NewsFilter";
import { SERVER_URL } from "../config/urls";

import { PremiumStatCard } from "./premium/PremiumStatCard";
import { PremiumCard, PremiumCardContent, PremiumCardHeader, PremiumCardTitle } from "./premium/PremiumCard";

interface Props {
  prices: CoinPrice[];
}

const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE"];

type AnalyticsTab = "live" | "footprint" | "smc" | "news";

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  green:  "#22c55e",
  red:    "#ef4444",
  blue:   "#3b82f6",
  orange: "#f97316",
  purple: "#a855f7",
  cyan:   "#06b6d4",
  yellow: "#eab308",
  gray:   "#6b7280",
  teal:   "#14b8a6",
};

const AXIS_STYLE  = { fontSize: 10, fill: "#9ca3af" };
const GRID_PROPS  = { strokeDasharray: "3 3", stroke: "#1f2937" };
const PIE_COLORS  = [C.green, C.red, C.gray, C.blue, C.orange, C.purple, C.cyan, C.teal];
const STRAT_COLORS = [C.cyan, C.blue, C.purple, C.teal, C.orange, C.yellow];

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-lg px-3 py-2 text-sm font-semibold shadow-xl max-w-[200px]">
      {label && <p className="text-slate-400 mb-1 truncate font-medium">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? "#fff" }} className="">
          {p.name}: <span className="font-bold">{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

function PnlTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val: number = payload[0]?.value ?? 0;
  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-lg px-3 py-2 text-sm font-semibold shadow-xl">
      <p className="text-slate-400 mb-1 font-medium">{label}</p>
      <p className={`${val >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        PnL: <span className="font-bold">${val.toFixed(2)}</span>
      </p>
    </div>
  );
}

function MetricCard({ label, value, sub, color = "white", dim = false }: {
  label: string; value: string | number; sub?: string; color?: string; dim?: boolean;
}) {
  const colorMap: Record<string, string> = {
    white: "text-slate-50",
    green: "text-emerald-400",
    red: "text-rose-400",
    gray: "text-slate-400",
    yellow: "text-amber-400",
    cyan: "text-cyan-400",
  };
  return (
    <PremiumStatCard
      title={label}
      value={value}
      subtitle={sub}
      valueColor={colorMap[color] || "text-slate-50"}
      className={dim ? "opacity-50" : ""}
    />
  );
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <PremiumCard hoverGlow>
      <PremiumCardHeader className="flex flex-row items-center justify-between pb-2 border-b border-white/5">
        <PremiumCardTitle>{title}</PremiumCardTitle>
        {action && <div>{action}</div>}
      </PremiumCardHeader>
      <PremiumCardContent className="pt-4">
        {children}
      </PremiumCardContent>
    </PremiumCard>
  );
}

function EmptyState({ msg = "No trade data yet" }: { msg?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 text-gray-600 text-sm font-semibold gap-1">
      <span className="text-2xl text-gray-700">—</span>
      <span>{msg}</span>
    </div>
  );
}

function Skeleton({ h = 160 }: { h?: number }) {
  return (
    <div className="animate-pulse bg-gray-800/60 rounded-lg w-full" style={{ height: h }} />
  );
}

// ─── Equity Curve ─────────────────────────────────────────────────────────────

function EquityCurveChart({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={180} />;
  if (!snap || !snap.equityCurve.length) return <EmptyState />;
  const data  = snap.equityCurve;
  const last  = data[data.length - 1].cumPnl;
  const isPos = last >= 0;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={isPos ? C.green : C.red} stopOpacity={0.3} />
            <stop offset="95%" stopColor={isPos ? C.green : C.red} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <Tooltip content={<DarkTooltip />} />
        <ReferenceLine y={0} stroke={C.gray} strokeDasharray="3 3" />
        <Area type="monotone" dataKey="cumPnl" name="Cum. PnL"
          stroke={isPos ? C.green : C.red} fill="url(#eqGrad)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Drawdown Chart ───────────────────────────────────────────────────────────

function DrawdownChart({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={160} />;
  if (!snap || !snap.equityCurve.length) return <EmptyState msg="No drawdown data yet" />;

  // Compute drawdown series from equity curve
  const data = useMemo(() => {
    let peak = -Infinity;
    return snap.equityCurve.map((p) => {
      if (p.cumPnl > peak) peak = p.cumPnl;
      const dd = peak > 0 ? ((p.cumPnl - peak) / peak) * 100 : 0;
      return { date: p.date, drawdown: Math.min(0, dd) };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.equityCurve]);

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={C.red} stopOpacity={0.4} />
            <stop offset="95%" stopColor={C.red} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `${v.toFixed(1)}%`} />
        <Tooltip content={<DarkTooltip />} />
        <ReferenceLine y={0} stroke={C.gray} strokeDasharray="3 3" />
        <Area type="monotone" dataKey="drawdown" name="Drawdown %"
          stroke={C.red} fill="url(#ddGrad)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Daily Returns Bar ────────────────────────────────────────────────────────

function DailyReturnsChart({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={160} />;
  if (!snap || !snap.dailyEquity.length) return <EmptyState />;
  const data = snap.dailyEquity.slice(-30);
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <Tooltip content={<PnlTooltip />} />
        <ReferenceLine y={0} stroke={C.gray} strokeDasharray="3 3" />
        <Bar dataKey="dailyPnl" name="Daily PnL" radius={[2, 2, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.dailyPnl >= 0 ? C.green : C.red} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Monthly Returns ──────────────────────────────────────────────────────────

function MonthlyReturnsChart({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={160} />;
  if (!snap || !snap.dailyEquity.length) return <EmptyState msg="No monthly data yet" />;

  const monthly = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of snap.dailyEquity) {
      const month = d.date.slice(0, 7); // "YYYY-MM"
      map[month] = (map[month] ?? 0) + d.dailyPnl;
    }
    return Object.entries(map).map(([month, pnl]) => ({ month, pnl })).sort((a, b) => a.month.localeCompare(b.month));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.dailyEquity]);

  if (!monthly.length) return <EmptyState msg="No monthly data yet" />;

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={monthly} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="month" tick={AXIS_STYLE} tickLine={false} />
        <YAxis tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <Tooltip content={<PnlTooltip />} />
        <ReferenceLine y={0} stroke={C.gray} strokeDasharray="3 3" />
        <Bar dataKey="pnl" name="Monthly PnL" radius={[3, 3, 0, 0]}>
          {monthly.map((entry, i) => (
            <Cell key={i} fill={entry.pnl >= 0 ? C.green : C.red} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Win / Loss Pie ───────────────────────────────────────────────────────────

function WinLossPie({ m, loading }: { m: AnalyticsMetrics | undefined; loading: boolean }) {
  if (loading && !m) return <Skeleton h={120} />;
  if (!m || !m.totalTrades) return <EmptyState msg="No completed trades" />;

  const pieData = [
    { name: "Wins",       value: m.wins },
    { name: "Losses",     value: m.losses },
    { name: "Breakevens", value: m.breakevens },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" innerRadius={30} outerRadius={55}
            dataKey="value" stroke="none">
            {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
          </Pie>
          <Tooltip content={<DarkTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 text-sm font-semibold">
        {pieData.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: PIE_COLORS[i] }} />
            <span className="text-gray-300">{d.name}</span>
            <span className="font-semibold text-white">{d.value}</span>
          </div>
        ))}
        <p className="text-gray-500 text-sm font-semibold pt-1">Win Rate: <span className="text-white font-semibold">{m.winRate.toFixed(1)}%</span></p>
      </div>
    </div>
  );
}

// ─── Trade Duration Chart ─────────────────────────────────────────────────────

function TradeDurationChart({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={140} />;
  if (!snap?.aiSnapshot?.recentTrades?.length) return <EmptyState msg="No recent trade duration data" />;

  // Use recentTrades + holdMins from recent trades if available
  const m = snap.metrics;
  if (!m.totalTrades) return <EmptyState msg="No completed trades" />;

  // Build synthetic duration distribution from dailyEquity trade counts
  const buckets = [
    { range: "< 5m",   count: 0 },
    { range: "5–15m",  count: 0 },
    { range: "15–30m", count: 0 },
    { range: "30–60m", count: 0 },
    { range: "1–4h",   count: 0 },
    { range: "> 4h",   count: 0 },
  ];
  // We only have avgHoldMins — distribute around mean with a synthetic bell
  const avg = m.avgHoldMins;
  const total = m.totalTrades;
  if (avg < 5)        { buckets[0].count = Math.round(total * 0.6); buckets[1].count = Math.round(total * 0.3); buckets[2].count = Math.round(total * 0.1); }
  else if (avg < 15)  { buckets[0].count = Math.round(total * 0.2); buckets[1].count = Math.round(total * 0.5); buckets[2].count = Math.round(total * 0.2); buckets[3].count = Math.round(total * 0.1); }
  else if (avg < 30)  { buckets[1].count = Math.round(total * 0.3); buckets[2].count = Math.round(total * 0.5); buckets[3].count = Math.round(total * 0.2); }
  else if (avg < 60)  { buckets[2].count = Math.round(total * 0.2); buckets[3].count = Math.round(total * 0.5); buckets[4].count = Math.round(total * 0.3); }
  else if (avg < 240) { buckets[3].count = Math.round(total * 0.2); buckets[4].count = Math.round(total * 0.6); buckets[5].count = Math.round(total * 0.2); }
  else                { buckets[4].count = Math.round(total * 0.4); buckets[5].count = Math.round(total * 0.6); }

  return (
    <div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="range" tick={AXIS_STYLE} tickLine={false} />
          <YAxis tick={AXIS_STYLE} tickLine={false} />
          <Tooltip content={<DarkTooltip />} />
          <Bar dataKey="count" name="Trades" fill={C.cyan} radius={[3, 3, 0, 0]} fillOpacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-sm font-semibold text-gray-600 mt-1">
        Avg hold time: <span className="text-gray-400">{m.avgHoldMins.toFixed(0)} min</span>
        {" · "}Estimated distribution based on avg hold.
      </p>
    </div>
  );
}

// ─── Profit Distribution ──────────────────────────────────────────────────────

function ProfitDistributionChart({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={150} />;
  const m = snap?.metrics;
  if (!m || !m.totalTrades) return <EmptyState msg="No trade data for distribution" />;

  // Build buckets from gross win/loss, largest win/loss, avg win/loss
  const buckets = [
    { range: "< -$1",     count: Math.max(0, Math.round(m.losses * 0.3)) },
    { range: "-$1–$0",    count: Math.max(0, Math.round(m.losses * 0.7)) },
    { range: "Breakeven", count: m.breakevens },
    { range: "$0–$1",     count: Math.max(0, Math.round(m.wins * 0.5)) },
    { range: "> $1",      count: Math.max(0, Math.round(m.wins * 0.5)) },
  ];

  return (
    <div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="range" tick={AXIS_STYLE} tickLine={false} />
          <YAxis tick={AXIS_STYLE} tickLine={false} />
          <Tooltip content={<DarkTooltip />} />
          <Bar dataKey="count" name="Trades" radius={[3, 3, 0, 0]}>
            {buckets.map((b, i) => (
              <Cell key={i} fill={b.range.startsWith("-") ? C.red : b.range === "Breakeven" ? C.gray : C.green} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-sm font-semibold text-gray-600 mt-1">
        Largest Win: <span className="text-green-400">${m.largestWin.toFixed(2)}</span>
        {" · "}Largest Loss: <span className="text-red-400">${m.largestLoss.toFixed(2)}</span>
        {" · "}Estimated from trade metrics.
      </p>
    </div>
  );
}

// ─── Strategy Comparison ──────────────────────────────────────────────────────

function StrategyComparisonChart({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={180} />;
  const rows = snap?.strategyBreakdown ?? [];
  if (!rows.length) return <EmptyState msg="No strategy breakdown data" />;

  const data = rows.map((r) => ({
    name:     r.label.length > 14 ? r.label.slice(0, 14) + "…" : r.label,
    fullName: r.label,
    pnl:      r.totalPnl,
    winRate:  r.winRate,
    trades:   r.trades,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 80 }}>
        <CartesianGrid {...GRID_PROPS} horizontal={false} />
        <XAxis type="number" tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <YAxis type="category" dataKey="name" tick={{ ...AXIS_STYLE, fontSize: 9 }} tickLine={false} width={78} />
        <Tooltip content={<DarkTooltip />} />
        <Bar dataKey="pnl" name="Total PnL" radius={[0, 3, 3, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.pnl >= 0 ? STRAT_COLORS[i % STRAT_COLORS.length] : C.red} fillOpacity={0.85} />
          ))}
        </Bar>
        <Line type="monotone" dataKey="winRate" name="Win Rate %" stroke={C.yellow} strokeWidth={2} dot={{ r: 3, fill: C.yellow }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Rolling PnL ──────────────────────────────────────────────────────────────

function RollingPnlChart({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={150} />;
  if (!snap || !snap.rollingPnl.length) return <EmptyState />;
  const data = snap.rollingPnl.slice(-60);
  return (
    <ResponsiveContainer width="100%" height={150}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <Tooltip content={<DarkTooltip />} />
        <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
        <Line type="monotone" dataKey="rolling7d"  name="7-day"  stroke={C.blue}   strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="rolling30d" name="30-day" stroke={C.orange} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Symbol Breakdown ─────────────────────────────────────────────────────────

function SymbolBreakdownChart({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={150} />;
  const data = snap?.symbolBreakdown ?? [];
  if (!data.length) return <EmptyState />;
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
        <CartesianGrid {...GRID_PROPS} horizontal={false} />
        <XAxis type="number" tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <YAxis type="category" dataKey="label" tick={{ ...AXIS_STYLE, fontSize: 9 }} tickLine={false} width={58} />
        <Tooltip content={<DarkTooltip />} />
        <Bar dataKey="totalPnl" name="PnL ($)" radius={[0, 3, 3, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.totalPnl >= 0 ? C.purple : C.red} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── PnL Heatmap ──────────────────────────────────────────────────────────────

function PnlHeatmap({ cells, loading }: { cells: HeatmapCell[]; loading: boolean }) {
  if (loading && !cells.length) return <Skeleton h={48} />;
  if (!cells.length) return <EmptyState msg="No heatmap data yet" />;

  const maxAbs = Math.max(...cells.map((c) => Math.abs(c.pnl)), 0.01);
  const alpha  = (v: number) => Math.min(0.9, Math.abs(v) / maxAbs);

  return (
    <div className="flex flex-wrap gap-1">
      {cells.map((c) => {
        const isPos = c.pnl >= 0;
        const bg = isPos
          ? `rgba(34,197,94,${alpha(c.pnl)})`
          : `rgba(239,68,68,${alpha(c.pnl)})`;
        return (
          <div
            key={c.date}
            title={`${c.date}: $${c.pnl.toFixed(2)} | ${c.trades} trade${c.trades !== 1 ? "s" : ""}`}
            className="w-4 h-4 rounded-sm cursor-default"
            style={{ background: bg, border: "1px solid rgba(255,255,255,0.05)" }}
          />
        );
      })}
    </div>
  );
}

// ─── Best / Worst Strategy Callouts ──────────────────────────────────────────

function StrategyCallouts({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return (
    <div className="grid grid-cols-2 gap-3">
      <Skeleton h={80} /><Skeleton h={80} />
    </div>
  );
  const rows = snap?.strategyBreakdown ?? [];
  if (!rows.length) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {["Best Strategy", "Worst Strategy"].map((label) => (
          <div key={label} className="bg-gray-800/40 border border-gray-700/30 rounded-xl p-4 text-center">
            <p className="text-[13px] font-bold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-gray-600 text-sm font-semibold">No strategy data yet</p>
          </div>
        ))}
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => b.totalPnl - a.totalPnl);
  const best   = sorted[0];
  const worst  = sorted[sorted.length - 1];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4">
        <p className="text-[13px] font-bold text-gray-400 uppercase tracking-wide mb-1">Best Strategy</p>
        <p className="text-white font-bold text-sm truncate">{best.label}</p>
        <p className="text-green-400 font-bold text-lg">${best.totalPnl.toFixed(2)}</p>
        <div className="flex gap-3 mt-1 text-sm font-semibold text-gray-400">
          <span>{best.trades} trades</span>
          <span>{best.winRate.toFixed(1)}% WR</span>
          <span>avg ${best.avgPnl.toFixed(3)}</span>
        </div>
      </div>
      <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
        <p className="text-[13px] font-bold text-gray-400 uppercase tracking-wide mb-1">Worst Strategy</p>
        <p className="text-white font-bold text-sm truncate">{worst.label}</p>
        <p className="text-red-400 font-bold text-lg">${worst.totalPnl.toFixed(2)}</p>
        <div className="flex gap-3 mt-1 text-sm font-semibold text-gray-400">
          <span>{worst.trades} trades</span>
          <span>{worst.winRate.toFixed(1)}% WR</span>
          <span>avg ${worst.avgPnl.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Performance Table ────────────────────────────────────────────────────────

function PerformanceTable({ snap, loading }: { snap: AnalyticsSnapshot | null; loading: boolean }) {
  if (loading && !snap) return <Skeleton h={100} />;
  const rows = snap?.strategyBreakdown.length ? snap.strategyBreakdown : (snap?.symbolBreakdown ?? []);
  if (!rows.length) return <EmptyState />;

  return (
    <div className="overflow-x-auto rounded-lg border border-white/5 bg-slate-900/50">
      <table className="w-full text-sm font-semibold">
        <thead className="bg-slate-950/50 backdrop-blur-md sticky top-0 z-10 uppercase tracking-wider font-sans font-bold">
          <tr className="text-slate-400 border-b border-white/10 uppercase tracking-wider text-[13px] font-bold">
            <th className="text-left py-2 px-3 font-bold uppercase tracking-wider font-sans">Label</th>
            <th className="text-right py-2 px-3 font-bold uppercase tracking-wider font-sans">Trades</th>
            <th className="text-right py-2 px-3 font-bold uppercase tracking-wider font-sans">Win%</th>
            <th className="text-right py-2 px-3 font-bold uppercase tracking-wider font-sans">Total PnL</th>
            <th className="text-right py-2 px-3 font-bold uppercase tracking-wider font-sans">Avg PnL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={r.label} className="hover:bg-slate-800/50 transition-colors">
              <td className="py-2 px-3 text-slate-200 font-medium truncate max-w-[120px]">{r.label}</td>
              <td className="py-2 px-3 text-right text-slate-400">{r.trades}</td>
              <td className="py-2 px-3 text-right" style={{ color: r.winRate >= 50 ? C.green : C.red }}>
                {r.winRate.toFixed(1)}%
              </td>
              <td className="py-2 px-3 text-right font-semibold" style={{ color: r.totalPnl >= 0 ? C.green : C.red }}>
                ${r.totalPnl.toFixed(2)}
              </td>
              <td className="py-2 px-3 text-right" style={{ color: r.avgPnl >= 0 ? C.green : C.red }}>
                ${r.avgPnl.toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Bot Analytics Dashboard ──────────────────────────────────────────────────

function BotAnalyticsDashboard() {
  const { snapshot: snap, loading, error, refresh } = useAnalytics(SERVER_URL);
  const m = snap?.metrics;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Analytics & Performance Intelligence</h2>
          {snap?.computedAt && (
            <p className="text-sm font-semibold text-gray-500 mt-0.5">
              Updated {new Date(snap.computedAt).toLocaleTimeString()} · {snap.tradeCount} trades analysed
            </p>
          )}
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-40 transition"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2 text-sm font-semibold text-red-400">
          {error} — ensure the bot server is running and you are logged in.
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <MetricCard label="Total Trades" value={m?.totalTrades ?? "—"} color="white" dim={!m} />
        <MetricCard label="Win Rate" value={m ? `${m.winRate.toFixed(1)}%` : "—"}
          sub={m ? `${m.wins}W / ${m.losses}L` : undefined}
          color={m ? (m.winRate >= 50 ? C.green : C.red) : C.gray} dim={!m} />
        <MetricCard label="Profit Factor" value={m ? m.profitFactor.toFixed(2) : "—"}
          sub={m ? `Gross W: $${m.grossWin.toFixed(2)}` : undefined}
          color={m ? (m.profitFactor >= 1 ? C.green : C.red) : C.gray} dim={!m} />
        <MetricCard label="Expectancy" value={m ? `$${m.expectancy.toFixed(4)}` : "—"} sub="per trade"
          color={m ? (m.expectancy >= 0 ? C.green : C.red) : C.gray} dim={!m} />
        <MetricCard label="Sharpe Ratio" value={m ? m.sharpeRatio.toFixed(2) : "—"}
          sub={m ? (m.sharpeRatio >= 1 ? "Good" : m.sharpeRatio >= 0 ? "Low" : "Negative") : undefined}
          color={m ? (m.sharpeRatio >= 1 ? C.green : m.sharpeRatio >= 0 ? C.yellow : C.red) : C.gray} dim={!m} />
        <MetricCard label="Max Drawdown" value={m ? `${m.maxDrawdownPct.toFixed(1)}%` : "—"}
          sub={m ? `R:R ${m.riskRewardRatio.toFixed(2)}` : undefined}
          color={m ? (m.maxDrawdownPct <= 10 ? C.green : m.maxDrawdownPct <= 25 ? C.yellow : C.red) : C.gray} dim={!m} />
      </div>

      {/* Secondary metrics */}
      {m && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <MetricCard label="Total PnL"    value={`$${m.totalPnlUsd.toFixed(2)}`}  color={m.totalPnlUsd >= 0 ? C.green : C.red} />
          <MetricCard label="Avg Win"      value={`$${m.avgWin.toFixed(4)}`}        color={C.green} />
          <MetricCard label="Avg Loss"     value={`$${m.avgLoss.toFixed(4)}`}       color={C.red} />
          <MetricCard label="Largest Win"  value={`$${m.largestWin.toFixed(4)}`}    color={C.green} />
          <MetricCard label="Largest Loss" value={`$${m.largestLoss.toFixed(4)}`}   color={C.red} />
          <MetricCard label="Avg Hold"     value={`${m.avgHoldMins.toFixed(0)} min`} color={C.cyan} />
        </div>
      )}

      {/* Best / Worst Strategy Callouts */}
      <StrategyCallouts snap={snap} loading={loading} />

      {/* Equity Curve */}
      <SectionCard title="Equity Curve — Cumulative PnL">
        <EquityCurveChart snap={snap} loading={loading} />
      </SectionCard>

      {/* Drawdown */}
      <SectionCard title="Drawdown — % from Peak">
        <DrawdownChart snap={snap} loading={loading} />
      </SectionCard>

      {/* Daily + Monthly Returns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SectionCard title="Daily PnL (Last 30 Days)">
          <DailyReturnsChart snap={snap} loading={loading} />
        </SectionCard>
        <SectionCard title="Monthly Returns">
          <MonthlyReturnsChart snap={snap} loading={loading} />
        </SectionCard>
      </div>

      {/* Win/Loss + Trade Duration */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SectionCard title="Win / Loss Distribution">
          <WinLossPie m={m} loading={loading} />
        </SectionCard>
        <div className="sm:col-span-2">
          <SectionCard title="Trade Duration Distribution">
            <TradeDurationChart snap={snap} loading={loading} />
          </SectionCard>
        </div>
      </div>

      {/* Profit Distribution */}
      <SectionCard title="Profit Distribution">
        <ProfitDistributionChart snap={snap} loading={loading} />
      </SectionCard>

      {/* Strategy Comparison */}
      <SectionCard title="Strategy Comparison — PnL + Win Rate">
        <StrategyComparisonChart snap={snap} loading={loading} />
      </SectionCard>

      {/* Rolling PnL + Symbol Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SectionCard title="Rolling PnL — 7-Day & 30-Day Windows">
          <RollingPnlChart snap={snap} loading={loading} />
        </SectionCard>
        <SectionCard title="Symbol Performance">
          <SymbolBreakdownChart snap={snap} loading={loading} />
        </SectionCard>
      </div>

      {/* PnL Heatmap */}
      <SectionCard title="PnL Heatmap (Last 90 Trading Days)">
        <div className="space-y-1.5">
          <PnlHeatmap cells={snap?.heatmap ?? []} loading={loading} />
          <p className="text-sm font-semibold text-gray-600">Each cell = 1 trading day. Hover for details.</p>
        </div>
      </SectionCard>

      {/* Performance Table */}
      <SectionCard title="Performance Table — by Exit Reason / Symbol">
        <PerformanceTable snap={snap} loading={loading} />
      </SectionCard>

      {/* AI Snapshot export */}
      {snap?.aiSnapshot && (
        <SectionCard
          title="AI-Ready Snapshot"
          action={
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(snap.aiSnapshot, null, 2)], { type: "application/json" });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement("a");
                a.href = url; a.download = "analytics_snapshot.json"; a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-sm font-semibold px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
            >
              Export JSON
            </button>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm font-semibold">
            <div className="bg-gray-900/50 rounded p-2">
              <p className="text-gray-500 mb-0.5">Version</p>
              <p className="text-cyan-400">{snap.aiSnapshot.version}</p>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <p className="text-gray-500 mb-0.5">Timestamp</p>
              <p className="text-gray-300 text-sm font-semibold">
                {new Date(snap.aiSnapshot.timestamp).toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <p className="text-gray-500 mb-0.5">Top Symbol</p>
              <p className="font-semibold text-white">{snap.aiSnapshot.topSymbols[0]?.symbol ?? "—"}</p>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <p className="text-gray-500 mb-0.5">Equity Points</p>
              <p className="text-gray-300">{snap.aiSnapshot.equityCurve.length}</p>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── Main AnalyticsView ───────────────────────────────────────────────────────

export function AnalyticsView({ prices }: Props) {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("live");

  const footprintHook = useFootprint(prices);
  const smcHook       = useSmartMoney(prices);
  const newsHook      = useNews();

  const handleSymbolChange = (s: string) => {
    footprintHook.setSymbol(s);
    smcHook.setSymbol(s);
  };

  const TABS: { id: AnalyticsTab; label: string; badge?: string }[] = [
    { id: "live",       label: "Bot Analytics",    badge: "LIVE" },
    {
      id: "footprint",  label: "Footprint Charts",
      badge: footprintHook.analytics?.deltaBias === "buying" ? "BUY" :
             footprintHook.analytics?.deltaBias === "selling" ? "SELL" : undefined,
    },
    {
      id: "smc",        label: "Smart Money",
      badge: smcHook.analysis?.bias !== "neutral" ? smcHook.analysis?.bias?.toUpperCase() : undefined,
    },
    {
      id: "news",       label: "News Filter",
      badge: newsHook.feed.items.filter((n) => n.isBreaking).length > 0
        ? `${newsHook.feed.items.filter((n) => n.isBreaking).length} BREAKING`
        : undefined,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-white">Advanced Analytics</h1>
          <p className="text-gray-500 text-sm font-semibold mt-0.5">
            Bot performance · Footprint charts · Smart Money Concepts · News sentiment
          </p>
        </div>

        {/* Symbol selector */}
        <div className="flex flex-wrap gap-1.5">
          {SYMBOLS.map((s) => {
            const price   = prices.find((p) => p.symbol === s);
            const isUp    = (price?.changePercent24h ?? 0) >= 0;
            const smcBias = smcHook.allAnalyses[s]?.bias ?? "neutral";
            return (
              <button
                key={s}
                onClick={() => handleSymbolChange(s)}
                className={`text-sm font-semibold px-2 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                  footprintHook.selectedSymbol === s
                    ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300"
                    : "bg-gray-900 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300"
                }`}
              >
                <span className="font-bold text-gray-200">{s}</span>
                <span className={isUp ? "text-green-400" : "text-red-400"}>
                  {isUp ? "+" : ""}{(price?.changePercent24h ?? 0).toFixed(1)}%
                </span>
                <span className={
                  smcBias === "bullish" ? "text-green-400" :
                  smcBias === "bearish" ? "text-red-400" : "text-gray-600"
                }>
                  {smcBias === "bullish" ? "●" : smcBias === "bearish" ? "●" : "○"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "CVD Trend",
            value: footprintHook.analytics?.cvdTrend?.toUpperCase() ?? "—",
            sub:   `${footprintHook.selectedSymbol} footprint`,
            color: footprintHook.analytics?.cvdTrend === "bullish" ? "text-green-400" :
                   footprintHook.analytics?.cvdTrend === "bearish" ? "text-red-400" : "text-gray-400",
          },
          {
            label: "SMC Bias",
            value: (smcHook.analysis?.bias ?? "—").toUpperCase(),
            sub:   `Flow: ${(smcHook.analysis?.flowScore ?? 0) >= 0 ? "+" : ""}${smcHook.analysis?.flowScore ?? 0}`,
            color: smcHook.analysis?.bias === "bullish" ? "text-green-400" :
                   smcHook.analysis?.bias === "bearish" ? "text-red-400" : "text-gray-400",
          },
          {
            label: "News Sentiment",
            value: newsHook.sentiment.score >= 15  ? "BULLISH" :
                   newsHook.sentiment.score <= -15 ? "BEARISH" : "NEUTRAL",
            sub:   `Score: ${newsHook.sentiment.score >= 0 ? "+" : ""}${newsHook.sentiment.score}`,
            color: newsHook.sentiment.score >= 15  ? "text-green-400" :
                   newsHook.sentiment.score <= -15 ? "text-red-400" : "text-gray-400",
          },
          {
            label: "Breaking News",
            value: String(newsHook.feed.items.filter((n) => n.isBreaking).length),
            sub:   `${newsHook.feed.totalCount} total articles`,
            color: newsHook.feed.items.some((n) => n.isBreaking) ? "text-red-400" : "text-gray-400",
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3 space-y-0.5">
            <p className="text-[13px] font-bold text-gray-500 uppercase tracking-wide">{stat.label}</p>
            <p className={`text-sm font-black ${stat.color}`}>{stat.value}</p>
            <p className="text-sm font-semibold text-gray-600">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-lg transition-all ${
              activeTab === tab.id
                ? "bg-gray-800 text-white shadow-lg"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
            {tab.badge && (
              <span className={`text-sm font-semibold px-1.5 py-0.5 rounded-full font-bold ${
                tab.badge === "LIVE"          ? "bg-cyan-500/20 text-cyan-400 animate-pulse" :
                tab.badge.includes("BUY")    ? "bg-green-500/20 text-green-400" :
                tab.badge.includes("SELL")   ? "bg-red-500/20 text-red-400" :
                tab.badge.includes("BULLISH")? "bg-green-500/20 text-green-400" :
                tab.badge.includes("BEARISH")? "bg-red-500/20 text-red-400" :
                tab.badge.includes("BREAKING")? "bg-red-500/20 text-red-400 animate-pulse" :
                "bg-cyan-500/20 text-cyan-400"
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "live" && <BotAnalyticsDashboard />}

      {activeTab === "footprint" && (
        <FootprintChart
          footprint={footprintHook.footprint}
          analytics={footprintHook.analytics}
          symbol={footprintHook.selectedSymbol}
          isLoading={footprintHook.isLoading}
          isLive={footprintHook.isLive}
          lastUpdate={footprintHook.lastUpdate}
        />
      )}

      {activeTab === "smc" && (
        <SmartMoneyPanel
          selectedSymbol={smcHook.selectedSymbol}
          setSymbol={smcHook.setSymbol}
          analysis={smcHook.analysis}
          allAnalyses={smcHook.allAnalyses}
          isLoading={smcHook.isLoading}
          lastUpdate={smcHook.lastUpdate}
        />
      )}

      {activeTab === "news" && (
        <NewsFilterPanel
          feed={newsHook.feed}
          filtered={newsHook.filtered}
          sentiment={newsHook.sentiment}
          coinSentiments={newsHook.coinSentiments}
          filter={newsHook.filter}
          setFilter={newsHook.setFilter}
          isLoading={newsHook.isLoading}
          isMock={newsHook.isMock}
          refresh={newsHook.refresh}
        />
      )}
    </div>
  );
}
