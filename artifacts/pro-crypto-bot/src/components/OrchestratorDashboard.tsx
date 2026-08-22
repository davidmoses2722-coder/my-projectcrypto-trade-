/**
 * OrchestratorDashboard — Phase 4 Automation & Intelligence
 * Live regime detection, strategy allocation, and intelligence rules.
 */

import { useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useOrchestrator } from "../hooks/useOrchestrator";
import type { Regime, StrategyEntry, OrchestratorStatus } from "../hooks/useOrchestrator";

// ─── Regime palette ───────────────────────────────────────────────────────────

const REGIME_META: Record<Regime, { label: string; color: string; icon: string; bg: string }> = {
  trending:       { label: "Trending",        color: "#22c55e", icon: "📈", bg: "bg-green-900/30  border-green-700/40" },
  ranging:        { label: "Ranging",         color: "#3b82f6", icon: "↔️",  bg: "bg-blue-900/30   border-blue-700/40"  },
  high_volatility:{ label: "High Volatility", color: "#ef4444", icon: "🔥", bg: "bg-red-900/30    border-red-700/40"   },
  low_volatility: { label: "Low Volatility",  color: "#a855f7", icon: "💤", bg: "bg-purple-900/30 border-purple-700/40"},
  breakout:       { label: "Breakout",        color: "#f97316", icon: "⚡", bg: "bg-orange-900/30 border-orange-700/40"},
  reversal:       { label: "Reversal",        color: "#eab308", icon: "🔄", bg: "bg-yellow-900/30 border-yellow-700/40"},
  unknown:        { label: "Unknown",         color: "#6b7280", icon: "❓", bg: "bg-gray-800/40   border-gray-700/40"  },
};

