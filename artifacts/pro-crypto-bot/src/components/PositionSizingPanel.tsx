import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.BASE_URL?.replace(/\/$/, "") + "/api";

type RiskProfile = "low" | "medium" | "high" | "custom";

const PROFILE_LABELS: Record<RiskProfile, string> = {
  low:    "Low (0.5%)",
  medium: "Medium (1%)",
  high:   "High (2%)",
  custom: "Custom",
};

const CUSTOM_OPTIONS = [
  { label: "0.25%", value: 0.0025 },
  { label: "0.5%",  value: 0.005  },
  { label: "1%",    value: 0.010  },
  { label: "2%",    value: 0.020  },
  { label: "3%",    value: 0.030  },
];

interface StatusPayload {
  ok:             boolean;
  balance:        number;
  riskPercent:    number;
  riskAmount:     number;
  positionSize:   number;
  maxLoss:        number;
  exposurePercent:number;
  profile:        RiskProfile;
  customPct:      number;
  customValues:   number[];
  lastBalanceAt:  number;
  liveExample: {
    positionSize:  number;
    qty:           number;
    riskAmount:    number;
    maxLoss:       number;
    exposurePct:   number;
    stopLossDist:  number;
    atrAdjusted:   boolean;
    cappedTo:      string | null;
  } | null;
}

interface VerifyRow {
  symbol:     string;
  strategy:   string;
  entryPrice: number;
  slPct:      number;
  atr:        number | null;
  riskPct:    number;
  riskAmount: number;
  posSize:    number;
  riskConst:  boolean;
}

interface VerifyPayload {
  ok:         boolean;
  assertions: {
    riskRemainsConstant:    boolean;
    atrAdjustedSizesDiffer: boolean;
    allStrategiesTested:    boolean;
    allSymbolsTested:       boolean;
  };
  summary: { totalCases: number; strategies: string[]; symbols: string[] };
  rows:    VerifyRow[];
}

function fmt(n: number, dec = 2): string {
  return isFinite(n) ? n.toFixed(dec) : "—";
}
function pct(n: number): string {
  return isFinite(n) ? (n * 100).toFixed(2) + "%" : "—";
}

