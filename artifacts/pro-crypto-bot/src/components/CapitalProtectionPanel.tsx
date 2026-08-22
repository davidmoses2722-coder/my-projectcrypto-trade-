import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";

interface ProtectionStatus {
  level:              string;
  equityDropPct:      number;
  currentEquity:      number;
  peakEquity:         number;
  dailyLossPct:       number;
  weeklyLossPct:      number;
  monthlyLossPct:     number;
  tradingAllowed:     boolean;
  liveAllowed:        boolean;
  reason:             string;
  alerts:             string[];
  lastChecked:        string;
  dailyStartEquity:   number;
  weeklyStartEquity:  number;
  monthlyStartEquity: number;
}

interface ProtectionConfig {
  peakEquity:           number;
  dailyLossLimitPct:    number;
  weeklyLossLimitPct:   number;
  monthlyLossLimitPct:  number;
  emergencyKillSwitch:  boolean;
}

const LEVEL_STYLES: Record<string, string> = {
  none:              "text-green-400 bg-green-500/10 border-green-500/30",
  pause:             "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  disable_live:      "text-orange-400 bg-orange-500/10 border-orange-500/30",
  emergency_shutdown: "text-red-400 bg-red-500/10 border-red-500/30",
};

function ProgressBar({ value, max, danger, warn }: { value: number; max: number; danger: number; warn: number }) {
  const pct   = Math.min(100, (value / max) * 100);
  const color = pct >= danger ? "bg-red-500" : pct >= warn ? "bg-orange-400" : "bg-green-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs w-12 text-right text-gray-300">{value.toFixed(1)}%</span>
    </div>
  );
}

