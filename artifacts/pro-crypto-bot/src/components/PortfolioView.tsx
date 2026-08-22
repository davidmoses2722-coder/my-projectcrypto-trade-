/**
 * PortfolioView — Consolidated Portfolio Page
 * Canonical import for routing. Merges PortfolioPanel + PortfolioManagerPanel.
 *
 * Sections:
 *  1. Live Positions (from /api/status → portfolio snapshot)
 *  2. Portfolio Manager (from /api/portfolio-manager)
 *  3. Allocation pie chart + per-asset table
 *  4. Realized PnL, unrealized PnL, fees, exposure, risk score, capital usage
 */

import { useState, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import type { ServerStatus, PortfolioPosition } from "../hooks/useBotServer";
import { usePortfolioManager } from "../hooks/useAnalytics";
import type { PortfolioManagerEntry, PortfolioManagerSummary } from "../hooks/useAnalytics";
import { SERVER_URL } from "../config/urls";
import { PremiumCard, PremiumCardContent, PremiumCardHeader, PremiumCardTitle } from "./premium/PremiumCard";
import { PremiumStatCard } from "./premium/PremiumStatCard";
import { StatusBadge } from "./premium/StatusBadge";

// ─── Palette ──────────────────────────────────────────────────────────────────
const ALLOC_COLORS = [
  "#06b6d4", "#3b82f6", "#a855f7", "#14b8a6",
  "#f97316", "#eab308", "#22c55e", "#ef4444",
];
const PRESET_STYLES: Record<string, string> = {
  conservative: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  balanced:     "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  aggressive:   "text-red-400 bg-red-500/10 border-red-500/30",
  custom:       "text-purple-400 bg-purple-500/10 border-purple-500/30",
};
const PRESET_ICONS: Record<string, string> = {
  conservative: "Shield", balanced: "Scale", aggressive: "Rocket", custom: "Wrench",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 2): string { return n.toFixed(dec); }

function pnlColor(n: number): string {
  if (n > 0) return "text-green-400";
  if (n < 0) return "text-red-400";
  return "text-gray-400";
}

function pnlSign(n: number): string { return n >= 0 ? "+" : ""; }

function age(openedAt: number): string {
  const s = Math.floor((Date.now() - openedAt) / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function riskScore(exposurePct: number, drawdownPct: number, consecLosses: number): { score: number; label: string; color: string } {
  const raw = Math.min(100, exposurePct * 0.4 + drawdownPct * 0.4 + consecLosses * 5);
  const label = raw < 25 ? "Low" : raw < 55 ? "Moderate" : raw < 80 ? "High" : "Critical";
  const color = raw < 25 ? "text-green-400" : raw < 55 ? "text-yellow-400" : raw < 80 ? "text-orange-400" : "text-red-400";
  return { score: Math.round(raw), label, color };
}

function Skeleton({ h = 80 }: { h?: number }) {
  return <div className="animate-pulse bg-gray-800/60 rounded-lg w-full" style={{ height: h }} />;
}

function EmptyState({ msg = "No data available" }: { msg?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-gray-600 text-xs gap-1">
      <div className="text-2xl text-gray-700 mb-1">—</div>
      <p>{msg}</p>
    </div>
  );
}

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs shadow-xl">
      {label && <p className="text-gray-400 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? "#fff" }}>
          {p.name}: <span className="font-semibold">{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Summary tiles ────────────────────────────────────────────────────────────

function SummaryTile({ label, value, sub, color = "text-slate-50" }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 hover:border-slate-600/50 transition-colors">
      <p className="text-[13px] font-bold uppercase tracking-wider tracking-widest text-slate-500 mb-2">{label}</p>
      <p className={`font-black text-xl ${color}`}>{value}</p>
      {sub && <p className="text-slate-600 text-xs mt-1">{sub}</p>}
    </div>
  );
}

// ─── 1. Live Positions ────────────────────────────────────────────────────────

function LivePositionsSection({ status }: { status: ServerStatus }) {
  const snap = status.portfolio;

  if (!snap) {
    return (
      <PremiumCard>
        <PremiumCardContent className="p-5">
          <h3 className="text-base font-bold text-white mb-3">Open Positions</h3>
          <EmptyState msg="Portfolio data not available — bot may be offline" />
        </PremiumCardContent>
      </PremiumCard>
    );
  }

  const { positions, openCount, totalExposureUsdt, totalUnrealizedPnl, byStrategy, config } = snap;
  const exposurePct  = config.maxTotalExposureUsdt > 0
    ? Math.min((totalExposureUsdt / config.maxTotalExposureUsdt) * 100, 100)
    : 0;
  const exposureColor =
    exposurePct >= 80 ? "bg-red-500" :
    exposurePct >= 50 ? "bg-yellow-400" : "bg-cyan-500";

  const risk = riskScore(exposurePct, 0, 0);

  return (
    <PremiumCard hoverGlow>
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
        <h3 className="text-base font-bold text-white">Open Positions</h3>
        <StatusBadge
          variant={openCount > 0 ? "live" : "offline"}
          label={`${openCount} open`}
          pulse={openCount > 0}
        />
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-auto" />
      </div>

      <div className="p-4 space-y-4">
        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryTile
            label="Exposure"
            value={`$${fmt(totalExposureUsdt, 0)}`}
            sub={`of $${config.maxTotalExposureUsdt} limit`}
          />
          <SummaryTile
            label="Unrealized P&L"
            value={`${pnlSign(totalUnrealizedPnl)}$${fmt(totalUnrealizedPnl)}`}
            sub={`${openCount} position${openCount !== 1 ? "s" : ""}`}
            color={pnlColor(totalUnrealizedPnl)}
          />
          <SummaryTile
            label="Capacity"
            value={`${openCount}/${config.maxOpenPositions}`}
            sub="positions used"
          />
          <SummaryTile
            label="Risk Score"
            value={`${risk.score} — ${risk.label}`}
            sub={`${exposurePct.toFixed(1)}% exposure`}
            color={risk.color}
          />
        </div>

        {/* Exposure bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-gray-500 text-[13px] font-bold uppercase tracking-wider">Capital Usage</span>
            <span className="text-xs text-gray-400">{exposurePct.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${exposureColor}`}
              style={{ width: `${exposurePct}%` }}
            />
          </div>
          {exposurePct >= 80 && (
            <p className="text-red-400 text-xs mt-1">Near exposure limit — new entries may be blocked</p>
          )}
        </div>

        {/* Allocation pie — by strategy */}
        {Object.keys(byStrategy).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Pie */}
            <div>
              <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider mb-2">Allocation by Strategy</p>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={100} height={100}>
                  <PieChart>
                    <Pie
                      data={Object.entries(byStrategy).map(([name, d]) => ({ name: name.replace("Strategy",""), value: d.exposureUsdt }))}
                      cx="50%" cy="50%" innerRadius={25} outerRadius={45}
                      dataKey="value" stroke="none"
                    >
                      {Object.keys(byStrategy).map((_, i) => (
                        <Cell key={i} fill={ALLOC_COLORS[i % ALLOC_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<DarkTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 text-xs">
                  {Object.entries(byStrategy).map(([name, d], i) => (
                    <div key={name} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: ALLOC_COLORS[i % ALLOC_COLORS.length] }} />
                      <span className="text-gray-300 truncate max-w-[80px]">{name.replace("Strategy", "")}</span>
                      <span className="text-gray-500 ml-auto">${fmt(d.exposureUsdt, 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bar — per-strategy bars */}
            <div>
              <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider mb-2">Per-Strategy Usage</p>
              <div className="space-y-1.5">
                {Object.entries(byStrategy).map(([name, data], i) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs w-24 truncate">{name.replace("Strategy", "")}</span>
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min((data.count / config.maxPerStrategy) * 100, 100)}%`,
                          background: ALLOC_COLORS[i % ALLOC_COLORS.length],
                        }}
                      />
                    </div>
                    <span className="text-gray-500 text-xs w-20 text-right">
                      {data.count}/{config.maxPerStrategy} · ${fmt(data.exposureUsdt, 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Positions table */}
        {positions.length > 0 ? (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-left border-collapse min-w-[580px]">
              <thead>
                <tr className="border-b border-gray-700">
                  {["Symbol", "Engine", "Entry", "Price", "Unreal. P&L", "SL", "TP", "Age", "Size"].map((h) => (
                    <th key={h} className="py-1.5 px-3 text-gray-600 text-[13px] font-bold uppercase tracking-wider font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <PositionRow key={pos.id} pos={pos} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-6 text-gray-700">
            <p className="text-xs">No open positions</p>
            <p className="text-xs mt-0.5 text-gray-800">Positions appear here when the bot opens a trade</p>
          </div>
        )}
      </div>
    </PremiumCard>
  );
}

function PositionRow({ pos }: { pos: PortfolioPosition }) {
  const pnl    = pos.unrealizedPnl;
  const pnlPct = pos.unrealizedPnlPct;
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
      <td className="py-2.5 px-3 text-xs">
        <div className="font-bold text-white">{pos.symbol}</div>
        <div className="text-gray-600 text-xs">{pos.dryRun ? "PAPER" : "LIVE"}</div>
      </td>
      <td className="py-2.5 px-3 text-xs text-gray-400 max-w-[90px] truncate">
        {pos.strategy.replace("Strategy", "")}
      </td>
      <td className="py-2.5 px-3 text-xs text-gray-300">${fmt(pos.entryPrice)}</td>
      <td className="py-2.5 px-3 text-xs text-cyan-300">${fmt(pos.lastPrice)}</td>
      <td className={`py-2.5 px-3 text-xs font-bold ${pnlColor(pnl)}`}>
        {pnlSign(pnl)}${fmt(pnl)}
        <span className="text-xs ml-1 font-normal opacity-70">
          ({pnlSign(pnlPct)}{fmt(pnlPct, 2)}%)
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-red-400">${fmt(pos.slPrice)}</td>
      <td className="py-2.5 px-3 text-xs text-green-400">${fmt(pos.tpPrice)}</td>
      <td className="py-2.5 px-3 text-xs text-gray-500">{age(pos.openedAt)}</td>
      <td className="py-2.5 px-3 text-xs text-gray-400">${fmt(pos.sizeUsdt, 0)}</td>
    </tr>
  );
}

// ─── 2. Portfolio Manager Section ─────────────────────────────────────────────

function PortfolioManagerSection() {
  const pm = usePortfolioManager(SERVER_URL);
  const [selected,   setSelected]   = useState<PortfolioManagerEntry | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newPort,    setNewPort]    = useState({
    name: "", description: "", riskPreset: "balanced", totalCapitalUsdt: 1000,
  });

  const handleSelect = useCallback(async (id: string) => {
    if (selected?.id === id) { setSelected(null); return; }
    const detail = await pm.loadDetail(id);
    if (detail) setSelected(detail);
  }, [selected, pm]);

  const handleApplyPreset = useCallback(async (id: string, preset: string) => {
    const updated = await pm.applyPreset(id, preset);
    if (updated) setSelected(updated);
  }, [pm]);

  const handleCreate = useCallback(async () => {
    if (!newPort.name) return;
    const ok = await pm.create(newPort);
    if (ok) {
      setShowCreate(false);
      setNewPort({ name: "", description: "", riskPreset: "balanced", totalCapitalUsdt: 1000 });
    }
  }, [newPort, pm]);

  return (
    <PremiumCard hoverGlow>
      <PremiumCardContent className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white">Portfolio Manager</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            Multi-portfolio with Conservative / Balanced / Aggressive presets
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30"
          >
            + New
          </button>
          <button
            onClick={() => void pm.refresh()}
            disabled={pm.loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25"
          >
            {pm.loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {pm.error && (
        <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2 text-xs text-red-400">
          {pm.error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-800 border border-cyan-500/30 rounded-xl p-4 space-y-3">
          <p className="text-sm font-bold text-white">New Portfolio</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Name</label>
              <input
                value={newPort.name}
                onChange={(e) => setNewPort((p) => ({ ...p, name: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
                placeholder="My Portfolio"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Preset</label>
              <select
                value={newPort.riskPreset}
                onChange={(e) => setNewPort((p) => ({ ...p, riskPreset: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                {["conservative", "balanced", "aggressive", "custom"].map((p) => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Capital (USDT)</label>
              <input
                type="number"
                value={newPort.totalCapitalUsdt}
                onChange={(e) => setNewPort((p) => ({ ...p, totalCapitalUsdt: Number(e.target.value) }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Description</label>
              <input
                value={newPort.description}
                onChange={(e) => setNewPort((p) => ({ ...p, description: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleCreate()}
              className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-bold rounded-lg"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Portfolio cards */}
      {pm.loading && pm.summaries.length === 0 ? (
        <div className="space-y-3">
          <Skeleton h={70} /><Skeleton h={70} />
        </div>
      ) : pm.summaries.length === 0 ? (
        <EmptyState msg="No portfolios yet — create one above" />
      ) : (
        <div className="space-y-3">
          {pm.summaries.map((p: PortfolioManagerSummary, idx: number) => (
            <PortfolioCard
              key={p.id}
              p={p}
              selected={selected}
              colorIdx={idx}
              onSelect={() => void handleSelect(p.id)}
              onActivate={() => void pm.activate(p.id)}
              onDelete={() => void pm.deletePortfolio(p.id)}
              onApplyPreset={(preset) => void handleApplyPreset(p.id, preset)}
            />
          ))}
        </div>
      )}
      </PremiumCardContent>
    </PremiumCard>
  );
}

interface PortfolioCardProps {
  p:            PortfolioManagerSummary;
  selected:     PortfolioManagerEntry | null;
  colorIdx:     number;
  onSelect:     () => void;
  onActivate:   () => void;
  onDelete:     () => void;
  onApplyPreset:(preset: string) => void;
}

function PortfolioCard({ p, selected, colorIdx, onSelect, onActivate, onDelete, onApplyPreset }: PortfolioCardProps) {
  const isSelected = selected?.id === p.id;

  // Build allocation chart data for this portfolio
  const allocationData = isSelected && selected
    ? selected.allocations.map((a, i) => ({
        name:  a.strategyName,
        value: a.allocationPct,
        color: ALLOC_COLORS[i % ALLOC_COLORS.length],
      }))
    : [];

  return (
    <div className={`bg-gray-800/60 border rounded-xl overflow-hidden transition-colors ${
      p.active ? "border-cyan-500/40" : "border-gray-700/50"
    }`}>
      {/* Summary row */}
      <div className="p-4 cursor-pointer hover:bg-gray-800/40 transition-colors" onClick={onSelect}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: ALLOC_COLORS[colorIdx % ALLOC_COLORS.length] }}
            />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white">{p.name}</span>
                {p.active && (
                  <span className="text-xs px-1.5 py-0.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-full font-bold">
                    ACTIVE
                  </span>
                )}
                <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${PRESET_STYLES[p.riskPreset] ?? ""}`}>
                  {p.riskPreset.charAt(0).toUpperCase() + p.riskPreset.slice(1)}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {p.strategyCount} strategies · ${p.totalCapitalUsdt.toLocaleString()} USDT capital
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {!p.active && (
              <button
                onClick={(e) => { e.stopPropagation(); onActivate(); }}
                className="text-xs px-2 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30"
              >
                Activate
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="text-xs px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
            >
              Delete
            </button>
            <span className={`text-gray-500 text-xs self-center transition-transform ${isSelected ? "rotate-90" : ""}`}>
              &rsaquo;
            </span>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {isSelected && selected && (
        <div className="border-t border-gray-700/60 p-4 space-y-5">
          {/* Metrics */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Max Daily Loss", value: `${selected.maxDailyLossPct}%` },
              { label: "Max Drawdown",   value: `${selected.maxDrawdownPct}%` },
              { label: "Max Trades",     value: selected.maxOpenTrades },
            ].map((m) => (
              <div key={m.label} className="bg-gray-900/60 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-400">{m.label}</p>
                <p className="text-sm font-bold text-white">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Allocation Pie + Table */}
          {allocationData.length > 0 && (
            <div>
              <p className="text-[13px] font-bold text-gray-400 uppercase tracking-wide mb-3">Strategy Allocations</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                {/* Pie */}
                <div className="flex items-center gap-3">
                  <ResponsiveContainer width={100} height={100}>
                    <PieChart>
                      <Pie
                        data={allocationData}
                        cx="50%" cy="50%"
                        innerRadius={25} outerRadius={45}
                        dataKey="value" stroke="none"
                      >
                        {allocationData.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<DarkTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1 text-xs">
                    {allocationData.map((d, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                        <span className="text-gray-300 truncate max-w-[80px]">{d.name}</span>
                        <span className="font-semibold text-white ml-auto">{d.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Allocation bars */}
                <div className="space-y-2">
                  {selected.allocations.map((a, i) => (
                    <div key={a.strategyId} className={`flex items-center gap-2 ${!a.enabled ? "opacity-40" : ""}`}>
                      <span className="text-xs w-20 text-gray-300 truncate">{a.strategyName}</span>
                      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${a.allocationPct}%`, background: ALLOC_COLORS[i % ALLOC_COLORS.length] }}
                        />
                      </div>
                      <span className="text-xs w-8 text-right" style={{ color: ALLOC_COLORS[i % ALLOC_COLORS.length] }}>
                        {a.allocationPct}%
                      </span>
                      <span className="text-xs text-gray-600 w-14">max {a.maxPositionPct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Allocation bar chart */}
          {allocationData.length > 0 && (
            <div>
              <p className="text-[13px] font-bold text-gray-400 uppercase tracking-wide mb-2">Allocation Distribution</p>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={allocationData} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#9ca3af" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "#9ca3af" }} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<DarkTooltip />} />
                  <Bar dataKey="value" name="Allocation %" radius={[3, 3, 0, 0]}>
                    {allocationData.map((d, i) => (
                      <Cell key={i} fill={d.color} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Preset switcher */}
          <div>
            <p className="text-[13px] font-bold text-gray-400 mb-2 uppercase tracking-wide">Switch Preset</p>
            <div className="flex flex-wrap gap-2">
              {["conservative", "balanced", "aggressive", "custom"].map((preset) => (
                <button
                  key={preset}
                  onClick={() => onApplyPreset(preset)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    selected.riskPreset === preset
                      ? PRESET_STYLES[preset]
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  {preset.charAt(0).toUpperCase() + preset.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 3. Capital & Risk Summary ────────────────────────────────────────────────

function CapitalSummarySection({ status }: { status: ServerStatus }) {
  const snap    = status.portfolio;
  const advRisk = status.advancedRisk;

  const totalExposure   = snap?.totalExposureUsdt    ?? 0;
  const maxExposure     = snap?.config.maxTotalExposureUsdt ?? 0;
  const unrealizedPnl   = snap?.totalUnrealizedPnl   ?? 0;
  const capitalPct      = maxExposure > 0 ? (totalExposure / maxExposure) * 100 : 0;
  const realizedPnl     = advRisk?.dailyPnlUsd        ?? 0;
  const weeklyPnl       = advRisk?.weeklyPnlUsd       ?? 0;
  const drawdownPct     = advRisk?.drawdownPct         ?? 0;
  const consecLosses    = advRisk?.consecutiveLosses   ?? 0;

  const risk = riskScore(capitalPct, drawdownPct, consecLosses);

  return (
    <PremiumCard hoverGlow>
      <PremiumCardContent className="p-5">
      <h3 className="text-base font-bold text-white mb-3">Capital & Risk Summary</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile
          label="Unrealized P&L"
          value={`${pnlSign(unrealizedPnl)}$${fmt(unrealizedPnl)}`}
          sub="open positions"
          color={pnlColor(unrealizedPnl)}
        />
        <SummaryTile
          label="Realized P&L (today)"
          value={`${pnlSign(realizedPnl)}$${fmt(realizedPnl)}`}
          sub="daily closed trades"
          color={pnlColor(realizedPnl)}
        />
        <SummaryTile
          label="Weekly P&L"
          value={`${pnlSign(weeklyPnl)}$${fmt(weeklyPnl)}`}
          sub="rolling 7-day"
          color={pnlColor(weeklyPnl)}
        />
        <SummaryTile
          label="Capital Usage"
          value={`${capitalPct.toFixed(1)}%`}
          sub={`$${fmt(totalExposure, 0)} / $${fmt(maxExposure, 0)}`}
          color={capitalPct >= 80 ? "text-red-400" : capitalPct >= 50 ? "text-yellow-400" : "text-green-400"}
        />
        <SummaryTile
          label="Max Drawdown"
          value={`${drawdownPct.toFixed(2)}%`}
          sub="from peak balance"
          color={drawdownPct >= 10 ? "text-red-400" : drawdownPct >= 5 ? "text-yellow-400" : "text-green-400"}
        />
        <SummaryTile
          label="Consecutive Losses"
          value={String(consecLosses)}
          sub="current streak"
          color={consecLosses >= 3 ? "text-red-400" : consecLosses >= 1 ? "text-yellow-400" : "text-green-400"}
        />
        <SummaryTile
          label="Risk Score"
          value={`${risk.score} / 100`}
          sub={risk.label}
          color={risk.color}
        />
        <SummaryTile
          label="Exposure"
          value={`$${fmt(totalExposure, 0)}`}
          sub={maxExposure > 0 ? `of $${fmt(maxExposure, 0)} limit` : "no limit set"}
        />
      </div>

      {/* Capital usage bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-gray-500 mb-1.5">
          <span>Capital Usage</span>
          <span>{capitalPct.toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              capitalPct >= 80 ? "bg-red-500" : capitalPct >= 50 ? "bg-yellow-400" : "bg-cyan-500"
            }`}
            style={{ width: `${Math.min(capitalPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Fees note */}
      <p className="text-xs text-slate-700 mt-3">
        Fees paid: tracked per execution record via /api/execution-analytics.
        {" "}
        <span className="text-slate-600">See Execution Analytics tab for detailed fee breakdown.</span>
      </p>
      </PremiumCardContent>
    </PremiumCard>
  );
}

// ─── Main PortfolioView ───────────────────────────────────────────────────────

interface PortfolioViewProps {
  status: ServerStatus;
}

export function PortfolioView({ status }: PortfolioViewProps) {
  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-black text-white">Portfolio</h1>
        <p className="text-gray-500 text-xs mt-0.5">
          Live positions · Capital allocation · Portfolio manager · Risk summary
        </p>
      </div>

      {/* Capital & Risk Summary */}
      <CapitalSummarySection status={status} />

      {/* Live Positions */}
      <LivePositionsSection status={status} />

      {/* Portfolio Manager */}
      <PortfolioManagerSection />
    </div>
  );
}
