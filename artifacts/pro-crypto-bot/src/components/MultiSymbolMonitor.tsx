import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";
import { PremiumCard } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";
import { Search, Play, Square, AlertTriangle, Activity, CheckCircle2, XCircle } from "lucide-react";
import { motion } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScanResult {
  symbol:           string;
  price:            number;
  signal:           "BUY" | "SELL" | "HOLD" | null;
  confidence:       number;
  canTrade:         boolean;
  blockReason:      string | null;
  portfolioAllowed: boolean;
  portfolioReason:  string | null;
  riskAllowed:      boolean;
  riskReason:       string | null;
  enqueued:         boolean;
  lastScannedAt:    number;
  error:            string | null;
}

interface ScannerStatus {
  running:    boolean;
  scanCount:  number;
  intervalMs: number;
  symbols:    string[];
  results:    ScanResult[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const jwt = localStorage.getItem("pcb_jwt");
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

function signalColor(signal: string | null, canTrade: boolean): string {
  if (!signal) return "text-slate-500";
  if (signal === "BUY"  && canTrade)  return "text-green-400 font-bold";
  if (signal === "BUY"  && !canTrade) return "text-green-600";
  if (signal === "SELL")              return "text-red-400";
  return "text-slate-400";
}

function signalBadgeCls(signal: string | null, canTrade: boolean): string {
  if (!signal) return "bg-slate-700/50 text-slate-500 border-gray-600/30";
  if (signal === "BUY" && canTrade) return "bg-green-500/20 text-green-400 border-green-500/40";
  if (signal === "BUY")             return "bg-green-900/30 text-green-700 border-green-800/40";
  if (signal === "SELL")            return "bg-red-500/20 text-red-400 border-red-500/40";
  return "bg-slate-700/50 text-slate-400 border-gray-600/30";
}

function priceFmt(price: number, symbol: string): string {
  if (price <= 0) return "—";
  const decimals = symbol.startsWith("DOGE") || symbol.startsWith("XRP") ? 5
                 : symbol.startsWith("SOL")                              ? 2
                 : symbol.startsWith("BNB")                              ? 2
                 : 2;
  return price.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function symbolDisplay(sym: string): string {
  const m = sym.match(/^([A-Z]+)(USDT|USDC|BTC)$/);
  if (!m) return sym;
  return `${m[1]}/${m[2]}`;
}

const EMOJI: Record<string, string> = {
  BTCUSDT: "₿", ETHUSDT: "Ξ", SOLUSDT: "◎",
  XRPUSDT: "✕", DOGEUSDT: "Ð", BNBUSDT: "B",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function MultiSymbolMonitor({ disabled }: { disabled?: boolean }) {
  const [status, setStatus]       = useState<ScannerStatus | null>(null);
  const [loading, setLoading]     = useState(false);
  const [toggling, setToggling]   = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/scanner/status`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as ScannerStatus;
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach scanner API");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void fetchStatus().finally(() => setLoading(false));
    const id = setInterval(() => { void fetchStatus(); }, 5_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const toggleScanner = async () => {
    if (toggling || disabled) return;
    setToggling(true);
    try {
      const action = status?.running ? "stop" : "start";
      const res = await fetch(`${SERVER_URL}/api/scanner/${action}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setToggling(false);
    }
  };

  const results = status?.results ?? [];
  const buyCount = results.filter((r) => r.signal === "BUY" && r.canTrade).length;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Header + controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white font-bold flex items-center gap-2">
            <Search size={20} className="text-cyan-400" /> Multi-Symbol Scanner
            {status?.running && (
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
            )}
          </h3>
          <p className="text-slate-500 text-xs mt-0.5">
            Scans {status?.symbols?.length ?? 6} pairs every{" "}
            {status ? `${(status.intervalMs / 1000).toFixed(0)}s` : "30s"} · routes BUY signals
            through risk &amp; portfolio guards
          </p>
        </div>

        <div className="flex items-center gap-2">
          {status && (
            <span className="text-xs text-slate-600">
              Scan #{status.scanCount}
            </span>
          )}
          {buyCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/40 animate-pulse">
              {buyCount} BUY
            </span>
          )}
          <button
            onClick={toggleScanner}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-all shadow-lg disabled:opacity-50 ${status?.running ? "bg-rose-500/20 text-rose-400 border border-rose-500/50 hover:bg-rose-500/30" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/30"}`}
            //
            disabled={toggling || disabled || loading}
            
          >
            {toggling ? "…" : status?.running ? "<Square size={16} /> Stop Scanner" : "<Play size={16} /> Start Scanner"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-red-400 text-xs">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Scanner not started info */}
      {!status?.running && !loading && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-slate-400 text-sm">Scanner is stopped.</p>
          <p className="text-slate-600 text-xs mt-1">
            Click <span className="text-green-400 font-bold"><Play size={16} /> Start Scanner</span> to begin
            scanning all 6 pairs with the active strategy.
          </p>
        </div>
      )}

      {/* Results table */}
      {results.length > 0 && (
        <PremiumCard className="overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-white/5 bg-slate-800/60">
                <th className="text-left px-3 py-2.5 font-semibold uppercase tracking-wider font-sans font-bold">Pair</th>
                <th className="text-right px-3 py-2.5 font-semibold uppercase tracking-wider font-sans font-bold">Price</th>
                <th className="text-center px-3 py-2.5 font-semibold uppercase tracking-wider font-sans font-bold">Signal</th>
                <th className="text-right px-3 py-2.5 font-semibold hidden sm:table-cell uppercase tracking-wider font-sans font-bold">Conf.</th>
                <th className="text-center px-3 py-2.5 font-semibold hidden md:table-cell uppercase tracking-wider font-sans font-bold">Portfolio</th>
                <th className="text-center px-3 py-2.5 font-semibold hidden md:table-cell uppercase tracking-wider font-sans font-bold">Risk</th>
                <th className="text-center px-3 py-2.5 font-semibold uppercase tracking-wider font-sans font-bold">Status</th>
                <th className="text-right px-3 py-2.5 font-semibold hidden sm:table-cell uppercase tracking-wider font-sans font-bold">Scanned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {results.map((r) => (
                <tr
                  key={r.symbol}
                  className={`hover:bg-slate-800/30 transition-colors ${
                    r.signal === "BUY" && r.canTrade ? "bg-green-950/20" : ""
                  }`}
                >
                  {/* Pair */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base leading-none">{EMOJI[r.symbol] ?? "•"}</span>
                      <span className="text-white font-semibold">
                        {symbolDisplay(r.symbol)}
                      </span>
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-3 py-2.5 text-right text-gray-300">
                    {r.error ? (
                      <span className="text-red-500 text-xs">ERR</span>
                    ) : (
                      <span>${priceFmt(r.price, r.symbol)}</span>
                    )}
                  </td>

                  {/* Signal badge */}
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full border text-xs ${
                        signalBadgeCls(r.signal, r.canTrade)
                      }`}
                    >
                      {r.signal ?? "—"}
                    </span>
                  </td>

                  {/* Confidence */}
                  <td className="px-3 py-2.5 text-right hidden sm:table-cell">
                    {r.signal ? (
                      <span className={signalColor(r.signal, r.canTrade)}>
                        {r.confidence.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>

                  {/* Portfolio */}
                  <td className="px-3 py-2.5 text-center hidden md:table-cell">
                    {r.portfolioAllowed ? (
                      <span className="text-green-500 text-xs">✓</span>
                    ) : (
                      <span
                        className="text-red-500 text-xs"
                        title={r.portfolioReason ?? "Blocked"}
                      >
                        ✗
                      </span>
                    )}
                  </td>

                  {/* Risk */}
                  <td className="px-3 py-2.5 text-center hidden md:table-cell">
                    {r.riskAllowed ? (
                      <span className="text-green-500 text-xs">✓</span>
                    ) : (
                      <span
                        className="text-red-500 text-xs"
                        title={r.riskReason ?? "Blocked"}
                      >
                        ✗
                      </span>
                    )}
                  </td>

                  {/* Status pill */}
                  <td className="px-3 py-2.5 text-center">
                    {r.error ? (
                      <span
                        className="px-1.5 py-0.5 rounded text-xs bg-red-900/40 text-red-400 border border-red-800/40"
                        title={r.error}
                      >
                        ERROR
                      </span>
                    ) : r.enqueued ? (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse">
                        QUEUED
                      </span>
                    ) : r.signal === "BUY" && r.canTrade && !r.portfolioAllowed ? (
                      <span
                        className="px-1.5 py-0.5 rounded text-xs bg-yellow-900/30 text-yellow-600 border border-yellow-800/30"
                        title={r.portfolioReason ?? ""}
                      >
                        PORTFOLIO
                      </span>
                    ) : r.signal === "BUY" && r.canTrade && !r.riskAllowed ? (
                      <span
                        className="px-1.5 py-0.5 rounded text-xs bg-orange-900/30 text-orange-600 border border-orange-800/30"
                        title={r.riskReason ?? ""}
                      >
                        RISK BLOCK
                      </span>
                    ) : r.signal === "BUY" && !r.canTrade ? (
                      <span
                        className="px-1.5 py-0.5 rounded text-xs bg-slate-700/50 text-slate-500 border border-gray-600/30"
                        title={r.blockReason ?? ""}
                      >
                        STRATEGY
                      </span>
                    ) : r.lastScannedAt > 0 ? (
                      <span className="text-slate-600 text-xs">OK</span>
                    ) : (
                      <span className="text-slate-700 text-xs">—</span>
                    )}
                  </td>

                  {/* Last scanned */}
                  <td className="px-3 py-2.5 text-right text-slate-600 hidden sm:table-cell text-xs">
                    {r.lastScannedAt > 0
                      ? new Date(r.lastScannedAt).toLocaleTimeString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PremiumCard>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span><span className="text-green-400 font-bold">BUY (solid)</span> — strategy + canTrade flag both set</span>
        <span><span className="text-green-700">BUY (dim)</span> — strategy BUY but canTrade=false</span>
        <span>Portfolio ✓/✗ — exposure &amp; position limits</span>
        <span>Risk ✓/✗ — advanced risk engine gate</span>
        <span><span className="text-green-400">QUEUED</span> — trade enqueued via BullMQ</span>
      </div>
    </motion.div>
  );
}