export function CapitalProtectionPanel() {
  const [status, setStatus] = useState<ProtectionStatus | null>(null);
  const [config, setConfig] = useState<ProtectionConfig | null>(null);
  const [testEquity, setTestEquity] = useState("");
  const [loading, setLoading] = useState(false);

  const authHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("pcb_jwt") ?? ""}` });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`${SERVER_URL}/api/capital-protection/status`, { headers: authHeaders() }),
        fetch(`${SERVER_URL}/api/capital-protection/config`,  { headers: authHeaders() }),
      ]);
      const [s, c] = await Promise.all([sRes.json(), cRes.json()]) as [{ ok: boolean; data?: ProtectionStatus }, { ok: boolean; data?: ProtectionConfig }];
      if (s.ok && s.data) setStatus(s.data);
      if (c.ok && c.data) setConfig(c.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); const id = setInterval(() => void load(), 10_000); return () => clearInterval(id); }, [load]);

  const evaluateEquity = async () => {
    const eq = parseFloat(testEquity);
    if (isNaN(eq)) return;
    const res = await fetch(`${SERVER_URL}/api/capital-protection/evaluate`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ equity: eq }),
    });
    const d = await res.json() as { ok: boolean; data?: ProtectionStatus };
    if (d.ok && d.data) setStatus(d.data);
  };

  const triggerEmergency = async (action: "trigger" | "reset") => {
    await fetch(`${SERVER_URL}/api/capital-protection/emergency`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ action }),
    });
    void load();
  };

  const updateConfig = async (patch: Partial<ProtectionConfig>) => {
    const res = await fetch(`${SERVER_URL}/api/capital-protection/config`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify(patch),
    });
    const d = await res.json() as { ok: boolean; data?: ProtectionConfig };
    if (d.ok && d.data) setConfig(d.data);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">🛡️ Capital Protection Layer</h2>
          <p className="text-xs text-gray-400 mt-0.5">Multi-level equity stops and emergency kill switch</p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25">
          {loading ? "…" : "↻"}
        </button>
      </div>

      {status && (
        <>
          {/* Protection level badge */}
          <div className={`rounded-xl p-4 border ${LEVEL_STYLES[status.level] ?? LEVEL_STYLES["none"]}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{status.level === "none" ? "✅" : status.level === "pause" ? "⏸️" : status.level === "disable_live" ? "⚠️" : "⛔"}</span>
                <span className="font-bold text-sm uppercase tracking-wide">
                  {status.level === "none" ? "Protected — All Clear" :
                   status.level === "pause" ? "Trading Paused" :
                   status.level === "disable_live" ? "Live Trading Disabled" :
                   "Emergency Shutdown"}
                </span>
              </div>
              <div className="flex gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full font-medium ${status.tradingAllowed ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                  Trading: {status.tradingAllowed ? "ON" : "OFF"}
                </span>
                <span className={`px-2 py-0.5 rounded-full font-medium ${status.liveAllowed ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                  Live: {status.liveAllowed ? "ON" : "OFF"}
                </span>
              </div>
            </div>
            <p className="text-xs opacity-80">{status.reason}</p>
          </div>

          {/* Alerts */}
          {status.alerts.length > 0 && (
            <div className="space-y-2">
              {status.alerts.map((a, i) => (
                <div key={i} className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-300">{a}</div>
              ))}
            </div>
          )}

          {/* Equity levels */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <span className="text-sm font-semibold text-white">Equity Levels</span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Peak Equity</p>
                <p className="text-sm font-bold text-white">${status.peakEquity.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Current Equity</p>
                <p className={`text-sm font-bold ${status.currentEquity >= status.peakEquity ? "text-green-400" : "text-red-400"}`}>
                  ${status.currentEquity.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="space-y-2.5">
              {[
                { label: "Equity Drop from Peak", value: status.equityDropPct, warn: 7, danger: 10 },
                { label: "Daily Loss",             value: status.dailyLossPct,  warn: 3, danger: config?.dailyLossLimitPct ?? 5 },
                { label: "Weekly Loss",            value: status.weeklyLossPct, warn: 6, danger: config?.weeklyLossLimitPct ?? 10 },
                { label: "Monthly Loss",           value: status.monthlyLossPct,warn: 12, danger: config?.monthlyLossLimitPct ?? 20 },
              ].map((m) => (
                <div key={m.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">{m.label}</span>
                  </div>
                  <ProgressBar value={m.value} max={m.danger * 1.5} danger={(m.danger / (m.danger * 1.5)) * 100} warn={(m.warn / (m.danger * 1.5)) * 100} />
                </div>
              ))}
            </div>
          </div>

          {/* Test equity */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-sm font-semibold text-white mb-3">Test Equity Level</p>
            <div className="flex gap-2">
              <input type="number" value={testEquity} onChange={(e) => setTestEquity(e.target.value)} placeholder="e.g. 900"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              <button onClick={() => void evaluateEquity()} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg font-medium">
                Evaluate
              </button>
            </div>
          </div>

          {/* Emergency controls */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-sm font-semibold text-white mb-3">Emergency Controls</p>
            <div className="flex gap-3">
              <button onClick={() => void triggerEmergency("trigger")}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-lg transition-colors">
                ⛔ Trigger Kill Switch
              </button>
              <button onClick={() => void triggerEmergency("reset")}
                className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg transition-colors">
                ✅ Reset Kill Switch
              </button>
            </div>
          </div>
        </>
      )}

      {/* Config */}
      {config && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-sm font-semibold text-white mb-3">Loss Limits Configuration</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Daily Limit %", key: "dailyLossLimitPct",   val: config.dailyLossLimitPct },
              { label: "Weekly Limit %", key: "weeklyLossLimitPct",  val: config.weeklyLossLimitPct },
              { label: "Monthly Limit %", key: "monthlyLossLimitPct", val: config.monthlyLossLimitPct },
            ].map((f) => (
              <div key={f.key}>
                <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
                <input type="number" defaultValue={f.val} min={0.5} max={50} step={0.5}
                  onBlur={(e) => void updateConfig({ [f.key]: parseFloat(e.target.value) })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
