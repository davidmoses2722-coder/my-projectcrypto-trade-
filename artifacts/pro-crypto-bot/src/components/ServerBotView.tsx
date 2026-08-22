/**
 * ServerBotView v5.0 — Simulation DISABLED
 * - NO dry run, NO simulation fallback
 * - Keys valid → 🟢 LIVE TRADING
 * - Keys missing → 🔴 NO KEYS (cannot start)
 * - Validate & Save → tests keys against real Binance BEFORE saving
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

function useSecondsAgo(ts: number | undefined): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!ts || ts === 0) return "never";
  const s = Math.floor((now - ts) / 1000);
  if (s < 5)    return "just now";
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
import { useBotServer } from "../hooks/useBotServer";
import { SERVER_URL, displayUrl, isServerRemote } from "../config/urls";
import RiskPanel from "./RiskPanel";
import AdvancedRiskPanel from "./AdvancedRiskPanel";
import ServerAnalyticsDashboard from "./ServerAnalyticsDashboard";
import OrchestratorDashboard from "./OrchestratorDashboard";
import MultiSymbolMonitor from "./MultiSymbolMonitor";
import PositionSizingPanel   from "./PositionSizingPanel";
import TelegramPanel         from "./TelegramPanel";
import TradingParamsPanel    from "./TradingParamsPanel";

type ExchangeOption = {
  id: "binance" | "bybit" | "okx";
  label: string;
  needsPassphrase: boolean;
  notes?: string;
  hasKeys: boolean;
  apiKeyMask: string;
};

function useExchanges() {
  const [list, setList]     = useState<ExchangeOption[]>([]);
  const [active, setActive] = useState<"binance" | "bybit" | "okx">("gateio" as any);
  const [busy, setBusy]     = useState(false);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("pcb_jwt");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/exchanges`, { headers: getAuthHeaders() });
      const j = await r.json();
      if (j?.ok) {
        setList(j.supported ?? []);
        setActive(j.active ?? "gateio");
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const select = useCallback(async (id: "binance" | "bybit" | "okx") => {
    setBusy(true);
    try {
      await fetch(`${SERVER_URL}/api/exchanges/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ exchange: id }),
      });
      await refresh();
    } finally { setBusy(false); }
  }, [refresh]);

  return { list, active, busy, select, refresh };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [c, setC] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(() => setC(false), 2000); }}
      className="ml-2 px-2 py-0.5 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-300">
      {c ? "✅" : "📋"}
    </button>
  );
}
function Code({ children, lang = "bash" }: { children: string; lang?: string }) {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-700">
      <div className="flex items-center justify-between bg-gray-800 px-3 py-1">
        <span className="text-xs text-gray-500">{lang}</span>
        <CopyBtn text={children} />
      </div>
      <pre className="bg-gray-950 p-4 text-xs text-green-400 overflow-x-auto whitespace-pre-wrap leading-relaxed">{children}</pre>
    </div>
  );
}
function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  const c: Record<string, string> = {
    green:  "bg-green-500/20 text-green-400 border-green-500/40",
    red:    "bg-red-500/20 text-red-400 border-red-500/40",
    yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
    blue:   "bg-blue-500/20 text-blue-400 border-blue-500/40",
    gray:   "bg-gray-700/50 text-gray-400 border-gray-600/30",
    orange: "bg-orange-500/20 text-orange-400 border-orange-500/40",
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/40",
    cyan:   "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs border ${c[color] ?? c.gray}`}>{children}</span>;
}
function StatCard({ label, value, sub, color = "white" }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    green: "text-emerald-400", red: "text-rose-400", yellow: "text-amber-400",
    blue: "text-blue-400", white: "text-slate-50", cyan: "text-cyan-400",
    orange: "text-orange-400", purple: "text-purple-400",
  };
  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 hover:border-slate-600/50 transition-colors">
      <div className="text-[13px] font-bold uppercase tracking-wider tracking-widest text-slate-500 mb-2">{label}</div>
      <div className={`text-2xl font-black ${colors[color] ?? "text-slate-50"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
    </div>
  );
}
function Spinner() {
  return <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin inline-block" />;
}

// ─── Paper Balance Card ───────────────────────────────────────────────────────
function PaperBalanceCard({ status, onReset }: { status: any; onReset: () => Promise<unknown> }) {
  const [resetting, setResetting] = useState(false);
  const [resetMsg,  setResetMsg]  = useState<{ ok: boolean; text: string } | null>(null);

  const handleReset = async () => {
    if (!confirm("Reset virtual balance to $1,000 USDT? This will also clear trade history.")) return;
    setResetting(true);
    const res = await onReset() as any;
    setResetting(false);
    const msg = res?.ok
      ? { ok: true,  text: "✅ Paper balance reset to $1,000 USDT" }
      : { ok: false, text: `❌ ${res?.error ?? "Reset failed"}` };
    setResetMsg(msg);
    setTimeout(() => setResetMsg(null), 5000);
  };

  const balance = status?.balanceUSDT ?? 1000;
  const netPnl  = balance - 1000;
  const roi     = (balance / 1000 - 1) * 100;

  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0">📄</span>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <p className="font-bold text-blue-400 text-sm">Paper Trading Active — No Real Orders</p>
            <button
              onClick={handleReset}
              disabled={resetting || !!status?.position}
              title={status?.position ? "Close position before resetting" : "Reset to $1,000 USDT"}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all
                bg-gray-800/80 border-gray-600/50 text-gray-400 hover:bg-blue-500/20 hover:border-blue-500/40 hover:text-blue-300
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {resetting ? <><Spinner /> Resetting…</> : "🔄 Reset Balance"}
            </button>
          </div>
          <p className="text-gray-400 text-xs leading-relaxed mb-3">
            All trades simulated. Real prices from Gate.io. No exchange orders placed.
            Virtual wallet started at <span className="text-blue-300 font-bold">$1,000 USDT</span>.
          </p>
          {resetMsg && (
            <div className={`mb-3 p-2 rounded-lg text-xs ${
              resetMsg.ok ? "bg-green-500/10 border border-green-500/30 text-green-400"
                          : "bg-red-500/10 border border-red-500/30 text-red-400"
            }`}>
              {resetMsg.text}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
              <div className="text-gray-500 text-xs mb-0.5">Virtual Balance</div>
              <div className="text-blue-300 font-bold">${balance.toFixed(2)}</div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
              <div className="text-gray-500 text-xs mb-0.5">Net PnL</div>
              <div className={`font-bold ${netPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                {netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)}
              </div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
              <div className="text-gray-500 text-xs mb-0.5">ROI</div>
              <div className={`font-bold ${roi >= 0 ? "text-green-400" : "text-red-400"}`}>
                {roi >= 0 ? "+" : ""}{roi.toFixed(2)}%
              </div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
              <div className="text-gray-500 text-xs mb-0.5">Trades</div>
              <div className="text-white font-bold">
                {status?.totalTrades ?? 0}{" "}
                <span className="text-gray-500 font-normal">
                  ({status?.winningTrades ?? 0}W / {status?.losingTrades ?? 0}L)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mode Badge ───────────────────────────────────────────────────────────────
function ModeBadge({ status }: { status: any }) {
  const keysReady = status?.keysReady ?? (status?.hasApiKey && status?.hasSecret);
  const isRunning = status?.isRunning;
  const isPaper   = status?.testMode === true || status?.mode === "PAPER";

  if (isRunning && isPaper) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/20 border border-blue-500/40">
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-blue-400 font-bold text-sm">📄 PAPER TRADING</span>
      </div>
    );
  }
  if (isRunning && keysReady) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/20 border border-green-500/40">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-green-400 font-bold text-sm">🟢 LIVE TRADING</span>
      </div>
    );
  }
  if (!keysReady && !isPaper) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/20 border border-red-500/40">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        <span className="text-red-400 font-bold text-sm">🔴 NO KEYS — Cannot Trade</span>
      </div>
    );
  }
  if (isPaper) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/30">
        <span className="w-2 h-2 rounded-full bg-blue-400" />
        <span className="text-blue-300 font-bold text-sm">📄 PAPER READY</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-500/20 border border-yellow-500/40">
      <span className="w-2 h-2 rounded-full bg-yellow-400" />
      <span className="text-yellow-400 font-bold text-sm">⏸ READY — Keys Configured</span>
    </div>
  );
}

// ─── Server Offline Banner ────────────────────────────────────────────────────
function OfflineBanner({ connection, error }: { connection: string; error: string | null }) {
  if (connection === "connected") return null;
  return (
    <div className={`border rounded-xl p-5 space-y-4 ${
      connection === "connecting"
        ? "bg-yellow-500/10 border-yellow-500/30"
        : "bg-red-500/10 border-red-500/30"
    }`}>
      <div className="flex items-center gap-3">
        {connection === "connecting"
          ? <span className="w-5 h-5 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin shrink-0" />
          : <span className="text-2xl">🔌</span>}
        <div>
          <p className={`font-bold ${connection === "connecting" ? "text-yellow-400" : "text-red-400"}`}>
            {connection === "connecting" ? "Connecting to bot server…" : "Bot server offline"}
          </p>
          <p className="text-gray-400 text-xs mt-0.5">{error ?? `Cannot reach ${SERVER_URL}`}</p>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-3">
        <p className="text-yellow-400 text-xs font-bold mb-1">⚡ Why a backend server is required</p>
        <p className="text-gray-300 text-xs leading-relaxed">
          The browser <span className="text-red-400 font-bold">CANNOT</span> call{" "}
          <code className="text-yellow-400">api.gateio.ws</code> — CORS blocks private endpoints permanently.{" "}
          <span className="text-green-400 font-bold">Node.js has no CORS</span> — calls Gate.io directly with real orders.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-400 mb-1 font-semibold">▶ Start the server:</p>
          <Code lang="bash">{"cd server\nnode bot.js"}</Code>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1 font-semibold">24/7 with PM2:</p>
          <Code lang="bash">{"npm i -g pm2\npm2 start ecosystem.config.cjs\npm2 save && pm2 startup"}</Code>
        </div>
      </div>
    </div>
  );
}

// ─── No-keys warning banner ───────────────────────────────────────────────────
function NoKeysBanner({ status, onGoConfig }: { status: any; onGoConfig: () => void }) {
  const keysReady = status?.keysReady ?? (status?.hasApiKey && status?.hasSecret);
  const isPaper   = status?.testMode === true || status?.mode === "PAPER";
  if (keysReady || isPaper) return null;
  return (
    <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0">❌</span>
        <div className="flex-1">
          <p className="font-bold text-red-400 text-sm">API Keys Not Configured — Bot Cannot Trade</p>
          <p className="text-gray-400 text-xs mt-1">
            The bot requires valid Gate.io API keys to place real orders.
            Simulation mode is <span className="text-red-400 font-bold">permanently disabled</span>.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className={`rounded px-2 py-1 ${status?.hasApiKey ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
              {status?.hasApiKey ? "✅" : "❌"} API Key {status?.apiKeyMask ? `(${status.apiKeyMask})` : "(missing)"}
            </div>
            <div className={`rounded px-2 py-1 ${status?.hasSecret ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
              {status?.hasSecret ? "✅" : "❌"} Secret {status?.secretMask ? `(${status.secretMask})` : "(missing)"}
            </div>
          </div>
        </div>
        <button onClick={onGoConfig}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors">
          ⚙️ Set Keys
        </button>
      </div>
    </div>
  );
}

// ─── Live Signal Panel ────────────────────────────────────────────────────────
function LiveSignalPanel({ status }: { status: any }) {
  const sig       = status?.strategy;
  const tickMs    = status?.config?.tickMs ?? 60_000;
  const updatedAt = status?.lastIndicatorUpdate as number | undefined;
  const candleAt  = status?.lastCandleTime     as number | undefined;
  const indicatorAgo = useSecondsAgo(updatedAt);
  const candleAgo    = useSecondsAgo(candleAt);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const isStale    = updatedAt ? (now - updatedAt) > 2 * tickMs : false;
  const nextInMs   = updatedAt ? Math.max(0, tickMs - (now - updatedAt)) : null;
  const nextInSec  = nextInMs !== null ? Math.ceil(nextInMs / 1000) : null;

  const action = sig?.action ?? "—";
  const actionStyle =
    action === "BUY"  ? { bg: "bg-green-500/20",  border: "border-green-500/40",  text: "text-green-300",  dot: "bg-green-400"  } :
    action === "SELL" ? { bg: "bg-red-500/20",    border: "border-red-500/40",    text: "text-red-300",    dot: "bg-red-400"    } :
                        { bg: "bg-gray-700/30",   border: "border-gray-600/30",   text: "text-gray-300",   dot: "bg-gray-500"   };

  if (!sig && !status?.isRunning) return null;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${isStale ? "border-yellow-500/40 bg-yellow-500/5" : "border-gray-700 bg-gray-900"}`}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold font-bold text-gray-400 uppercase tracking-wide">📊 Live Signal</span>
          {sig && (
            <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${actionStyle.bg} ${actionStyle.border} ${actionStyle.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${actionStyle.dot} ${action !== "HOLD" ? "animate-pulse" : ""}`} />
              {action}
              {sig.confidence > 0 && <span className="text-xs opacity-70 ml-0.5">{sig.confidence}%</span>}
            </span>
          )}
          {isStale && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 border border-yellow-500/40 text-yellow-300">
              ⚠️ Signal data stale
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {updatedAt ? (
            <span>
              lastIndicatorUpdate: <span className={isStale ? "text-yellow-400" : "text-gray-300"}>{indicatorAgo}</span>
            </span>
          ) : (
            <span className="text-gray-600">Waiting for first tick…</span>
          )}
          {nextInSec !== null && nextInSec > 0 && !isStale && (
            <span className="text-gray-600">next ~{nextInSec}s</span>
          )}
        </div>
      </div>

      {/* Strategy reason */}
      {sig?.reason && (
        <p className="text-xs text-gray-400 leading-relaxed border-l-2 border-gray-700 pl-2">
          {sig.reason}
        </p>
      )}

      {/* Indicators grid */}
      {sig ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
          {[
            { l: "RSI",     v: sig.rsi?.toFixed(1) ?? "—",
              c: sig.rsi != null ? (sig.rsi < 35 ? "text-green-400" : sig.rsi > 65 ? "text-red-400" : "text-yellow-400") : "text-gray-500" },
            { l: "EMA 50",  v: sig.ema50  ? `$${sig.ema50.toLocaleString(undefined, {maximumFractionDigits: 0})}` : "—", c: "text-blue-300" },
            { l: "EMA 200", v: sig.ema200 ? `$${sig.ema200.toLocaleString(undefined, {maximumFractionDigits: 0})}` : "—", c: "text-purple-300" },
            { l: "ATR",     v: sig.atr    ? `${((sig.atr / (status?.lastPrice || 1)) * 100).toFixed(3)}%` : "—", c: "text-orange-400" },
            { l: "Vol Ratio",
              v: (sig.currentVol != null && sig.avgVol != null && sig.avgVol > 0)
                ? `${(sig.currentVol / sig.avgVol).toFixed(2)}x`
                : "—",
              c: (sig.currentVol != null && sig.avgVol != null && sig.avgVol > 0 && sig.currentVol / sig.avgVol >= 1)
                ? "text-emerald-400" : "text-gray-400"
            },
            { l: "Can Trade", v: sig.canTrade ? "✓ Yes" : "✗ No",
              c: sig.canTrade ? "text-green-400" : "text-red-400" },
          ].map(({ l, v, c }) => (
            <div key={l} className="bg-gray-800/60 rounded-lg p-2">
              <div className="text-gray-500 text-[13px] font-bold mb-0.5 uppercase">{l}</div>
              <div className={`font-bold text-xs ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-gray-600 py-2">
          {status?.isRunning ? "Computing first signal — waiting for candles…" : "Bot not running"}
        </div>
      )}

      {/* Block reason */}
      {sig?.blockReason && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400">
          ⛔ {sig.blockReason}
        </div>
      )}

      {/* Candle timestamp */}
      {candleAt ? (
        <div className="text-xs text-gray-600 pt-1 border-t border-gray-800">
          lastCandleTime: <span className="text-gray-400">{candleAgo}</span>
          {status?.candleCount != null && <span className="ml-2 text-gray-600">· {status.candleCount} candles ({status.candleBar ?? "?"})</span>}
        </div>
      ) : null}
    </div>
  );
}

// ─── Analytics Card ───────────────────────────────────────────────────────────
function AnalyticsCard({
  perf,
  stopReason,
}: {
  perf: NonNullable<import("../hooks/useBotServer").ServerStatus["performance"]>;
  stopReason?: string | null;
}) {
  const fmt  = (n: number, dp = 2) => n.toFixed(dp);
  const sign = (n: number) => n >= 0 ? "+" : "";

  const cells = [
    { l: "Total Trades",   v: String(perf.totalTrades),                       c: "text-white"   },
    { l: "Win Rate",       v: `${fmt(perf.winRate, 1)}%`,                     c: perf.winRate >= 50 ? "text-green-400" : "text-red-400" },
    { l: "Profit Factor",  v: perf.profitFactor > 0 ? fmt(perf.profitFactor) : "—",
                           c: perf.profitFactor >= 1.2 ? "text-green-400" : perf.profitFactor >= 1 ? "text-yellow-400" : "text-red-400" },
    { l: "Avg Hold",       v: perf.avgHoldMins > 0 ? `${fmt(perf.avgHoldMins, 1)}m` : "—",   c: "text-blue-300"  },
    { l: "Max Drawdown",   v: perf.maxDrawdownPct > 0 ? `${fmt(perf.maxDrawdownPct)}%` : "—", c: perf.maxDrawdownPct > 15 ? "text-red-400" : "text-orange-400" },
    { l: "Session ROI",    v: `${sign(perf.sessionRoiPct)}${fmt(perf.sessionRoiPct)}%`,       c: perf.sessionRoiPct >= 0 ? "text-green-400" : "text-red-400" },
    { l: "7-Day P&L",      v: `${sign(perf.weekly7dPnl)}$${fmt(perf.weekly7dPnl)}`,           c: perf.weekly7dPnl >= 0 ? "text-green-300" : "text-red-400" },
    { l: "30-Day P&L",     v: `${sign(perf.monthly30dPnl)}$${fmt(perf.monthly30dPnl)}`,       c: perf.monthly30dPnl >= 0 ? "text-green-300" : "text-red-400" },
  ];

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[13px] font-bold font-bold text-gray-400 uppercase tracking-wide">📈 Performance Analytics</span>
        <div className="flex items-center gap-2">
          {stopReason && (
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
              Last stop: {stopReason}
            </span>
          )}
          <span className="text-xs text-gray-600">
            {perf.computedAt ? `computed ${new Date(perf.computedAt).toLocaleTimeString()}` : ""}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 text-xs">
        {cells.map(({ l, v, c }) => (
          <div key={l} className="bg-gray-800/60 rounded-lg p-2">
            <div className="text-gray-500 text-[13px] font-bold uppercase mb-0.5">{l}</div>
            <div className={`font-bold text-xs ${c}`}>{v}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-600 border-t border-gray-800 pt-2">
        Total P&amp;L: <span className={perf.totalPnlUsd >= 0 ? "text-green-400" : "text-red-400"}>
          {sign(perf.totalPnlUsd)}${fmt(perf.totalPnlUsd)}
        </span>
        {" · "}Avg Return/Trade: <span className={perf.avgTradeReturn >= 0 ? "text-green-400" : "text-red-400"}>
          {sign(perf.avgTradeReturn)}${fmt(perf.avgTradeReturn)}
        </span>
      </div>
    </div>
  );
}

// ─── Log Console ──────────────────────────────────────────────────────────────
function LogConsole({ logs }: { logs: { ts: string; level: string; msg: string }[] }) {
  const ref    = useRef<HTMLDivElement>(null);
  const lastTs = logs[0]?.ts ? new Date(logs[0].ts).getTime() : undefined;
  const ago    = useSecondsAgo(lastTs);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [logs.length]);

  const lc: Record<string, string> = {
    TRADE: "text-green-400 font-bold", ERROR: "text-red-400 font-bold",
    WARN:  "text-yellow-400", INFO: "text-blue-300", DEBUG: "text-gray-600",
  };
  return (
    <div className="bg-gray-950 border border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-gray-400">Live Bot Console</span>
        </div>
        <div className="flex items-center gap-3">
          {lastTs && (
            <span className="text-xs text-gray-500">
              lastConsoleEvent: <span className="text-gray-300">{ago}</span>
            </span>
          )}
          <span className="text-xs text-gray-600">{logs.length} entries</span>
        </div>
      </div>
      <div ref={ref} className="h-96 overflow-y-auto p-3 space-y-0.5 text-xs">
        {logs.length === 0
          ? <div className="text-gray-600 text-center py-12">Waiting for logs… Start the server to see output.</div>
          : logs.map((l, i) => (
            <div key={i} className="flex gap-2 leading-5">
              <span className="text-gray-600 shrink-0 text-xs pt-0.5 w-16">
                {new Date(l.ts).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 w-16 text-xs pt-0.5 ${lc[l.level] ?? "text-gray-400"}`}>
                [{l.level}]
              </span>
              <span className="text-gray-300 break-all">{l.msg}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── Trade History ────────────────────────────────────────────────────────────
function TradeHistory({ trades }: { trades: any[] }) {
  if (!trades.length)
    return <div className="text-center py-10 text-gray-600 text-sm">No trades yet — bot will log real trades here.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700">
            {["Symbol","Entry","Exit","PnL $","PnL %","Reason","Hold","Type"].map((h) => (
              <th key={h} className={`pb-2 ${h === "Symbol" ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/60">
          {trades.map((t) => (
            <tr key={t.id} className="hover:bg-gray-800/30">
              <td className="py-2 text-white">{t.symbol}</td>
              <td className="py-2 text-right text-gray-300">${t.entry?.toLocaleString()}</td>
              <td className="py-2 text-right text-gray-300">${t.exit?.toLocaleString()}</td>
              <td className={`py-2 text-right font-bold ${t.pnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
                {t.pnlUsd >= 0 ? "+" : ""}${t.pnlUsd?.toFixed(2)}
              </td>
              <td className={`py-2 text-right ${t.pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct?.toFixed(3)}%
              </td>
              <td className="py-2 text-right">
                <Badge color={
                  t.reason === "TAKE_PROFIT" ? "green"
                  : t.reason === "STOP_LOSS" ? "red"
                  : t.reason === "INDICATOR_EXIT" ? "purple"
                  : "gray"
                }>
                  {t.reason === "TAKE_PROFIT"    ? "TP ✅"
                   : t.reason === "STOP_LOSS"    ? "SL 🛑"
                   : t.reason === "INDICATOR_EXIT" ? "IND 📊"
                   : "⏳ TMO"}
                </Badge>
              </td>
              <td className="py-2 text-right text-gray-500">{(t.heldMins ?? t.holdMins ?? 0).toFixed(1)}m</td>
              <td className="py-2 text-right">
                <Badge color={t.dryRun ? "gray" : "green"}>
                  {t.dryRun ? "DRY" : "🟢 REAL"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Config Form — Validate & Save ────────────────────────────────────────────
function ConfigForm({
  onSave, onValidate, onTestAuth, onTestTelegram, status, disabled,
}: {
  onSave:         (cfg: any) => Promise<any>;
  onValidate:     (cfg: any) => Promise<any>;
  onTestAuth:     (keys: { apiKey: string; secretKey: string; passphrase?: string }) => Promise<any>;
  onTestTelegram: (cfg: { token: string; chatId: string }) => Promise<any>;
  status:         any;
  disabled:       boolean;
}) {
  const [cfg, setCfg] = useState({
    apiKey: "", secretKey: "", passphrase: "", tgToken: "", tgChat: "",
    symbol: "BTCUSDT", takeProfit: 0.010, stopLoss: 0.009, maxDailyLoss: -50,
    orderSizeUsdt: 25, tickMs: 5000,
  });

  // Hydrate trading params from live server status whenever it changes
  useEffect(() => {
    if (status?.config) {
      setCfg((c) => ({
        ...c,
        symbol:       status.config.symbol       ?? c.symbol,
        takeProfit:   status.config.takeProfit   ?? c.takeProfit,
        stopLoss:     status.config.stopLoss     ?? c.stopLoss,
        maxDailyLoss: status.config.maxDailyLoss ?? c.maxDailyLoss,
        orderSizeUsdt:(status.config as any).orderSizeUsdt ?? c.orderSizeUsdt,
        tickMs:       status.config.tickMs       ?? c.tickMs,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.config?.symbol]);
  const [show,         setShow]         = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [validating,   setValidating]   = useState(false);
  const [saveResult,   setSaveResult]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [authResult,   setAuthResult]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [authTesting,  setAuthTesting]  = useState(false);
  const [tgResult,     setTgResult]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [tgTesting,    setTgTesting]    = useState(false);

  const exchanges = useExchanges();
  const activeMeta = exchanges.list.find((e) => e.id === exchanges.active);

  // Validate keys against OKX THEN save
  const validateAndSave = async () => {
    if (!cfg.apiKey && !status?.hasApiKey) {
      setSaveResult({ ok: false, msg: "❌ Enter your Gate.io API Key" }); return;
    }
    if (!cfg.secretKey && !status?.hasSecret) {
      setSaveResult({ ok: false, msg: "❌ Enter your Gate.io Secret Key" }); return;
    }
    if (activeMeta?.needsPassphrase && !cfg.passphrase && !status?.hasPassphrase) {
      setSaveResult({ ok: false, msg: "❌ Enter your Gate.io Passphrase" }); return;
    }
    setValidating(true);
    setSaveResult({ ok: true, msg: "🔄 Validating keys against Gate.io..." });
    const res = await onValidate(cfg) as any;
    setValidating(false);
    if (res?.ok) {
      setSaveResult({ ok: true, msg: `✅ ${res.message ?? "Keys validated & saved! Mode: LIVE TRADING"}` });
    } else {
      setSaveResult({ ok: false, msg: `❌ ${res?.error ?? "Validation failed — keys NOT saved"}` });
    }
    setTimeout(() => setSaveResult(null), 8000);
  };

  // Save without validation (for non-key config changes)
  const saveConfig = async () => {
    setSaving(true); setSaveResult(null);
    const res = await onSave(cfg) as any;
    setSaving(false);
    if (res?.ok) {
      setSaveResult({ ok: true, msg: res.message ?? `✅ Config saved. Mode: ${res.dryRun ? "NO KEYS" : "LIVE TRADING"}` });
    } else {
      setSaveResult({ ok: false, msg: `❌ ${res?.error ?? "Save failed"}` });
    }
    setTimeout(() => setSaveResult(null), 6000);
  };

  const testAuth = async () => {
    setAuthTesting(true);
    setAuthResult({ ok: true, msg: "Testing Gate.io connection…" });
    const res = await onTestAuth({ apiKey: cfg.apiKey, secretKey: cfg.secretKey, passphrase: cfg.passphrase }) as any;
    setAuthTesting(false);
    if (res?.ok) {
      setAuthResult({ ok: true, msg: `✅ CONNECTED — Balance: $${res.balance?.toFixed(2)} USDT | canTrade: ${res.canTrade} | ${res.accountType}` });
    } else {
      setAuthResult({ ok: false, msg: `❌ ${res?.error}` });
    }
  };

  const testTg = async () => {
    setTgTesting(true);
    setTgResult({ ok: true, msg: "Sending test message…" });
    const res = await onTestTelegram({ token: cfg.tgToken, chatId: cfg.tgChat }) as any;
    setTgTesting(false);
    setTgResult(res?.ok
      ? { ok: true,  msg: "✅ Test message sent to Telegram!" }
      : { ok: false, msg: `❌ ${res?.error}` });
  };

  const inp = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none";
  const lbl = "block text-xs text-gray-400 mb-1 font-semibold";

  return (
    <div className="space-y-6">

      {/* Current status */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-2">
        <p className="text-[13px] font-bold font-bold text-gray-400 uppercase tracking-wide mb-3">🔑 Current Server Key Status</p>
        {[
          { label: "GATEIO_API_KEY",     ok: status?.hasApiKey,     mask: status?.apiKeyMask,  hint: "Not set — bot cannot trade" },
          { label: "GATEIO_API_SECRET",  ok: status?.hasSecret,     mask: status?.secretMask,  hint: "Not set — bot cannot trade" },
          { label: "GATEIO_PASSPHRASE",  ok: status?.hasPassphrase, mask: status?.hasPassphrase ? "set" : "",  hint: "Optional — leave blank if not required" },
          { label: "TELEGRAM_TOKEN",  ok: status?.hasTelegram,   mask: status?.tgTokenMask, hint: "Optional — alerts disabled" },
          { label: "TELEGRAM_CHAT_ID",ok: status?.hasTelegram,   mask: status?.tgChatMask,  hint: "Optional" },
        ].map(({ label, ok, mask, hint }) => (
          <div key={label} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${ok ? "bg-green-400" : "bg-red-500"}`} />
              <span className="text-xs text-gray-400">{label}</span>
            </div>
            <div className="text-right">
              {ok
                ? <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">{mask}</span>
                : <span className="text-xs text-red-400">{hint}</span>}
            </div>
          </div>
        ))}
        <div className="mt-2 pt-2">
          <ModeBadge status={status} />
        </div>
      </div>

      {/* Exchange selector */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-[13px] font-bold font-bold text-purple-400 uppercase tracking-wide">🌐 Exchange</p>
        <div className="grid grid-cols-3 gap-2">
          {exchanges.list.map((ex) => {
            const isActive = ex.id === exchanges.active;
            return (
              <button
                key={ex.id}
                disabled={exchanges.busy || disabled}
                onClick={() => void exchanges.select(ex.id)}
                className={`px-3 py-3 rounded-lg text-sm font-bold border transition-colors ${
                  isActive
                    ? "bg-purple-600 border-purple-400 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:border-purple-500"
                }`}
              >
                <div>{ex.label}</div>
                <div className="text-xs mt-1 opacity-80">
                  {ex.hasKeys ? `🔑 ${ex.apiKeyMask}` : "no keys"}
                </div>
              </button>
            );
          })}
        </div>
        {activeMeta?.notes && (
          <p className="text-xs text-gray-500">ℹ️ {activeMeta.notes}</p>
        )}
      </div>

      {/* Active exchange API keys */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-bold font-bold text-orange-400 uppercase tracking-wide">
            🔑 {activeMeta?.label ?? "Gate.io"} API Keys
          </p>
          <button onClick={() => setShow((s) => !s)}
            className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded bg-gray-800">
            {show ? "🙈 Hide" : "👁 Show"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className={lbl}>API Key {status?.hasApiKey && <span className="text-green-400 ml-1">✅ saved</span>}</label>
            <input type={show ? "text" : "password"} className={inp}
              placeholder={status?.apiKeyMask || "Enter your Gate.io API key…"}
              value={cfg.apiKey} onChange={(e) => setCfg((c) => ({ ...c, apiKey: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Secret Key {status?.hasSecret && <span className="text-green-400 ml-1">✅ saved</span>}</label>
            <input type={show ? "text" : "password"} className={inp}
              placeholder={status?.secretMask || "Enter your Gate.io Secret key…"}
              value={cfg.secretKey} onChange={(e) => setCfg((c) => ({ ...c, secretKey: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Passphrase {status?.hasPassphrase && <span className="text-green-400 ml-1">✅ saved</span>}</label>
            <input type={show ? "text" : "password"} className={inp}
              placeholder={status?.hasPassphrase ? "(set on server)" : "Enter your Gate.io Passphrase…"}
              value={cfg.passphrase} onChange={(e) => setCfg((c) => ({ ...c, passphrase: e.target.value }))} />
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={validateAndSave} disabled={validating || disabled}
            className="flex-1 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2">
            {validating ? <><Spinner /> Validating…</> : "✅ Validate & Save Keys"}
          </button>
          <button onClick={testAuth} disabled={authTesting || disabled}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-bold transition-colors flex items-center gap-2">
            {authTesting ? <><Spinner /> Testing…</> : "🔗 Test Auth"}
          </button>
        </div>

        {authResult && (
          <div className={`p-3 rounded-lg text-xs border ${authResult.ok ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
            {authResult.msg}
          </div>
        )}

        {saveResult && (
          <div className={`p-3 rounded-lg text-xs border ${saveResult.ok ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
            {saveResult.msg}
          </div>
        )}
      </div>

      {/* Telegram */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-4">
        <p className="text-[13px] font-bold font-bold text-blue-400 uppercase tracking-wide">📲 Telegram Alerts (Optional)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Bot Token</label>
            <input type={show ? "text" : "password"} className={inp}
              placeholder={status?.tgTokenMask || "123456789:ABCdef..."}
              value={cfg.tgToken} onChange={(e) => setCfg((c) => ({ ...c, tgToken: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Chat ID</label>
            <input type="text" className={inp}
              placeholder={status?.tgChatMask || "-1001234567890"}
              value={cfg.tgChat} onChange={(e) => setCfg((c) => ({ ...c, tgChat: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={testTg} disabled={tgTesting || disabled}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold transition-colors flex items-center gap-2">
            {tgTesting ? <><Spinner /> Sending…</> : "📲 Send Test Message"}
          </button>
          <button onClick={saveConfig} disabled={saving || disabled}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-bold transition-colors flex items-center gap-2">
            {saving ? <><Spinner /> Saving…</> : "💾 Save Telegram"}
          </button>
        </div>
        {tgResult && (
          <div className={`p-3 rounded-lg text-xs border ${tgResult.ok ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
            {tgResult.msg}
          </div>
        )}
      </div>

      {/* Trading params */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-4">
        <p className="text-[13px] font-bold font-bold text-yellow-400 uppercase tracking-wide">⚙️ Trading Parameters</p>

        {/* Strategy presets — auto-fills tickMs / SL / TP */}
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-semibold">Strategy Preset</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "scalping",    label: "Scalping",    takeProfit: 0.006, stopLoss: 0.003, tickMs: 3000   },
              { id: "day-trading", label: "Day Trading", takeProfit: 0.02,  stopLoss: 0.01,  tickMs: 60000  },
              { id: "swing",       label: "Swing",       takeProfit: 0.05,  stopLoss: 0.025, tickMs: 300000 },
            ].map((preset) => {
              const active =
                cfg.takeProfit === preset.takeProfit &&
                cfg.stopLoss   === preset.stopLoss   &&
                cfg.tickMs     === preset.tickMs;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setCfg((c) => ({ ...c, takeProfit: preset.takeProfit, stopLoss: preset.stopLoss, tickMs: preset.tickMs }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    active
                      ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-400"
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-yellow-500/40 hover:text-yellow-300"
                  }`}
                >
                  {preset.label}
                  <span className="ml-1.5 text-xs opacity-60 font-normal">
                    SL {(preset.stopLoss * 100).toFixed(1)}% / TP {(preset.takeProfit * 100).toFixed(1)}%
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-600">Selecting a preset auto-fills Tick, SL, and TP below. Click Save to apply.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Symbol",            key: "symbol",        type: "text",   placeholder: "BTCUSDT" },
            { label: "Take Profit %",     key: "takeProfit",    type: "number", placeholder: "0.010",  step: "0.001" },
            { label: "Stop Loss %",       key: "stopLoss",      type: "number", placeholder: "0.009",  step: "0.001" },
            { label: "Max Daily Loss $",  key: "maxDailyLoss",  type: "number", placeholder: "-50" },
            { label: "Order Size (USDT)", key: "orderSizeUsdt", type: "number", placeholder: "25",     step: "1" },
            { label: "Tick Interval (ms)",key: "tickMs",        type: "number", placeholder: "5000",   step: "500" },
          ].map(({ label, key, type, placeholder, step }) => (
            <div key={key}>
              <label className={lbl}>{label}</label>
              <input type={type} step={step} className={inp} placeholder={placeholder}
                value={(cfg as any)[key]}
                onChange={(e) => setCfg((c) => ({ ...c, [key]: type === "number" ? parseFloat(e.target.value) || 0 : e.target.value }))} />
            </div>
          ))}
        </div>
        <button onClick={saveConfig} disabled={saving || disabled}
          className="w-full px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2">
          {saving ? <><Spinner /> Saving…</> : "💾 Save Trading Params"}
        </button>
      </div>

      {/* Security note */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
        <p className="text-blue-400 text-xs font-bold mb-2">🔒 Security Notes</p>
        <ul className="text-gray-400 text-xs space-y-1 leading-relaxed">
          <li>• Keys are stored in <code className="text-yellow-400">server/.env</code> — never sent to any browser</li>
          <li>• Keys are only shown masked in the dashboard — never the full value</li>
          <li>• Use Gate.io API keys with <strong>Spot Trading only</strong> — no Withdraw permission</li>
          <li>• Restrict key by IP on Gate.io for extra safety</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ServerBotView() {
  // SERVER_URL reads from VITE_SERVER_URL env var, falls back to http://localhost:3001
  const server = useBotServer();
  const { connection, status, logs, trades, error, isServerRunning } = server;

  const [tab,       setTab]       = useState<"control" | "risk" | "risk-adv" | "params" | "analytics" | "orchestrate" | "scanner" | "sizing" | "telegram" | "logs" | "trades" | "config" | "setup">("control");
  const [starting,  setStarting]  = useState(false);
  const [stopping,  setStopping]  = useState(false);
  const [startMsg,  setStartMsg]  = useState<{ ok: boolean; msg: string } | null>(null);

  const keysReady = (status as any)?.keysReady ?? (status?.hasApiKey && status?.hasSecret);
  const isPaper   = status?.testMode === true || status?.mode === "PAPER";

  const handleStart = async () => {
    if (!keysReady && !isPaper) {
      setTab("config");
      setStartMsg({ ok: false, msg: "❌ Configure valid Gate.io API keys first — then click Start." });
      return;
    }
    setStarting(true);
    setStartMsg({ ok: true, msg: isPaper ? "🔄 Starting paper bot…" : "🔄 Validating keys and starting live bot…" });
    const res = await server.start({}) as any;
    setStarting(false);
    if (res?.ok) {
      setStartMsg({
        ok: true,
        msg: isPaper
          ? `✅ PAPER BOT STARTED — simulated orders on ${status.symbol} · Virtual balance $1,000`
          : `✅ LIVE BOT STARTED — real orders will execute on ${status.symbol}`,
      });
    } else {
      setStartMsg({ ok: false, msg: `❌ ${res?.error ?? "Start failed"}` });
    }
    setTimeout(() => setStartMsg(null), 10000);
  };

  const handleStop = async () => {
    setStopping(true);
    await server.stop();
    setStopping(false);
    setStartMsg({ ok: true, msg: "⛔ Bot stopped." });
    setTimeout(() => setStartMsg(null), 4000);
  };

  // Validate & Save — uses /api/binance/validate which tests THEN saves
  const handleValidate = async (cfg: any) => {
    return server.validateAndSaveKeys(cfg);
  };

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "control",  label: "🎮 Control"   },
    { id: "risk",     label: "🛡️ Risk"      },
    { id: "risk-adv",  label: "🧠 Adv Risk"   },
    { id: "params",      label: "⚙️ Params"      },
    { id: "analytics",   label: "📈 Analytics"   },
    { id: "orchestrate", label: "🤖 Orchestrate" },
    { id: "scanner",     label: "🔭 Scanner"     },
    { id: "sizing",      label: "📐 Sizing"      },
    { id: "telegram",    label: "📲 Telegram"    },
    { id: "logs",        label: "📋 Logs"        },
    { id: "trades",   label: "📊 Trades"    },
    { id: "config",   label: "⚙️ Config"    },
    { id: "setup",    label: "🚀 Setup"     },
  ];

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            🖥️ Server Bot
            <span className="text-xs text-gray-500 font-normal">v5.0</span>
          </h2>
          <p className="text-gray-500 text-xs mt-0.5">
            {isPaper ? "Paper trading · Simulated orders · No real funds at risk" : "Real order execution · Simulation disabled"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Server connection status */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${
            connection === "connected"    ? "bg-green-500/10 border-green-500/30 text-green-400"
            : connection === "connecting" ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
            : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              connection === "connected" ? "bg-green-400 animate-pulse"
              : connection === "connecting" ? "bg-yellow-400 animate-pulse"
              : "bg-red-500"
            }`} />
            {connection === "connected" ? "Server Online" : connection === "connecting" ? "Connecting…" : "Offline"}
          </div>
          {/* URL badge — shows which server URL is in use */}
          <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded text-xs border ${
            isServerRemote
              ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
              : "bg-gray-700/40 border-gray-600/30 text-gray-500"
          }`}>
            {isServerRemote ? "🌐" : "🖥️"} {displayUrl(SERVER_URL)}
          </span>
          <ModeBadge status={status} />
        </div>
      </div>

      {/* Offline banner */}
      <OfflineBanner connection={connection} error={error} />

      {/* No-keys warning */}
      {isServerRunning && <NoKeysBanner status={status} onGoConfig={() => setTab("config")} />}

      {/* Start message */}
      {startMsg && (
        <div className={`p-4 rounded-xl border text-sm ${
          startMsg.ok
            ? "bg-green-500/10 border-green-500/30 text-green-400"
            : "bg-red-500/10 border-red-500/30 text-red-400"
        }`}>
          {startMsg.msg}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.id ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : "text-gray-500 hover:text-gray-300"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CONTROL TAB ───────────────────────────────────────────────────────── */}
      {tab === "control" && (
        <div className="space-y-4">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Mode"
              value={isPaper ? "📄 PAPER" : keysReady ? "🟢 LIVE" : "🔴 NO KEYS"}
              color={isPaper ? "blue" : keysReady ? "green" : "red"}
              sub={isPaper ? "Simulated orders" : "Simulation disabled"} />
            <StatCard label="Price" value={status.lastPrice ? `$${status.lastPrice.toLocaleString()}` : "—"}
              color="cyan" sub={status.symbol} />
            <StatCard label="Daily PnL" value={`${status.dailyPnL >= 0 ? "+" : ""}$${status.dailyPnL.toFixed(2)}`}
              color={status.dailyPnL >= 0 ? "green" : "red"} sub={isPaper ? "Paper P&L" : "Real P&L"} />
            <StatCard label="Win Rate" value={`${status.winRate}%`} color="yellow"
              sub={`${status.totalTrades} total trades`} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label={isPaper ? "Paper Balance" : "Balance (USDT)"}
              value={status.balanceUSDT ? `$${status.balanceUSDT.toFixed(2)}` : "—"}
              color={isPaper ? "blue" : "white"}
              sub={isPaper ? "Virtual (started $1,000)" : "Live from Gate.io"} />
            <StatCard label="Tick Count" value={status.tickCount} color="purple" sub="Cycles run" />
            <StatCard label="Uptime" value={server.uptimeStr} color="blue" sub="Bot running time" />
            <StatCard label="Trades" value={`W${status.winningTrades} / L${status.losingTrades}`}
              color="orange" sub="Win / Loss" />
          </div>

          {/* Performance Analytics Card */}
          {status.performance && status.performance.totalTrades > 0 && (
            <AnalyticsCard perf={status.performance} stopReason={status.stopReason} />
          )}

          {/* Paper trading banner */}
          {isPaper && (
            <PaperBalanceCard
              status={status}
              onReset={server.resetPaperBalance}
            />
          )}

          {/* Start / Stop */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-bold text-white">Bot Control</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {status.isRunning
                    ? `Running — tick every ${(status.config?.tickMs ?? 5000) / 1000}s`
                    : isPaper ? "Ready — paper mode enabled" : keysReady ? "Ready — keys configured" : "Configure keys to enable"}
                </p>
              </div>
              <ModeBadge status={status} />
            </div>

            {!keysReady && !isPaper && isServerRunning && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                ❌ <strong>Cannot start:</strong> API keys not configured.{" "}
                <button onClick={() => setTab("config")} className="underline hover:no-underline">
                  Go to ⚙️ Config →
                </button>
              </div>
            )}

            <div className="flex gap-3">
              {!status.isRunning ? (
                <button onClick={handleStart} disabled={starting || !isServerRunning}
                  className={`flex-1 py-3 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
                    (keysReady || isPaper) && isServerRunning
                      ? isPaper
                        ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                        : "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-500/20"
                      : "bg-gray-700 text-gray-500 cursor-not-allowed"
                  }`}>
                  {starting ? <><Spinner /> Starting…</> : isPaper ? "▶ Start Paper Bot" : "▶ Start Live Bot"}
                </button>
              ) : (
                <button onClick={handleStop} disabled={stopping}
                  className="flex-1 py-3 rounded-xl font-bold text-base bg-red-600 hover:bg-red-500 text-white transition-all flex items-center justify-center gap-2">
                  {stopping ? <><Spinner /> Stopping…</> : "⛔ Stop Bot"}
                </button>
              )}
            </div>
          </div>

          {/* Open position */}
          {status.position && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
              <p className="text-green-400 font-bold mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                {isPaper ? "Open Position (PAPER — Simulated)" : "Open Position (REAL)"}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {[
                  { l: "Entry",    v: `$${status.position.entry?.toLocaleString()}` },
                  { l: "Qty",      v: `${status.position.qty} ${status.symbol?.replace("USDT","") ?? "BTC"}` },
                  { l: "TP",       v: `$${status.position.tp?.toFixed(2)}` },
                  { l: "SL",       v: `$${status.position.sl?.toFixed(2)}` },
                ].map(({ l, v }) => (
                  <div key={l} className="bg-gray-900 rounded-lg p-2">
                    <div className="text-gray-500 text-xs mb-0.5">{l}</div>
                    <div className="text-white font-bold">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Signal Panel */}
          <LiveSignalPanel status={status} />

          {/* Risk halt banner */}
          {status.risk?.isHalted && (
            <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 flex items-start gap-3">
              <span className="text-2xl shrink-0">⛔</span>
              <div className="flex-1">
                <p className="text-red-400 font-bold text-sm">Risk Engine Halted — No New Trades</p>
                <p className="text-red-400/70 text-xs mt-0.5">{status.risk.haltReason}</p>
              </div>
              <button
                onClick={() => setTab("risk")}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 text-xs font-bold hover:bg-red-500/30 transition-colors"
              >
                View Risk →
              </button>
            </div>
          )}

          {/* Error */}
          {status.lastError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
              <p className="text-red-400 text-xs font-bold">❌ Last Error:</p>
              <p className="text-red-300 text-xs mt-1">{status.lastError}</p>
            </div>
          )}
        </div>
      )}

      {/* ── RISK TAB ──────────────────────────────────────────────────────────── */}
      {tab === "risk" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-bold">🛡️ Risk Management</h3>
              <p className="text-gray-500 text-xs mt-0.5">
                Live limits · Position sizing · Stop-loss · Daily loss protection
              </p>
            </div>
            {status.risk?.isHalted && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 border border-red-500/40 text-red-400 animate-pulse">
                ⛔ HALTED
              </span>
            )}
          </div>
          <RiskPanel
            risk={status.risk}
            onUpdateConfig={server.updateRiskConfig}
            onHalt={server.haltTrading}
            onResume={server.resumeTrading}
            onSetKillSwitch={server.setKillSwitch}
            onFetchKillSwitch={server.fetchKillSwitch}
            onFetchRiskEvents={server.fetchRiskEvents}
            disabled={!isServerRunning}
          />
        </div>
      )}

      {/* ── ADV RISK TAB ──────────────────────────────────────────────────────── */}
      {tab === "risk-adv" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-bold">🧠 Advanced Risk Engine</h3>
              <p className="text-gray-500 text-xs mt-0.5">
                Drawdown protection · PnL limits · Loss streak · Volatility kill switch
              </p>
            </div>
            {status.advancedRisk?.state === "HALTED" && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 border border-red-500/40 text-red-400 animate-pulse">
                ⛔ HALTED
              </span>
            )}
            {status.advancedRisk?.state === "COOLDOWN" && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-orange-500/20 border border-orange-500/40 text-orange-400 animate-pulse">
                ⏳ COOLDOWN
              </span>
            )}
            {status.advancedRisk?.state === "WARNING" && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-500/20 border border-yellow-500/40 text-yellow-400">
                ⚠️ WARNING
              </span>
            )}
          </div>
          <AdvancedRiskPanel
            advancedRisk={status.advancedRisk}
            onUpdateConfig={server.updateAdvancedRiskConfig}
            onClearHalt={server.clearAdvancedHalt}
            onClearCooldown={server.clearAdvancedCooldown}
            onResetDailyPnl={server.resetAdvancedDailyPnl}
            onResetLossStreak={server.resetAdvancedLossStreak}
            onFetchRiskEvents={server.fetchRiskEvents}
            serverUrl={SERVER_URL}
            disabled={!isServerRunning}
          />
        </div>
      )}

      {/* ── ANALYTICS TAB ─────────────────────────────────────────────────────── */}
      {tab === "analytics" && (
        <ServerAnalyticsDashboard
          serverUrl={SERVER_URL}
          disabled={!isServerRunning}
        />
      )}

      {/* ── ORCHESTRATE TAB ──────────────────────────────────────────────────── */}
      {tab === "orchestrate" && (
        <OrchestratorDashboard
          serverUrl={SERVER_URL}
          disabled={!isServerRunning}
        />
      )}

      {/* ── SCANNER TAB ───────────────────────────────────────────────────────── */}
      {tab === "scanner" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-white font-bold">🔭 Multi-Symbol Scanner</h3>
            <p className="text-gray-500 text-xs mt-0.5">
              Parallel signal scanning · Portfolio &amp; risk guards · BullMQ trade routing
            </p>
          </div>
          <MultiSymbolMonitor disabled={!isServerRunning} />
        </div>
      )}

      {/* ── SIZING TAB ────────────────────────────────────────────────────────── */}
      {tab === "sizing" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-white font-bold">📐 Dynamic Position Sizing</h3>
            <p className="text-gray-500 text-xs mt-0.5">
              Risk-based sizing · ATR-adjusted stops · Constant dollar risk per trade
            </p>
          </div>
          <PositionSizingPanel />
        </div>
      )}

      {/* ── TELEGRAM TAB ──────────────────────────────────────────────────────── */}
      {tab === "telegram" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-white font-bold">📲 Telegram Notifications</h3>
            <p className="text-gray-500 text-xs mt-0.5">
              Production-grade alerts · Rate limiting · Dedup prevention · Survives outage
            </p>
          </div>
          <TelegramPanel />
        </div>
      )}

      {/* ── LOGS TAB ──────────────────────────────────────────────────────────── */}
      {tab === "logs" && <LogConsole logs={logs} />}

      {/* ── TRADES TAB ────────────────────────────────────────────────────────── */}
      {tab === "trades" && (
        <div className="space-y-4">
          {/* Paper performance summary */}
          {isPaper && (
            <PaperBalanceCard
              status={status}
              onReset={server.resetPaperBalance}
            />
          )}

          {/* Regular stats when not paper */}
          {!isPaper && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total Trades"   value={status.totalTrades}   color="white" />
              <StatCard label="Wins"           value={status.winningTrades} color="green" />
              <StatCard label="Losses"         value={status.losingTrades}  color="red"   />
              <StatCard label="Win Rate"       value={`${status.winRate}%`} color="yellow"/>
            </div>
          )}

          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <TradeHistory trades={trades} />
          </div>
        </div>
      )}

      {/* ── CONFIG TAB ────────────────────────────────────────────────────────── */}
      {tab === "config" && (
        <ConfigForm
          onSave={server.updateConfig}
          onValidate={handleValidate}
          onTestAuth={server.testBinanceAuth}
          onTestTelegram={server.testTelegram}
          status={status}
          disabled={!isServerRunning}
        />
      )}

      {/* ── SETUP TAB ─────────────────────────────────────────────────────────── */}
      {tab === "setup" && (
        <div className="space-y-4">
          {/* What changed in v5 */}
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
            <p className="text-orange-400 font-bold mb-2">🔥 v5.0 — Simulation Permanently Disabled</p>
            <ul className="text-gray-300 text-xs space-y-1 leading-relaxed">
              <li>✅ No more dry run / simulation fallback — real orders only</li>
              <li>✅ Bot refuses to start without valid Gate.io keys</li>
              <li>✅ Keys validated against live Gate.io API before saving</li>
              <li>✅ <code className="text-yellow-400">getBalance()</code> has no fake fallback — tick aborts if balance fails</li>
              <li>✅ <code className="text-yellow-400">placeOrder()</code> throws if called without valid keys</li>
              <li>✅ <code className="text-yellow-400">startBot()</code> runs full auth check before starting loop</li>
              <li>✅ Indicator-based exit (RSI/MACD sell signal) added</li>
            </ul>
          </div>

          {/* Quick start */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
            <p className="text-white font-bold">⚡ Quick Start (5 steps)</p>
            {[
              { n: "1", t: "Install & run the server", c: "cd server\nnode bot.js" },
              { n: "2", t: "Open ⚙️ Config tab — enter your Gate.io API key + secret", c: "" },
              { n: "3", t: "Click \"✅ Validate & Save Keys\" — must show CONNECTED", c: "" },
              { n: "4", t: "Click ▶ Start Live Bot — bot validates keys again before loop", c: "" },
              { n: "5", t: "Watch 📋 Logs tab — you'll see TICK #1 within 5 seconds", c: "" },
            ].map(({ n, t, c }) => (
              <div key={n} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
                <div className="flex-1">
                  <p className="text-gray-300 text-xs">{t}</p>
                  {c && <div className="mt-1"><Code lang="bash">{c}</Code></div>}
                </div>
              </div>
            ))}
          </div>

          {/* PM2 24/7 */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
            <p className="text-white font-bold">🔄 24/7 with PM2</p>
            <Code lang="bash">{"npm install -g pm2\ncd server\npm2 start ecosystem.config.cjs\npm2 save\npm2 startup"}</Code>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ["pm2 status",     "Check running"],
                ["pm2 logs bot",   "View live logs"],
                ["pm2 restart bot","Restart bot"],
                ["pm2 stop bot",   "Stop bot"],
              ].map(([cmd, desc]) => (
                <div key={cmd} className="bg-gray-800 rounded-lg p-2">
                  <code className="text-yellow-400 text-xs block">{cmd}</code>
                  <span className="text-gray-500 text-xs">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Safety rules */}
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
            <p className="text-red-400 font-bold mb-2">🛡️ Safety Rules (Built-in)</p>
            <ul className="text-gray-400 text-xs space-y-1 leading-relaxed">
              <li>• Daily loss limit: <code className="text-yellow-400">MAX_DAILY_LOSS=-50</code> → bot auto-halts</li>
              <li>• Position size: 1% of USDT balance per trade</li>
              <li>• Min order: 0.0001 BTC AND min notional $10</li>
              <li>• TP / SL: +1.0% / -0.9% on every trade</li>
              <li>• 4-hour timeout: forces exit if trade held too long</li>
              <li>• Indicator exit: sells when RSI &gt; 70 + MACD &lt; 0 + downtrend</li>
              <li>• Shutdown alert: Telegram message if bot stops with open position</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
