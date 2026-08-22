/**
 * ServerAnalyticsDashboard — Phase 3 Analytics & Intelligence Dashboard
 * Polls /api/analytics every 15 s; recharts for all visualisations.
 */

import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import { useAnalytics } from "../hooks/useAnalytics";
import { SERVER_URL }   from "../config/urls";
import type {
  AnalyticsSnapshot, AnalyticsMetrics, DailyEquity,
  BreakdownSlice, HeatmapCell,
} from "../hooks/useAnalytics";

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

const PIE_COLORS = [C.green, C.red, C.gray];

// ─── Tooltip helpers ──────────────────────────────────────────────────────────

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs shadow-xl">
      {label && <p className="text-gray-400 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? "#fff" }}>
          {p.name}: <span className="font-semibold">{typeof p.value === "number" ? p.value.toFixed(4) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

function PnlTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val: number = payload[0]?.value ?? 0;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      <p style={{ color: val >= 0 ? C.green : C.red }}>
        PnL: <span className="font-semibold">${val.toFixed(2)}</span>
      </p>
    </div>
  );
}

// ─── Shared chart config ──────────────────────────────────────────────────────

const AXIS_STYLE = { fontSize: 10, fill: "#9ca3af" };
const GRID_PROPS = { strokeDasharray: "3 3", stroke: "#1f2937" };

// ─── Small reusable cards ─────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, color = "white", dim = false,
}: {
  label: string; value: string | number; sub?: string; color?: string; dim?: boolean;
}) {
  return (
    <div className={`bg-gray-800/60 border border-gray-700/50 rounded-lg p-3 ${dim ? "opacity-50" : ""}`}>
      <p className="text-gray-400 text-[13px] font-bold uppercase tracking-wider mb-0.5">{label}</p>
      <p className="font-bold text-sm" style={{ color }}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-bold font-semibold text-gray-300 uppercase tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ msg = "No trade data yet" }: { msg?: string }) {
  return (
    <div className="flex items-center justify-center h-32 text-gray-600 text-xs">{msg}</div>
  );
}

// ─── Equity Curve ─────────────────────────────────────────────────────────────