export default function PositionSizingPanel() {
  const [status,      setStatus]      = useState<StatusPayload | null>(null);
  const [verify,      setVerify]      = useState<VerifyPayload | null>(null);
  const [profile,     setProfile]     = useState<RiskProfile>("medium");
  const [customPct,   setCustomPct]   = useState(0.010);
  const [saving,      setSaving]      = useState(false);
  const [showVerify,  setShowVerify]  = useState(false);
  const [loadingVer,  setLoadingVer]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const jwt = () => localStorage.getItem("pcb_jwt") ?? "";

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/position-sizing/status`, {
        headers: { Authorization: `Bearer ${jwt()}` },
      });
      if (!r.ok) { setError(`Status ${r.status}`); return; }
      const data = await r.json() as StatusPayload;
      setStatus(data);
      setProfile(data.profile);
      setCustomPct(data.customPct);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const id = setInterval(() => { void fetchStatus(); }, 5_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { profile };
      if (profile === "custom") body.customPct = customPct;
      const r = await fetch(`${API}/position-sizing/profile`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await r.json() as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "Failed to update profile");
      else          await fetchStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const runVerify = async () => {
    setLoadingVer(true);
    setShowVerify(true);
    try {
      const r = await fetch(`${API}/position-sizing/verify`, {
        headers: { Authorization: `Bearer ${jwt()}` },
      });
      const data = await r.json() as VerifyPayload;
      setVerify(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingVer(false);
    }
  };

  const live = status?.liveExample;

  return (
    <div className="space-y-4 p-2">
      {error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* ── Formula card ──────────────────────────────────────────── */}
      <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-3">
        <p className="text-[13px] font-bold font-semibold text-gray-400 uppercase tracking-wide mb-2">Sizing Formula</p>
        <code className="block text-xs text-orange-300 whitespace-pre">
          {"riskAmount   = balance × riskPercent\npositionSize = riskAmount ÷ |entry − stopLoss|"}
        </code>
        <p className="mt-1 text-xs text-gray-500">
          ATR ≠ null → stopLossDist = max(price×slPct, ATR) — wider stop = smaller position = constant $ risk.
        </p>
      </div>

      {/* ── Live snapshot ──────────────────────────────────────────── */}
      <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-3">
        <p className="text-[13px] font-bold font-semibold text-gray-400 uppercase tracking-wide mb-3">Live Snapshot</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <MetricRow label="Account Balance"  value={status ? `$${fmt(status.balance)}` : "—"} />
          <MetricRow label="Risk Profile"     value={status ? PROFILE_LABELS[status.profile] : "—"} />
          <MetricRow label="Risk %"           value={status ? pct(status.riskPercent) : "—"} highlight />
          <MetricRow label="Risk Amount"      value={status ? `$${fmt(status.riskAmount)}` : "—"} highlight />
          <MetricRow label="Position Size"    value={live ? `$${fmt(live.positionSize)}` : (status ? `$${fmt(status.positionSize)}` : "—")} accent />
          <MetricRow label="Qty"              value={live ? fmt(live.qty, 6) : "—"} />
          <MetricRow label="Exposure"         value={live ? pct(live.exposurePct) : "—"} />
          <MetricRow label="Est. Max Loss"    value={live ? `$${fmt(live.maxLoss)}` : (status ? `$${fmt(status.maxLoss)}` : "—")} warn />
          {live?.atrAdjusted && (
            <div className="col-span-2 rounded bg-blue-500/10 border border-blue-500/20 px-2 py-1 text-xs text-blue-300">
              ⚡ ATR-adjusted — stop distance widened from config SL to ATR
            </div>
          )}
          {live?.cappedTo && (
            <div className="col-span-2 rounded bg-yellow-500/10 border border-yellow-500/20 px-2 py-1 text-xs text-yellow-300">
              🔒 Size capped to {live.cappedTo}
            </div>
          )}
        </div>
      </div>

      {/* ── Profile selector ──────────────────────────────────────── */}
      <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-3">
        <p className="text-[13px] font-bold font-semibold text-gray-400 uppercase tracking-wide mb-3">Risk Profile</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {(["low", "medium", "high", "custom"] as RiskProfile[]).map((p) => (
            <button
              key={p}
              onClick={() => setProfile(p)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                profile === p
                  ? p === "low"    ? "bg-green-600 text-white"
                  : p === "medium" ? "bg-orange-500 text-white"
                  : p === "high"   ? "bg-red-600 text-white"
                  :                  "bg-purple-600 text-white"
                  : "bg-gray-700 text-gray-400 hover:bg-gray-600"
              }`}
            >
              {PROFILE_LABELS[p]}
            </button>
          ))}
        </div>

        {profile === "custom" && (
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">Custom risk %</p>
            <div className="flex flex-wrap gap-1.5">
              {CUSTOM_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setCustomPct(o.value)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    customPct === o.value
                      ? "bg-purple-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => { void saveProfile(); }}
          disabled={saving}
          className="px-4 py-1.5 rounded bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? "Saving…" : "Apply Profile"}
        </button>
      </div>

      {/* ── Verification ──────────────────────────────────────────── */}
      <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-bold font-semibold text-gray-400 uppercase tracking-wide">Verification Matrix</p>
          <button
            onClick={() => { void runVerify(); }}
            disabled={loadingVer}
            className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 disabled:opacity-50 transition-colors"
          >
            {loadingVer ? "Running…" : "Run Tests"}
          </button>
        </div>

        {verify && (
          <div className="space-y-2">
            {/* assertion badges */}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(verify.assertions).map(([k, v]) => (
                <span
                  key={k}
                  className={`px-2 py-0.5 rounded text-xs ${v ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}
                >
                  {v ? "✓" : "✗"} {k}
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              {verify.summary.totalCases} cases · {verify.summary.strategies.length} strategies · {verify.summary.symbols.length} symbols
            </p>

            {showVerify && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded border border-gray-700">
                <table className="w-full text-xs">
                  <thead className="bg-gray-900 sticky top-0 uppercase tracking-wider font-sans font-bold">
                    <tr>
                      {["Symbol","Strategy","Price","SL%","ATR","Risk%","RiskAmt","PosSize","RiskConst"].map((h) => (
                        <th key={h} className="px-1.5 py-1 text-left text-gray-500 whitespace-nowrap uppercase tracking-wider font-sans font-bold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {verify.rows.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-gray-800/40" : ""}>
                        <td className="px-1.5 py-0.5 text-gray-300">{row.symbol.replace("USDT","")}</td>
                        <td className="px-1.5 py-0.5 text-gray-400">{row.strategy}</td>
                        <td className="px-1.5 py-0.5 text-gray-400">{row.entryPrice >= 1000 ? (row.entryPrice/1000).toFixed(1)+"k" : row.entryPrice.toFixed(2)}</td>
                        <td className="px-1.5 py-0.5 text-gray-400">{(row.slPct*100).toFixed(1)}%</td>
                        <td className="px-1.5 py-0.5 text-gray-400">{row.atr ? row.atr.toFixed(2) : "—"}</td>
                        <td className="px-1.5 py-0.5 text-orange-300">{(row.riskPct*100).toFixed(2)}%</td>
                        <td className="px-1.5 py-0.5 text-yellow-300">${row.riskAmount.toFixed(2)}</td>
                        <td className="px-1.5 py-0.5 text-green-300">${row.posSize.toFixed(2)}</td>
                        <td className={`px-1.5 py-0.5 font-bold ${row.riskConst ? "text-green-400" : "text-red-400"}`}>
                          {row.riskConst ? "✓" : "✗"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  highlight,
  accent,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  accent?: boolean;
  warn?: boolean;
}) {
  const cls = accent
    ? "text-orange-400 font-semibold"
    : highlight
    ? "text-white"
    : warn
    ? "text-red-400"
    : "text-gray-300";

  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm ${cls}`}>{value}</p>
    </div>
  );
}