const ALLOC_COLORS = ["#22c55e","#3b82f6","#f97316","#a855f7","#06b6d4"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConfBar({ value, color, height = 8 }: { value: number; color: string; height?: number }) {
  return (
    <div className="w-full bg-gray-800 rounded-full overflow-hidden" style={{ height }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(2, value)}%`, background: color }}
      />
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-semibold"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {children}
    </span>
  );
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ msg = "No data yet" }: { msg?: string }) {
  return <div className="flex items-center justify-center h-20 text-gray-600 text-xs">{msg}</div>;
}

// ─── Regime banner ────────────────────────────────────────────────────────────

function RegimeBanner({ s }: { s: OrchestratorStatus }) {
  const m = REGIME_META[s.regime] ?? REGIME_META.unknown;
  return (
    <div className={`rounded-xl border p-4 ${m.bg}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{m.icon}</span>
            <span className="font-bold text-white text-sm">{m.label}</span>
            <Badge color={m.color}>{s.regimeConfidence}% confidence</Badge>
            {s.lossStreak >= 3 && (
              <Badge color="#ef4444">🔴 {s.lossStreak} loss streak</Badge>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{s.regimeReason}</p>
          <div className="mt-2">
            <ConfBar value={s.regimeConfidence} color={m.color} height={6} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[13px] font-bold text-gray-500 uppercase mb-0.5">Market Conf.</p>
          <p className="font-bold text-white text-lg">{s.marketConfidence}%</p>
          <p className="text-xs text-gray-500">Vol {s.volRatio.toFixed(2)}×</p>
        </div>
      </div>
    </div>
  );
}

// ─── Allocation chart ─────────────────────────────────────────────────────────

function AllocationChart({ strategies }: { strategies: StrategyEntry[] }) {
  const active = strategies.filter((s) => s.enabled && s.allocation > 0);
  if (!active.length) return <EmptyState msg="No active allocations" />;

  const pieData = active.map((s) => ({ name: s.name, value: s.allocation }));
  const barData = strategies
    .filter((s) => s.weight > 0 || !s.enabled)
    .map((s) => ({ name: s.name, weight: s.weight, alloc: s.allocation }));

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-center">
      {/* Pie */}
      <div className="shrink-0">
        <ResponsiveContainer width={120} height={120}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={28} outerRadius={55}
              dataKey="value" stroke="none">
              {pieData.map((_, i) => <Cell key={i} fill={ALLOC_COLORS[i % ALLOC_COLORS.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
              formatter={(v: any) => [`${v}%`, "Allocation"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* Bar */}
      <div className="flex-1 w-full">
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={barData} layout="vertical"
            margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false}
              tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false} width={58} />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
              formatter={(v: any) => [`${v}%`]}
            />
            <Bar dataKey="alloc" name="Capital %" radius={[0, 3, 3, 0]}>
              {barData.map((_, i) => (
                <Cell key={i} fill={ALLOC_COLORS[i % ALLOC_COLORS.length]} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Strategy cards ───────────────────────────────────────────────────────────

function StrategyCard({
  s, onToggle, onWeightChange,
}: {
  s: StrategyEntry;
  onToggle: () => void;
  onWeightChange: (w: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [wInput, setWInput]   = useState(String(s.weight));

  const suitColor = (r: Regime) => REGIME_META[r]?.color ?? "#9ca3af";

  return (
    <div className={`rounded-lg border p-3 ${
      s.enabled
        ? "bg-gray-800/60 border-gray-600/50"
        : "bg-gray-900/40 border-gray-800/50 opacity-60"
    }`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-white">{s.name}</span>
          {s.enabled
            ? <Badge color="#22c55e">ACTIVE</Badge>
            : <Badge color="#6b7280">DISABLED</Badge>}
        </div>
        <button
          onClick={onToggle}
          className={`text-xs px-2 py-0.5 rounded transition ${
            s.enabled
              ? "bg-red-900/40 hover:bg-red-800/60 text-red-400 border border-red-800/40"
              : "bg-green-900/40 hover:bg-green-800/60 text-green-400 border border-green-800/40"
          }`}
        >
          {s.enabled ? "Disable" : "Enable"}
        </button>
      </div>

      {/* Weight / Allocation */}
      <div className="flex items-center gap-3 mb-1.5">
        <div>
          <p className="text-[13px] font-bold text-gray-500 uppercase">Weight</p>
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                type="number" min="0" max="100"
                value={wInput}
                onChange={(e) => setWInput(e.target.value)}
                className="w-12 text-xs bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white"
              />
              <button
                onClick={() => { onWeightChange(Number(wInput)); setEditing(false); }}
                className="text-xs px-1.5 py-0.5 bg-blue-700/60 hover:bg-blue-600 text-blue-300 rounded"
              >✓</button>
              <button onClick={() => setEditing(false)} className="text-xs text-gray-500">✕</button>
            </div>
          ) : (
            <button onClick={() => { setWInput(String(s.weight)); setEditing(true); }}
              className="text-xs font-bold text-white hover:text-blue-400 transition">
              {s.weight}
            </button>
          )}
        </div>
        <div>
          <p className="text-[13px] font-bold text-gray-500 uppercase">Alloc</p>
          <p className="text-xs font-bold" style={{ color: s.enabled ? "#22c55e" : "#6b7280" }}>
            {s.allocation.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Suitable regimes */}
      <div className="flex flex-wrap gap-1 mb-1.5">
        {s.suitable.map((r) => (
          <span key={r} className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: `${suitColor(r)}20`, color: suitColor(r), border: `1px solid ${suitColor(r)}33` }}>
            {r.replace("_", " ")}
          </span>
        ))}
      </div>

      <p className="text-xs text-gray-500 truncate">{s.reason}</p>
    </div>
  );
}

// ─── Intelligence rules ───────────────────────────────────────────────────────

function RulesList({ rules }: { rules: OrchestratorStatus["rules"] }) {
  if (!rules.length) return <EmptyState />;
  return (
    <div className="space-y-2">
      {rules.map((r) => (
        <div key={r.id} className={`flex items-start gap-2 p-2.5 rounded-lg border ${
          r.triggered
            ? r.severity === "critical" ? "bg-red-900/20 border-red-800/40"
            : r.severity === "warning"  ? "bg-yellow-900/20 border-yellow-800/40"
            : "bg-blue-900/20 border-blue-800/40"
            : "bg-gray-900/30 border-gray-800/30 opacity-50"
        }`}>
          <span className="mt-0.5 text-sm">
            {r.triggered
              ? r.severity === "critical" ? "🔴"
              : r.severity === "warning"  ? "🟡" : "🟢"
              : "⚪"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-semibold text-white">{r.name}</p>
              {r.triggered && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-900/40 text-orange-400 border border-orange-800/40">
                  TRIGGERED
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">{r.description}</p>
            {r.triggered && (
              <p className="text-xs text-gray-300 mt-0.5">→ {r.action}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Orchestration log ────────────────────────────────────────────────────────

function OrchLog({ entries }: { entries: OrchestratorStatus["log"] }) {
  if (!entries.length) return <EmptyState msg="No orchestration events yet" />;
  return (
    <div className="font-sans text-xs space-y-0.5 max-h-48 overflow-y-auto pr-1">
      {entries.map((e, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-gray-600 shrink-0">{e.ts.slice(11, 19)}</span>
          <span className={
            e.msg.includes("[Regime]")      ? "text-cyan-400"   :
            e.msg.includes("[Intelligence]")? "text-yellow-400" :
            e.msg.includes("[Allocation]")  ? "text-green-400"  :
            e.msg.includes("[Orchestrator]")? "text-blue-400"   :
            "text-gray-300"
          }>{e.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Config panel ─────────────────────────────────────────────────────────────

function ConfigPanel({ updateConfig }: { updateConfig: (p: any) => Promise<any> }) {
  const [open, setOpen]   = useState(false);
  const [volH, setVolH]   = useState("1.5");
  const [volL, setVolL]   = useState("0.7");
  const [emaG, setEmaG]   = useState("1.0");
  const [streak, setStreak] = useState("3");
  const [maxA, setMaxA]   = useState("60");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition">
        ⚙ Config
      </button>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    await updateConfig({
      volHighThreshold:      parseFloat(volH),
      volLowThreshold:       parseFloat(volL),
      emaGapTrendPct:        parseFloat(emaG),
      losingStreakThreshold: parseInt(streak, 10),
      maxSingleAllocPct:     parseInt(maxA, 10),
    });
    setSaving(false);
    setOpen(false);
  };

  const field = (label: string, val: string, set: (v: string) => void) => (
    <div>
      <label className="text-xs text-gray-400 block mb-0.5">{label}</label>
      <input type="number" value={val} onChange={(e) => set(e.target.value)} step="0.1"
        className="w-full text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white" />
    </div>
  );

  return (
    <div className="bg-gray-900/60 border border-gray-700 rounded-xl p-3 mt-3 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {field("Vol High Threshold (×)", volH, setVolH)}
        {field("Vol Low Threshold (×)",  volL, setVolL)}
        {field("EMA Gap Trend %",        emaG, setEmaG)}
        {field("Losing Streak Limit",    streak, setStreak)}
        {field("Max Single Alloc %",     maxA, setMaxA)}
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40 transition">
          {saving ? "Saving…" : "Save Config"}
        </button>
        <button onClick={() => setOpen(false)}
          className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { serverUrl: string; disabled?: boolean; }

export default function OrchestratorDashboard({ serverUrl, disabled }: Props) {
  const { status, loading, error, refresh, sendOverride, updateConfig } =
    useOrchestrator(serverUrl);

  if (disabled) {
    return (
      <div className="text-center py-16 text-gray-600 text-sm">
        Orchestrator unavailable — server is offline.
      </div>
    );
  }

  const s = status;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Automation & Intelligence Orchestrator</h2>
          {s?.lastComputed && (
            <p className="text-xs text-gray-500 mt-0.5">
              Computed {new Date(s.lastComputed).toLocaleTimeString()} · polls every 10 s
            </p>
          )}
        </div>
        <button onClick={() => void refresh()} disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-40 transition">
          {loading ? "Refreshing…" : "⟳ Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Regime banner */}
      {s ? <RegimeBanner s={s} /> : (
        <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-4 animate-pulse h-20" />
      )}

      {/* Strategy allocation */}
      <SectionCard title="📊 Strategy Allocation">
        {s ? <AllocationChart strategies={s.strategies} /> : <EmptyState />}
      </SectionCard>

      {/* Strategy cards */}
      <SectionCard title="🎛️ Strategy Control">
        {s ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {s.strategies.map((strat) => (
              <StrategyCard
                key={strat.id}
                s={strat}
                onToggle={() => sendOverride(strat.id, { enabled: !strat.enabled })}
                onWeightChange={(w) => sendOverride(strat.id, { weight: w })}
              />
            ))}
          </div>
        ) : <EmptyState />}
        {s && (
          <div className="mt-3 pt-3 border-t border-gray-700/40">
            <p className="text-xs text-gray-500 mb-2">
              Active Strategy: <span className="text-white font-semibold">{s.activeStrategyId}</span>
              {" · "}Total Allocated: <span className="text-green-400 font-semibold">{s.totalAllocPct.toFixed(1)}%</span>
              {" · "}Vol Ratio: <span className="text-cyan-400">{s.volRatio.toFixed(2)}×</span>
            </p>
            <button
              onClick={() => {
                if (s) {
                  for (const strat of s.strategies) {
                    sendOverride(strat.id, {}, true);
                  }
                }
              }}
              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-400 transition"
            >
              ↺ Reset All Overrides
            </button>
          </div>
        )}
      </SectionCard>

      {/* Intelligence rules */}
      <SectionCard title="🧠 Intelligence Rules">
        {s ? <RulesList rules={s.rules} /> : <EmptyState />}
      </SectionCard>

      {/* Orchestration log */}
      <SectionCard title="📋 Orchestration Log — [Regime] [Allocation] [Intelligence]">
        {s ? <OrchLog entries={s.log} /> : <EmptyState />}
      </SectionCard>

      {/* Config */}
      <SectionCard title="⚙️ Orchestrator Configuration">
        <ConfigPanel updateConfig={updateConfig} />
      </SectionCard>

    </div>
  );
}