function EquityCurveChart({ snap }: { snap: AnalyticsSnapshot }) {
  const data = snap.equityCurve;
  if (!data.length) return <EmptyState />;
  const last = data[data.length - 1].cumPnl;
  const isPos = last >= 0;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={isPos ? C.green  : C.red} stopOpacity={0.3} />
            <stop offset="95%" stopColor={isPos ? C.green  : C.red} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <Tooltip content={<DarkTooltip />} />
        <Area
          type="monotone"
          dataKey="cumPnl"
          name="Cum. PnL"
          stroke={isPos ? C.green : C.red}
          fill="url(#eqGrad)"
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Daily PnL Bars ───────────────────────────────────────────────────────────

function DailyPnlChart({ snap }: { snap: AnalyticsSnapshot }) {
  const data = snap.dailyEquity.slice(-30);
  if (!data.length) return <EmptyState />;
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <Tooltip content={<PnlTooltip />} />
        <Bar dataKey="dailyPnl" name="Daily PnL" radius={[2, 2, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.dailyPnl >= 0 ? C.green : C.red} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Win / Loss Pie ───────────────────────────────────────────────────────────

function WinLossPie({ m }: { m: AnalyticsMetrics }) {
  if (!m.totalTrades) return <EmptyState />;
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
      <div className="space-y-1.5 text-xs">
        {pieData.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: PIE_COLORS[i] }} />
            <span className="text-gray-300">{d.name}</span>
            <span className="font-semibold text-white">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Rolling PnL ──────────────────────────────────────────────────────────────

function RollingPnlChart({ snap }: { snap: AnalyticsSnapshot }) {
  const data = snap.rollingPnl.slice(-60);
  if (!data.length) return <EmptyState />;
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

// ─── Breakdown bar chart ──────────────────────────────────────────────────────

function BreakdownChart({
  data, xKey = "label", color,
}: {
  data: BreakdownSlice[]; xKey?: string; color: string;
}) {
  if (!data.length) return <EmptyState />;
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
        <CartesianGrid {...GRID_PROPS} horizontal={false} />
        <XAxis type="number" tick={AXIS_STYLE} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <YAxis type="category" dataKey={xKey} tick={{ ...AXIS_STYLE, fontSize: 9 }} tickLine={false} width={58} />
        <Tooltip content={<DarkTooltip />} />
        <Bar dataKey="totalPnl" name="PnL ($)" radius={[0, 3, 3, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.totalPnl >= 0 ? color : C.red} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── PnL Heatmap ──────────────────────────────────────────────────────────────

function PnlHeatmap({ cells }: { cells: HeatmapCell[] }) {
  if (!cells.length) return <EmptyState msg="No heatmap data yet" />;

  const maxAbs = Math.max(...cells.map((c) => Math.abs(c.pnl)), 0.01);
  const alpha  = (v: number) => Math.min(0.9, Math.abs(v) / maxAbs);

  return (
    <div className="flex flex-wrap gap-1">
      {cells.map((c) => {
        const isPos = c.pnl >= 0;
        const bg    = isPos ? `rgba(34,197,94,${alpha(c.pnl)})` : `rgba(239,68,68,${alpha(c.pnl)})`;
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

// ─── Performance Table ────────────────────────────────────────────────────────

function PerformanceTable({ snap }: { snap: AnalyticsSnapshot }) {
  const rows = snap.strategyBreakdown.length
    ? snap.strategyBreakdown
    : snap.symbolBreakdown;

  if (!rows.length) return <EmptyState />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700">
            <th className="text-left py-1.5 pr-3 uppercase tracking-wider font-sans font-bold">Label</th>
            <th className="text-right py-1.5 pr-3 uppercase tracking-wider font-sans font-bold">Trades</th>
            <th className="text-right py-1.5 pr-3 uppercase tracking-wider font-sans font-bold">Win%</th>
            <th className="text-right py-1.5 pr-3 uppercase tracking-wider font-sans font-bold">Total PnL</th>
            <th className="text-right py-1.5 uppercase tracking-wider font-sans font-bold">Avg PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-gray-800/50 hover:bg-gray-700/20">
              <td className="py-1.5 pr-3 text-gray-200 font-medium">{r.label}</td>
              <td className="py-1.5 pr-3 text-right text-gray-400">{r.trades}</td>
              <td className="py-1.5 pr-3 text-right" style={{ color: r.winRate >= 50 ? C.green : C.red }}>
                {r.winRate.toFixed(1)}%
              </td>
              <td className="py-1.5 pr-3 text-right font-semibold"
                style={{ color: r.totalPnl >= 0 ? C.green : C.red }}>
                ${r.totalPnl.toFixed(2)}
              </td>
              <td className="py-1.5 text-right"
                style={{ color: r.avgPnl >= 0 ? C.green : C.red }}>
                ${r.avgPnl.toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Trade Attribution Cards ──────────────────────────────────────────────────

function AttributionCards({ snap }: { snap: AnalyticsSnapshot }) {
  const all = [
    ...snap.symbolBreakdown.map((s)   => ({ ...s, type: "symbol" })),
    ...snap.strategyBreakdown.map((s) => ({ ...s, type: "exit" })),
  ].sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl)).slice(0, 8);

  if (!all.length) return <EmptyState msg="Trade attribution not available until first trade completes." />;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {all.map((a) => (
        <div key={`${a.type}-${a.label}`}
          className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-2.5">
          <p className="text-[13px] font-bold uppercase text-gray-500 mb-0.5">{a.type === "symbol" ? "Symbol" : "Exit Reason"}</p>
          <p className="text-sm font-semibold text-white truncate">{a.label}</p>
          <p className="text-sm font-bold mt-0.5" style={{ color: a.totalPnl >= 0 ? C.green : C.red }}>
            ${a.totalPnl.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500">
            {a.trades} trades · {a.winRate.toFixed(0)}% WR
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  serverUrl?: string;
  disabled?: boolean;
}

export default function ServerAnalyticsDashboard({ serverUrl = SERVER_URL, disabled }: Props) {
  const { snapshot: snap, loading, error, refresh } = useAnalytics(serverUrl);

  if (disabled) {
    return (
      <div className="text-center py-16 text-gray-600 text-sm">
        Analytics unavailable — server is offline.
      </div>
    );
  }

  const m = snap?.metrics;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Analytics & Performance Intelligence</h2>
          {snap?.computedAt && (
            <p className="text-xs text-gray-500 mt-0.5">
              Updated {new Date(snap.computedAt).toLocaleTimeString()} · {snap.tradeCount} trades analysed
            </p>
          )}
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-40 transition"
        >
          {loading ? "Refreshing…" : "⟳ Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2 text-xs text-red-400">
          {error} — ensure the bot server is running and you are logged in.
        </div>
      )}

      {/* ── Key metrics row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <MetricCard
          label="Total Trades"
          value={m?.totalTrades ?? "—"}
          color="white"
          dim={!m}
        />
        <MetricCard
          label="Win Rate"
          value={m ? `${m.winRate.toFixed(1)}%` : "—"}
          sub={m ? `${m.wins}W / ${m.losses}L` : undefined}
          color={m ? (m.winRate >= 50 ? C.green : C.red) : C.gray}
          dim={!m}
        />
        <MetricCard
          label="Profit Factor"
          value={m ? m.profitFactor.toFixed(2) : "—"}
          sub={m ? `Gross W: $${m.grossWin.toFixed(2)}` : undefined}
          color={m ? (m.profitFactor >= 1 ? C.green : C.red) : C.gray}
          dim={!m}
        />
        <MetricCard
          label="Expectancy"
          value={m ? `$${m.expectancy.toFixed(4)}` : "—"}
          sub="per trade"
          color={m ? (m.expectancy >= 0 ? C.green : C.red) : C.gray}
          dim={!m}
        />
        <MetricCard
          label="Sharpe Ratio"
          value={m ? m.sharpeRatio.toFixed(2) : "—"}
          sub={m ? (m.sharpeRatio >= 1 ? "Good" : m.sharpeRatio >= 0 ? "Low" : "Negative") : undefined}
          color={m ? (m.sharpeRatio >= 1 ? C.green : m.sharpeRatio >= 0 ? C.yellow : C.red) : C.gray}
          dim={!m}
        />
        <MetricCard
          label="Max Drawdown"
          value={m ? `${m.maxDrawdownPct.toFixed(1)}%` : "—"}
          sub={m ? `R:R ${m.riskRewardRatio.toFixed(2)}` : undefined}
          color={m ? (m.maxDrawdownPct <= 10 ? C.green : m.maxDrawdownPct <= 25 ? C.yellow : C.red) : C.gray}
          dim={!m}
        />
      </div>

      {/* ── Secondary metrics ─────────────────────────────────────────────────── */}
      {m && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <MetricCard label="Total PnL"   value={`$${m.totalPnlUsd.toFixed(2)}`}  color={m.totalPnlUsd >= 0 ? C.green : C.red} />
          <MetricCard label="Avg Win"     value={`$${m.avgWin.toFixed(4)}`}        color={C.green} />
          <MetricCard label="Avg Loss"    value={`$${m.avgLoss.toFixed(4)}`}       color={C.red} />
          <MetricCard label="Largest Win" value={`$${m.largestWin.toFixed(4)}`}    color={C.green} />
          <MetricCard label="Largest Loss" value={`$${m.largestLoss.toFixed(4)}`} color={C.red} />
          <MetricCard label="Avg Hold"    value={`${m.avgHoldMins.toFixed(0)} min`} color={C.cyan} />
        </div>
      )}

      {/* ── Equity Curve ──────────────────────────────────────────────────────── */}
      <SectionCard title="📈 Equity Curve — Cumulative PnL">
        {snap ? <EquityCurveChart snap={snap} /> : <EmptyState />}
      </SectionCard>

      {/* ── Daily PnL + Win/Loss ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <SectionCard title="📊 Daily PnL (Last 30 Days)">
            {snap ? <DailyPnlChart snap={snap} /> : <EmptyState />}
          </SectionCard>
        </div>
        <div>
          <SectionCard title="🥧 Win / Loss Distribution">
            {m ? <WinLossPie m={m} /> : <EmptyState />}
          </SectionCard>
        </div>
      </div>

      {/* ── Rolling PnL ───────────────────────────────────────────────────────── */}
      <SectionCard title="📉 Rolling PnL — 7-Day & 30-Day Windows">
        {snap ? <RollingPnlChart snap={snap} /> : <EmptyState />}
      </SectionCard>

      {/* ── Exit Reason + Symbol Breakdown ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SectionCard title="🎯 Exit Reason Breakdown">
          {snap ? <BreakdownChart data={snap.strategyBreakdown} color={C.blue} /> : <EmptyState />}
        </SectionCard>
        <SectionCard title="💱 Symbol Performance">
          {snap ? <BreakdownChart data={snap.symbolBreakdown} color={C.purple} /> : <EmptyState />}
        </SectionCard>
      </div>

      {/* ── PnL Heatmap ───────────────────────────────────────────────────────── */}
      <SectionCard title="🗓️ PnL Heatmap (Last 90 Trading Days)">
        <div className="space-y-1.5">
          {snap ? <PnlHeatmap cells={snap.heatmap} /> : <EmptyState />}
          <p className="text-xs text-gray-600">Each cell = 1 trading day. Hover for details.</p>
        </div>
      </SectionCard>

      {/* ── Trade Attribution ─────────────────────────────────────────────────── */}
      <SectionCard title="🔬 Trade Attribution">
        {snap ? <AttributionCards snap={snap} /> : <EmptyState />}
      </SectionCard>

      {/* ── Performance Table ─────────────────────────────────────────────────── */}
      <SectionCard title="📋 Performance Table — by Exit Reason / Symbol">
        {snap ? <PerformanceTable snap={snap} /> : <EmptyState />}
      </SectionCard>

      {/* ── AI Snapshot preview ───────────────────────────────────────────────── */}
      {snap?.aiSnapshot && (
        <SectionCard
          title="🤖 AI-Ready Snapshot"
          action={
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(snap.aiSnapshot, null, 2)], { type: "application/json" });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement("a");
                a.href = url; a.download = "analytics_snapshot.json"; a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
            >
              ⬇ Export JSON
            </button>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-gray-900/50 rounded p-2">
              <p className="text-gray-500 mb-0.5">Version</p>
              <p className="text-cyan-400">{snap.aiSnapshot.version}</p>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <p className="text-gray-500 mb-0.5">Timestamp</p>
              <p className="text-gray-300 text-xs">
                {new Date(snap.aiSnapshot.timestamp).toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <p className="text-gray-500 mb-0.5">Top Symbol</p>
              <p className="font-semibold text-white">
                {snap.aiSnapshot.topSymbols[0]?.symbol ?? "—"}
              </p>
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
