import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";

interface PortfolioAllocation { strategyId: string; strategyName: string; allocationPct: number; maxPositionPct: number; enabled: boolean; }
interface Portfolio {
  id: string; name: string; description: string; riskPreset: string;
  totalCapitalUsdt: number; allocations: PortfolioAllocation[];
  maxDailyLossPct: number; maxDrawdownPct: number; maxOpenTrades: number; active: boolean;
}
interface PortfolioSummary { id: string; name: string; riskPreset: string; totalCapitalUsdt: number; active: boolean; strategyCount: number; }

const PRESET_STYLES: Record<string, string> = {
  conservative: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  balanced:     "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  aggressive:   "text-red-400 bg-red-500/10 border-red-500/30",
  custom:       "text-purple-400 bg-purple-500/10 border-purple-500/30",
};

const PRESET_ICONS: Record<string, string> = {
  conservative: "🛡️", balanced: "⚖️", aggressive: "🚀", custom: "🔧",
};

export function PortfolioManagerPanel() {
  const [summaries,  setSummaries]  = useState<PortfolioSummary[]>([]);
  const [selected,   setSelected]   = useState<Portfolio | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newPort,    setNewPort]    = useState({ name: "", description: "", riskPreset: "balanced", totalCapitalUsdt: 1000 });

  const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("pcb_jwt") ?? ""}` });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${SERVER_URL}/api/portfolio-manager`, { headers: auth() });
      const data = await res.json() as { ok: boolean; data?: PortfolioSummary[] };
      if (data.ok && data.data) setSummaries(data.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const loadDetail = async (id: string) => {
    if (selected?.id === id) { setSelected(null); return; }
    const res  = await fetch(`${SERVER_URL}/api/portfolio-manager/${id}`, { headers: auth() });
    const data = await res.json() as { ok: boolean; data?: Portfolio };
    if (data.ok && data.data) setSelected(data.data);
  };

  const activate = async (id: string) => {
    await fetch(`${SERVER_URL}/api/portfolio-manager/${id}/activate`, { method: "POST", headers: auth() });
    void load();
    if (selected?.id === id) void loadDetail(id);
  };

  const applyPreset = async (id: string, preset: string) => {
    const res  = await fetch(`${SERVER_URL}/api/portfolio-manager/${id}/apply-preset`, {
      method: "POST", headers: auth(), body: JSON.stringify({ preset }),
    });
    const data = await res.json() as { ok: boolean; data?: Portfolio };
    if (data.ok && data.data) setSelected(data.data);
    void load();
  };

  const create = async () => {
    if (!newPort.name) return;
    const res  = await fetch(`${SERVER_URL}/api/portfolio-manager`, {
      method: "POST", headers: auth(), body: JSON.stringify(newPort),
    });
    const data = await res.json() as { ok: boolean };
    if (data.ok) { setShowCreate(false); setNewPort({ name: "", description: "", riskPreset: "balanced", totalCapitalUsdt: 1000 }); void load(); }
  };

  const deletePortfolio = async (id: string) => {
    await fetch(`${SERVER_URL}/api/portfolio-manager/${id}`, { method: "DELETE", headers: auth() });
    if (selected?.id === id) setSelected(null);
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">💼 Portfolio Manager</h2>
          <p className="text-xs text-gray-400 mt-0.5">Multiple portfolios with Conservative / Balanced / Aggressive presets</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="text-xs px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30">+ New</button>
          <button onClick={() => void load()} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">{loading ? "…" : "↻"}</button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-900 border border-cyan-500/30 rounded-xl p-4 space-y-3">
          <p className="text-sm font-bold text-white">New Portfolio</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Name</label>
              <input value={newPort.name} onChange={(e) => setNewPort((p) => ({ ...p, name: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" placeholder="My Portfolio" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Preset</label>
              <select value={newPort.riskPreset} onChange={(e) => setNewPort((p) => ({ ...p, riskPreset: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
                {["conservative","balanced","aggressive","custom"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Capital (USDT)</label>
              <input type="number" value={newPort.totalCapitalUsdt} onChange={(e) => setNewPort((p) => ({ ...p, totalCapitalUsdt: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Description</label>
              <input value={newPort.description} onChange={(e) => setNewPort((p) => ({ ...p, description: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void create()} className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-bold rounded-lg">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {/* Portfolio cards */}
      <div className="space-y-3">
        {summaries.map((p) => (
          <div key={p.id} className={`bg-gray-900 border rounded-xl overflow-hidden transition-colors ${p.active ? "border-cyan-500/40" : "border-gray-800"}`}>
            <div className="p-4 cursor-pointer" onClick={() => void loadDetail(p.id)}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{PRESET_ICONS[p.riskPreset] ?? "📊"}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{p.name}</span>
                      {p.active && <span className="text-xs px-1.5 py-0.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-full font-bold">ACTIVE</span>}
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${PRESET_STYLES[p.riskPreset] ?? ""}`}>
                        {p.riskPreset.charAt(0).toUpperCase() + p.riskPreset.slice(1)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">{p.strategyCount} strategies · ${p.totalCapitalUsdt.toLocaleString()} USDT</p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {!p.active && (
                    <button onClick={(e) => { e.stopPropagation(); void activate(p.id); }}
                      className="text-xs px-2 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30">
                      Activate
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); void deletePortfolio(p.id); }}
                    className="text-xs px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20">
                    Delete
                  </button>
                </div>
              </div>
            </div>

            {selected?.id === p.id && (
              <div className="border-t border-gray-800 p-4 space-y-4">
                {/* Risk limits */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Max Daily Loss", value: `${selected.maxDailyLossPct}%` },
                    { label: "Max Drawdown",   value: `${selected.maxDrawdownPct}%` },
                    { label: "Max Open Trades",value: selected.maxOpenTrades },
                  ].map((m) => (
                    <div key={m.label} className="bg-gray-800 rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-400">{m.label}</p>
                      <p className="text-sm font-bold text-white">{m.value}</p>
                    </div>
                  ))}
                </div>

                {/* Preset switcher */}
                <div>
                  <p className="text-xs text-gray-400 mb-2">Switch Preset</p>
                  <div className="flex flex-wrap gap-2">
                    {["conservative","balanced","aggressive","custom"].map((preset) => (
                      <button key={preset} onClick={() => void applyPreset(p.id, preset)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${selected.riskPreset === preset ? PRESET_STYLES[preset] : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"}`}>
                        {PRESET_ICONS[preset]} {preset.charAt(0).toUpperCase() + preset.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Allocations */}
                <div>
                  <p className="text-xs text-gray-400 mb-2">Strategy Allocations</p>
                  <div className="space-y-2">
                    {selected.allocations.map((a) => (
                      <div key={a.strategyId} className={`flex items-center gap-3 ${!a.enabled ? "opacity-40" : ""}`}>
                        <span className="text-xs w-20 text-gray-300">{a.strategyName}</span>
                        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${a.allocationPct}%` }} />
                        </div>
                        <span className="text-xs text-cyan-400 w-10 text-right">{a.allocationPct}%</span>
                        <span className="text-xs text-gray-500 w-16">max {a.maxPositionPct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
