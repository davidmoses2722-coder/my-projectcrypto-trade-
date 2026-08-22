import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";

interface CorrelationPair { symbolA: string; symbolB: string; correlation: number; strength: string; }
interface CorrelationMatrix { symbols: string[]; pairs: CorrelationPair[]; computedAt: string; }
interface CorrelationDecision { symbol: string; openPositions: string[]; pairs: CorrelationPair[]; maxCorrelation: number; action: "allow" | "reduce" | "block"; sizingFactor: number; reason: string; }

const STRENGTH_STYLES: Record<string, string> = {
  extreme:  "text-red-400",
  strong:   "text-orange-400",
  moderate: "text-yellow-400",
  weak:     "text-blue-400",
  none:     "text-gray-500",
};

const ACTION_STYLES: Record<string, string> = {
  allow:  "text-green-400 bg-green-500/10 border-green-500/30",
  reduce: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  block:  "text-red-400 bg-red-500/10 border-red-500/30",
};

const COMMON_SYMBOLS = ["BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT","DOGE/USDT","AVAX/USDT","MATIC/USDT","LINK/USDT"];

export function CorrelationRiskPanel() {
  const [matrix,   setMatrix]   = useState<CorrelationMatrix | null>(null);
  const [decision, setDecision] = useState<CorrelationDecision | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [checkSym, setCheckSym] = useState("SOL/USDT");
  const [openPos,  setOpenPos]  = useState("BTC/USDT,ETH/USDT");

  const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("pcb_jwt") ?? ""}` });

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${SERVER_URL}/api/correlation-risk/matrix`, {
        method: "POST", headers: auth(),
        body: JSON.stringify({ symbols: COMMON_SYMBOLS }),
      });
      const data = await res.json() as { ok: boolean; data?: CorrelationMatrix };
      if (data.ok && data.data) setMatrix(data.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void loadMatrix();
    const id = setInterval(() => void loadMatrix(), 30_000);
    return () => clearInterval(id);
  }, [loadMatrix]);

  const checkEntry = async () => {
    const openPositions = openPos.split(",").map((s) => s.trim()).filter(Boolean);
    const res  = await fetch(`${SERVER_URL}/api/correlation-risk/check`, {
      method: "POST", headers: auth(),
      body: JSON.stringify({ symbol: checkSym, openPositions }),
    });
    const data = await res.json() as { ok: boolean; data?: CorrelationDecision };
    if (data.ok && data.data) setDecision(data.data);
  };

  const getCorrelationColor = (r: number) => {
    const abs = Math.abs(r);
    if (abs >= 0.85) return "text-red-400 bg-red-900/30";
    if (abs >= 0.70) return "text-orange-400 bg-orange-900/20";
    if (abs >= 0.50) return "text-yellow-400 bg-yellow-900/20";
    if (abs >= 0.30) return "text-blue-400 bg-blue-900/20";
    return "text-gray-500";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">🔗 Correlation Risk Engine</h2>
          <p className="text-xs text-gray-400 mt-0.5">Prevent highly correlated position stacking (BTC+ETH+SOL)</p>
        </div>
        <button onClick={() => void loadMatrix()} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
          {loading ? "Loading…" : "↻ Load Matrix"}
        </button>
      </div>

      {/* Entry checker */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-white">Check Entry Correlation</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">New Symbol</label>
            <select value={checkSym} onChange={(e) => setCheckSym(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
              {COMMON_SYMBOLS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Open Positions (comma separated)</label>
            <input value={openPos} onChange={(e) => setOpenPos(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" />
          </div>
        </div>
        <button onClick={() => void checkEntry()} className="w-full py-2 bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-bold rounded-lg">
          Check Correlation
        </button>

        {decision && (
          <div className={`rounded-xl p-4 border ${ACTION_STYLES[decision.action]}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm uppercase">
                {decision.action === "allow" ? "✅ ALLOW" : decision.action === "reduce" ? "⚠️ REDUCE SIZE" : "🚫 BLOCK ENTRY"}
              </span>
              {decision.action === "reduce" && (
                <span className="text-xs font-bold">Size factor: {(decision.sizingFactor * 100).toFixed(0)}%</span>
              )}
            </div>
            <p className="text-xs opacity-80">{decision.reason}</p>
            {decision.pairs.length > 0 && (
              <div className="mt-2 space-y-1">
                {decision.pairs.map((p) => (
                  <div key={p.symbolB} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{p.symbolB}</span>
                    <span className={STRENGTH_STYLES[p.strength]}>{(p.correlation * 100).toFixed(1)}% ({p.strength})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Correlation matrix */}
      {matrix && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <span className="text-sm font-semibold text-white">Correlation Matrix</span>
            <span className="text-xs text-gray-500 ml-2">Static baseline (based on known correlation groups)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="px-3 py-2 text-left uppercase tracking-wider font-sans font-bold">Symbol A</th>
                  <th className="px-3 py-2 text-left uppercase tracking-wider font-sans font-bold">Symbol B</th>
                  <th className="px-3 py-2 text-right uppercase tracking-wider font-sans font-bold">Correlation</th>
                  <th className="px-3 py-2 text-center uppercase tracking-wider font-sans font-bold">Strength</th>
                </tr>
              </thead>
              <tbody>
                {matrix.pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)).map((p, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-2 font-medium text-white">{p.symbolA}</td>
                    <td className="px-3 py-2 font-medium text-white">{p.symbolB}</td>
                    <td className={`px-3 py-2 text-right font-bold ${getCorrelationColor(p.correlation)}`}>
                      {(p.correlation >= 0 ? "+" : "")}{(p.correlation * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-center font-medium">
                      <span className={`text-xs font-bold capitalize ${STRENGTH_STYLES[p.strength]}`}>{p.strength}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!matrix && !loading && (
        <div className="text-center py-8 text-gray-500 text-sm">Click "Load Matrix" to view pairwise correlations</div>
      )}
    </div>
  );
}
