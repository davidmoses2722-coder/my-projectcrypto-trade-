/**
 * PythonBotView — Dashboard panel for the Python CCXT bot (port 3002)
 *
 * Connects to  http://localhost:3002  (Flask API)
 * Polls /api/status every 3 seconds
 * Controls: start, stop, config, logs, trades, ping
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { PYTHON_URL, displayUrl, isPythonRemote } from "../config/urls";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PyStatus {
  isRunning:     boolean;
  isKilled:      boolean;
  dryRun:        boolean;
  symbol:        string;
  lastPrice:     number;
  position:      PyPosition | null;
  dailyPnL:      number;
  totalTrades:   number;
  winningTrades: number;
  losingTrades:  number;
  winRate:       string;
  tickCount:     number;
  uptime:        number;
  currentSignal: PySignal | null;
  lastError:     string | null;
  balanceUSDT:   number;
  hasApiKey:     boolean;
  hasSecret:     boolean;
  hasTelegram:   boolean;
  keysReady:     boolean;
  mode:          "LIVE" | "NO_KEYS" | "UNKNOWN";
  apiKeyMask:    string;
  secretMask:    string;
  engine:        string;
  ccxtVersion:   string;
  config:        PyConfig;
}

interface PyPosition {
  entry:    number;
  qty:      number;
  order_id: string;
  time:     number;
  tp:       number;
  sl:       number;
}

interface PySignal {
  rsi:      number;
  macd:     number;
  trend:    number;
  ai_score: number;
  atr:      number;
  price:    number;
}

interface PyConfig {
  symbol:       string;
  takeProfit:   number;
  stopLoss:     number;
  tickSec:      number;
  maxDailyLoss: number;
}

interface PyLog {
  ts:    string;
  level: string;
  msg:   string;
}

interface PyTrade {
  ts:      string;
  symbol:  string;
  entry:   number;
  exit:    number;
  qty:     number;
  pnl:     number;
  reason:  string;
  dur_sec: number;
}

// ── UI helpers ────────────────────────────────────────────────────────────────
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
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/40",
    cyan:   "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs border ${c[color] ?? c.gray}`}>{children}</span>;
}

function StatCard({ label, value, sub, color = "white" }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    green: "text-emerald-400", red: "text-rose-400", yellow: "text-amber-400",
    blue: "text-blue-400", white: "text-slate-50", cyan: "text-cyan-400",
    purple: "text-purple-400", orange: "text-orange-400",
  };
  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 hover:border-slate-600/50 transition-colors">
      <div className="text-[13px] font-bold uppercase tracking-wider tracking-widest text-slate-500 mb-2">{label}</div>
      <div className={`text-2xl font-black ${colors[color] ?? "text-slate-50"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
    </div>
  );
}

// ── Python Bot Hook ───────────────────────────────────────────────────────────
// PY_URL reads VITE_PYTHON_URL from .env, falls back to http://localhost:3002
const PY_URL = PYTHON_URL;

function usePythonBot() {
  const [status,     setStatus]     = useState<PyStatus | null>(null);
  const [logs,       setLogs]       = useState<PyLog[]>([]);
  const [trades,     setTrades]     = useState<PyTrade[]>([]);
  const [connection, setConnection] = useState<"connecting" | "connected" | "offline">("connecting");
  const [error,      setError]      = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${PY_URL}/api/status`, { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setStatus(data);
      setConnection("connected");
      setError(null);
    } catch (e: any) {
      setConnection("offline");
      setError(e.message ?? `Cannot reach ${PY_URL}`);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const r = await fetch(`${PY_URL}/api/logs?limit=100`);
      if (r.ok) {
        const d = await r.json();
        setLogs(d.logs ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchTrades = useCallback(async () => {
    try {
      const r = await fetch(`${PY_URL}/api/trades`);
      if (r.ok) {
        const d = await r.json();
        setTrades(d.trades ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchLogs();
    fetchTrades();
    pollRef.current = setInterval(() => {
      fetchStatus();
      fetchLogs();
      fetchTrades();
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus, fetchLogs, fetchTrades]);

  const api = useCallback(async (path: string, method = "POST", body?: object) => {
    const r = await fetch(`${PY_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }, []);

  const start  = (cfg?: object) => api("/api/start",  "POST", cfg);
  const stop   = ()             => api("/api/stop",   "POST");
  const config = (cfg: object)  => api("/api/config", "POST", cfg);
  const ping   = ()             => fetch(`${PY_URL}/api/binance/ping`).then(r => r.json());

  return { status, logs, trades, connection, error, start, stop, config, ping, refresh: fetchStatus };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function PythonBotView() {
  const { status, logs, trades, connection, error, start, stop, config, ping, refresh } = usePythonBot();
  const [tab, setTab] = useState<"control" | "logs" | "trades" | "config" | "setup">("control");

  // Config form state
  const [apiKey,    setApiKey]    = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [tgToken,   setTgToken]   = useState("");
  const [tgChat,    setTgChat]    = useState("");
  const [symbol,    setSymbol]    = useState("BTC/USDT");
  const [tp,        setTp]        = useState("0.010");
  const [sl,        setSl]        = useState("0.009");
  const [maxLoss,   setMaxLoss]   = useState("-50");

  const [starting,  setStarting]  = useState(false);
  const [stopping,  setStopping]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [pinging,   setPinging]   = useState(false);
  const [pingRes,   setPingRes]   = useState<string | null>(null);
  const [saveMsg,   setSaveMsg]   = useState<string | null>(null);
  const [startErr,  setStartErr]  = useState<string | null>(null);
  const [showKeys,  setShowKeys]  = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Sync config form from status
  useEffect(() => {
    if (status?.config?.symbol) setSymbol(status.config.symbol);
    if (status?.config?.takeProfit) setTp(String(status.config.takeProfit));
    if (status?.config?.stopLoss)   setSl(String(status.config.stopLoss));
    if (status?.config?.maxDailyLoss) setMaxLoss(String(status.config.maxDailyLoss));
  }, [status]);

  const handleStart = async () => {
    setStarting(true);
    setStartErr(null);
    try {
      const r = await start();
      if (!r.ok) setStartErr(r.error ?? "Start failed");
      else { refresh(); setTab("control"); }
    } catch (e: any) {
      setStartErr(e.message);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try { await stop(); refresh(); } catch { /* ignore */ } finally { setStopping(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await config({
        apiKey:       apiKey      || undefined,
        secretKey:    secretKey   || undefined,
        tgToken:      tgToken     || undefined,
        tgChat:       tgChat      || undefined,
        symbol,
        takeProfit:   parseFloat(tp),
        stopLoss:     parseFloat(sl),
        maxDailyLoss: parseFloat(maxLoss),
      });
      setSaveMsg(r.message ?? (r.ok ? "✅ Saved" : `❌ ${r.error}`));
      refresh();
    } catch (e: any) {
      setSaveMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePing = async () => {
    setPinging(true);
    setPingRes(null);
    try {
      const r = await ping();
      setPingRes(r.ok ? `✅ Connected — ${r.latencyMs}ms (${r.method})` : `❌ ${r.error}`);
    } catch (e: any) {
      setPingRes(`❌ ${e.message}`);
    } finally {
      setPinging(false);
    }
  };

  const tabs = [
    { id: "control", label: "🎮 Control"  },
    { id: "logs",    label: "📋 Logs"     },
    { id: "trades",  label: "📊 Trades"   },
    { id: "config",  label: "⚙️ Config"   },
    { id: "setup",   label: "🚀 Setup"    },
  ] as const;

  const logColor: Record<string, string> = {
    TRADE: "text-green-400 font-bold",
    ERROR: "text-red-400 font-bold",
    WARN:  "text-yellow-400",
    INFO:  "text-blue-300",
    DEBUG: "text-gray-600",
  };

  const fmtUptime = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  const pnlColor = (v: number) => v > 0 ? "green" : v < 0 ? "red" : "white";

  // ── Offline Banner ────────────────────────────────────────────────────────
  if (connection !== "connected") {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl">🐍</div>
          <div>
            <h2 className="text-xl font-bold text-white">Python CCXT Bot</h2>
            <p className="text-xs text-gray-400">Real trading engine · Flask API on :3002</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* URL badge — shows which server URL is in use */}
            <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded text-xs border ${
              isPythonRemote
                ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                : "bg-gray-700/40 border-gray-600/30 text-gray-500"
            }`}>
              {isPythonRemote ? "🌐" : "🖥️"} {displayUrl(PY_URL)}
            </span>
            {connection === "connecting"
              ? <Badge color="yellow">⏳ Connecting…</Badge>
              : <Badge color="red">🔌 Offline</Badge>}
          </div>
        </div>

        {/* Offline notice */}
        <div className="border rounded-xl p-5 space-y-4 bg-blue-500/8 border-blue-500/25">
          <div className="flex items-start gap-3">
            <span className="text-2xl mt-0.5 shrink-0">ℹ️</span>
            <div>
              <p className="font-bold text-blue-300 text-sm">
                This deployment uses the Node.js trading engine
              </p>
              <p className="text-gray-400 text-xs mt-1 leading-relaxed">
                The Python CCXT integration ({PY_URL}) is not active in this environment.
                All bot controls, trade execution, risk management, and strategy logic
                are handled by the built-in Node.js API server.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
              <p className="text-sm font-bold text-white mb-1">✅ Active Engine</p>
              <p className="text-xs text-gray-400">Node.js API Server · Express · BullMQ</p>
              <p className="text-xs text-emerald-400 mt-1.5 font-semibold">Running on the Bot Control tab</p>
            </div>
            <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
              <p className="text-sm font-bold text-slate-400 mb-1">⛔ Python CCXT</p>
              <p className="text-xs text-gray-500">Requires a separate Flask server on :3002</p>
              <p className="text-xs text-slate-600 mt-1.5">Not deployed in this environment</p>
            </div>
          </div>

          <p className="text-xs text-slate-600">
            To use the Python bot, run <code className="text-slate-400 bg-slate-800 px-1 rounded">cd server/python &amp;&amp; python3 bot.py</code> in a terminal and set <code className="text-slate-400 bg-slate-800 px-1 rounded">VITE_PYTHON_URL</code> to its address.
          </p>
        </div>

        {/* Show setup anyway */}
        <SetupGuide />
      </div>
    );
  }

  // ── Main Dashboard ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl">🐍</div>
          <div>
            <h2 className="text-xl font-bold text-white">Python CCXT Bot</h2>
            <p className="text-xs text-gray-400">
              {status?.engine ?? "python-ccxt"} · ccxt v{status?.ccxtVersion ?? "?"} · Flask :3002
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* URL badge */}
          <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded text-xs border ${
            isPythonRemote
              ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
              : "bg-gray-700/40 border-gray-600/30 text-gray-500"
          }`}>
            {isPythonRemote ? "🌐" : "🖥️"} {displayUrl(PY_URL)}
          </span>
          <Badge color="cyan">🐍 Python</Badge>
          <Badge color="purple">CCXT</Badge>
          {status?.keysReady
            ? status?.isRunning
              ? <Badge color="green">🟢 LIVE TRADING</Badge>
              : <Badge color="yellow">⏸ READY</Badge>
            : <Badge color="red">🔴 NO KEYS</Badge>}
          <Badge color="gray">✅ Connected</Badge>
        </div>
      </div>

      {/* ── No keys warning ──────────────────────────────────────────────── */}
      {!status?.keysReady && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 flex items-start gap-3">
          <span className="text-2xl shrink-0">❌</span>
          <div className="flex-1">
            <p className="font-bold text-red-400 text-sm">API Keys Not Configured — Cannot Trade</p>
            <p className="text-gray-400 text-xs mt-1">
              Add your Binance keys in the <button onClick={() => setTab("config")} className="text-orange-400 underline">⚙️ Config</button> tab or edit <code className="text-yellow-400">server/python/.env</code>
            </p>
            <div className="mt-2 flex gap-2 text-xs">
              <span className={`rounded px-2 py-1 ${status?.hasApiKey ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                {status?.hasApiKey ? "✅" : "❌"} API Key
              </span>
              <span className={`rounded px-2 py-1 ${status?.hasSecret ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                {status?.hasSecret ? "✅" : "❌"} Secret
              </span>
            </div>
          </div>
          <button onClick={() => setTab("config")} className="shrink-0 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold">
            ⚙️ Set Keys
          </button>
        </div>
      )}

      {/* ── Killed banner ────────────────────────────────────────────────── */}
      {status?.isKilled && (
        <div className="bg-red-900/40 border-2 border-red-500/60 rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">🛑</span>
          <div>
            <p className="text-red-300 font-black text-sm">DAILY LOSS LIMIT HIT — Bot Killed</p>
            <p className="text-red-400/80 text-xs">Daily PnL: ${status.dailyPnL?.toFixed(2)}. Restart server tomorrow.</p>
          </div>
        </div>
      )}

      {/* ── Start error ──────────────────────────────────────────────────── */}
      {startErr && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-3 flex items-center gap-2 text-red-400 text-sm">
          <span>❌</span><span>{startErr}</span>
          <button onClick={() => setStartErr(null)} className="ml-auto text-gray-600 hover:text-gray-400">✕</button>
        </div>
      )}

      {/* ── Tab nav ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-900/60 p-1 rounded-xl border border-gray-800 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              tab === t.id ? "bg-gray-700 text-white shadow" : "text-gray-400 hover:text-gray-200"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* 🎮 CONTROL TAB                                                    */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === "control" && (
        <div className="space-y-4">

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Price" value={status?.lastPrice ? `$${status.lastPrice.toLocaleString()}` : "—"} color="cyan" sub={status?.symbol} />
            <StatCard label="Balance" value={status?.balanceUSDT ? `$${status.balanceUSDT.toFixed(2)}` : "—"} color="blue" sub="USDT free" />
            <StatCard label="Daily PnL" value={status?.dailyPnL !== undefined ? `$${status.dailyPnL.toFixed(4)}` : "—"} color={pnlColor(status?.dailyPnL ?? 0)} sub="today" />
            <StatCard label="Win Rate" value={status?.winRate ?? "—"} color="purple" sub={`${status?.totalTrades ?? 0} trades`} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Ticks" value={status?.tickCount ?? 0} color="white" />
            <StatCard label="Uptime" value={fmtUptime(status?.uptime ?? 0)} color="white" />
            <StatCard label="Wins" value={status?.winningTrades ?? 0} color="green" />
            <StatCard label="Losses" value={status?.losingTrades ?? 0} color="red" />
          </div>

          {/* Start / Stop */}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleStart} disabled={starting || status?.isRunning || status?.isKilled || !status?.keysReady}
              className="flex items-center justify-center gap-2 py-4 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold text-lg transition-all">
              {starting
                ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : "▶"} Start Bot
            </button>
            <button onClick={handleStop} disabled={stopping || !status?.isRunning}
              className="flex items-center justify-center gap-2 py-4 rounded-xl bg-red-700 hover:bg-red-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold text-lg transition-all">
              {stopping
                ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : "⏹"} Stop Bot
            </button>
          </div>

          {/* Open position */}
          {status?.position && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-blue-400 font-bold text-sm">📈 OPEN POSITION</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-gray-800 rounded px-3 py-2">
                  <div className="text-gray-500">Entry</div>
                  <div className="text-white font-bold">${status.position.entry.toFixed(2)}</div>
                </div>
                <div className="bg-gray-800 rounded px-3 py-2">
                  <div className="text-gray-500">Qty</div>
                  <div className="text-white font-bold">{status.position.qty}</div>
                </div>
                <div className="bg-green-900/40 rounded px-3 py-2">
                  <div className="text-gray-500">TP</div>
                  <div className="text-green-400 font-bold">${status.position.tp.toFixed(2)}</div>
                </div>
                <div className="bg-red-900/40 rounded px-3 py-2">
                  <div className="text-gray-500">SL</div>
                  <div className="text-red-400 font-bold">${status.position.sl.toFixed(2)}</div>
                </div>
              </div>
              {status.lastPrice > 0 && (
                <div className="text-xs">
                  Unrealized PnL:{" "}
                  <span className={(status.lastPrice - status.position.entry) * status.position.qty >= 0 ? "text-green-400" : "text-red-400"}>
                    ${((status.lastPrice - status.position.entry) * status.position.qty).toFixed(4)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Current Signal */}
          {status?.currentSignal && (
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
              <p className="text-[13px] font-bold text-gray-500 mb-3 font-semibold uppercase tracking-wide">🤖 Latest AI Signal</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
                {[
                  { k: "RSI",      v: status.currentSignal.rsi?.toFixed(1),      color: status.currentSignal.rsi < 40 ? "green" : status.currentSignal.rsi > 65 ? "red" : "white" },
                  { k: "MACD",     v: status.currentSignal.macd?.toFixed(4),     color: status.currentSignal.macd > 0 ? "green" : "red" },
                  { k: "Trend",    v: status.currentSignal.trend === 1 ? "↑UP" : status.currentSignal.trend === -1 ? "↓DOWN" : "→SIDE", color: status.currentSignal.trend === 1 ? "green" : status.currentSignal.trend === -1 ? "red" : "yellow" },
                  { k: "AI Score", v: `${status.currentSignal.ai_score > 0 ? "+" : ""}${status.currentSignal.ai_score}/7`, color: status.currentSignal.ai_score >= 3 ? "green" : status.currentSignal.ai_score <= -3 ? "red" : "yellow" },
                  { k: "ATR",      v: status.currentSignal.atr?.toFixed(2),      color: "white" },
                  { k: "Price",    v: `$${status.currentSignal.price?.toLocaleString()}`, color: "cyan" },
                ].map(({ k, v, color }) => (
                  <div key={k} className="bg-gray-900 rounded px-2 py-2">
                    <div className="text-gray-600 text-xs">{k}</div>
                    <div className={`font-bold text-sm ${color === "green" ? "text-green-400" : color === "red" ? "text-red-400" : color === "yellow" ? "text-yellow-400" : color === "cyan" ? "text-cyan-400" : "text-white"}`}>
                      {v ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Binance ping */}
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <button onClick={handlePing} disabled={pinging}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 text-white text-sm font-semibold transition-colors flex items-center gap-2">
              {pinging ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "🔗"}
              Test Binance (CCXT)
            </button>
            {pingRes && (
              <span className={`text-xs ${pingRes.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>
                {pingRes}
              </span>
            )}
          </div>

          {/* Last error */}
          {status?.lastError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-xs">
              ❌ Last Error: {status.lastError}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* 📋 LOGS TAB                                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === "logs" && (
        <div className="bg-gray-950 border border-gray-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-gray-400">Live Log — {logs.length} entries</span>
            </div>
            <Badge color="purple">🐍 Python</Badge>
          </div>
          <div ref={logRef} className="h-[500px] overflow-y-auto p-3 space-y-0.5">
            {logs.length === 0 ? (
              <p className="text-gray-600 text-xs p-4">No logs yet — start the bot to see output</p>
            ) : [...logs].reverse().map((l, i) => (
              <div key={i} className="flex gap-2 text-xs leading-5">
                <span className="text-gray-700 shrink-0 w-20 truncate">{l.ts?.slice(11, 19)}</span>
                <span className={`shrink-0 w-14 ${logColor[l.level] ?? "text-gray-500"}`}>[{l.level}]</span>
                <span className={`flex-1 ${logColor[l.level] ?? "text-gray-400"}`}>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* 📊 TRADES TAB                                                      */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === "trades" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total" value={status?.totalTrades ?? 0} />
            <StatCard label="Wins" value={status?.winningTrades ?? 0} color="green" />
            <StatCard label="Win Rate" value={status?.winRate ?? "—"} color="purple" />
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Trade History</span>
              <Badge color="purple">🐍 CCXT</Badge>
            </div>
            {trades.length === 0 ? (
              <p className="text-gray-600 text-xs p-6 text-center">No closed trades yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-gray-700 bg-gray-800/50 uppercase tracking-wider font-sans font-bold">
                    <tr>
                      {["Time", "Symbol", "Entry", "Exit", "Qty", "PnL", "Reason", "Duration"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-gray-500 font-bold uppercase tracking-wider font-sans">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {[...trades].reverse().map((t, i) => (
                      <tr key={i} className="hover:bg-gray-800/30">
                        <td className="px-3 py-2 text-gray-500">{t.ts?.slice(11, 19)}</td>
                        <td className="px-3 py-2 text-cyan-400">{t.symbol}</td>
                        <td className="px-3 py-2 text-white">${t.entry?.toFixed(2)}</td>
                        <td className="px-3 py-2 text-white">${t.exit?.toFixed(2)}</td>
                        <td className="px-3 py-2 text-gray-300">{t.qty}</td>
                        <td className={`px-3 py-2 font-bold ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          ${t.pnl >= 0 ? "+" : ""}{t.pnl?.toFixed(4)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${t.reason === "TP" ? "bg-green-500/20 text-green-400" : t.reason === "SL" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                            {t.reason}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-400">{t.dur_sec}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ⚙️ CONFIG TAB                                                       */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === "config" && (
        <div className="space-y-4">

          {/* Current key status */}
          {(status?.hasApiKey || status?.hasSecret) && (
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-2">
              <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase tracking-wide mb-3">Current Key Status</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className={`rounded px-3 py-2 ${status?.hasApiKey ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
                  <span className={status?.hasApiKey ? "text-green-400" : "text-red-400"}>
                    {status?.hasApiKey ? "✅" : "❌"} API Key{status?.apiKeyMask ? ` — ${status.apiKeyMask}` : " — not set"}
                  </span>
                </div>
                <div className={`rounded px-3 py-2 ${status?.hasSecret ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
                  <span className={status?.hasSecret ? "text-green-400" : "text-red-400"}>
                    {status?.hasSecret ? "✅" : "❌"} Secret{status?.secretMask ? ` — ${status.secretMask}` : " — not set"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Keys form */}
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-white">🔑 Binance API Keys</p>
              <button onClick={() => setShowKeys(v => !v)} className="text-xs text-gray-400 hover:text-gray-200">
                {showKeys ? "🙈 Hide" : "👁 Show"}
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">API Key</label>
                <input type={showKeys ? "text" : "password"} value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder={status?.apiKeyMask || "Enter Binance API Key…"}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Secret Key</label>
                <input type={showKeys ? "text" : "password"} value={secretKey} onChange={e => setSecretKey(e.target.value)}
                  placeholder={status?.secretMask || "Enter Binance Secret Key…"}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
              </div>
            </div>

            <p className="text-sm font-bold text-white pt-2">📲 Telegram (optional)</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Bot Token</label>
                <input type={showKeys ? "text" : "password"} value={tgToken} onChange={e => setTgToken(e.target.value)}
                  placeholder="123456789:ABCdef…"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Chat ID</label>
                <input type="text" value={tgChat} onChange={e => setTgChat(e.target.value)}
                  placeholder="-1001234567890"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
              </div>
            </div>

            <p className="text-sm font-bold text-white pt-2">⚙️ Trading Config</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Symbol (CCXT format)</label>
                <input type="text" value={symbol} onChange={e => setSymbol(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Take Profit (0.010 = 1%)</label>
                <input type="number" step="0.001" value={tp} onChange={e => setTp(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Stop Loss (0.009 = 0.9%)</label>
                <input type="number" step="0.001" value={sl} onChange={e => setSl(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Daily Loss (USD)</label>
                <input type="number" value={maxLoss} onChange={e => setMaxLoss(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500" />
              </div>
            </div>

            <button onClick={handleSave} disabled={saving}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white font-bold transition-colors flex items-center justify-center gap-2">
              {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "💾"}
              Save & Apply Config
            </button>

            {saveMsg && (
              <div className={`text-xs p-3 rounded-lg ${saveMsg.startsWith("✅") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                {saveMsg}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* 🚀 SETUP TAB                                                       */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === "setup" && <SetupGuide />}
    </div>
  );
}

// ── Setup Guide (shown offline + in setup tab) ────────────────────────────────
function SetupGuide() {
  const steps = [
    {
      n: 1, title: "Create virtual environment",
      code: `cd server/python\npython3 -m venv venv\nsource venv/bin/activate   # Linux/macOS\nvenv\\Scripts\\activate       # Windows`,
    },
    {
      n: 2, title: "Install Python dependencies",
      code: `pip install -r requirements.txt\n\n# Installs: ccxt flask flask-cors requests python-dotenv`,
    },
    {
      n: 3, title: "Configure API keys",
      code: `# Edit server/python/.env\nBINANCE_API_KEY=your_real_key\nBINANCE_SECRET_KEY=your_real_secret\nTELEGRAM_TOKEN=your_bot_token\nTELEGRAM_CHAT_ID=your_chat_id\nBOT_SYMBOL=BTC/USDT`,
    },
    {
      n: 4, title: "Start the Python bot",
      code: `python3 bot.py\n\n# You should see:\n# ✅ API Key: abc123...xyz\n# ✅ Secret:  def456...uvw\n# 🟢 Mode:   LIVE TRADING\n# 🌐 Starting Flask API on port 3002…`,
    },
    {
      n: 5, title: "24/7 with PM2 (VPS)",
      code: `npm install -g pm2\npm2 start ecosystem.config.cjs\npm2 logs python-bot\npm2 save && pm2 startup`,
    },
    {
      n: 6, title: "Start trading from dashboard",
      code: `# In this dashboard:\n# 1. Go to ⚙️ Config tab\n# 2. Enter API keys → Save\n# 3. Go to 🎮 Control tab\n# 4. Click ▶ Start Bot\n# 5. Watch live logs below`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">🐍</span>
          <div>
            <h3 className="font-bold text-white">Python CCXT Bot Setup</h3>
            <p className="text-xs text-gray-400">Real Binance trading · No CORS · 100+ exchanges supported</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {[
            { icon: "🐍", label: "Python 3.9+" },
            { icon: "📦", label: "CCXT 4.x" },
            { icon: "🌐", label: "Flask REST" },
            { icon: "🔒", label: "No CORS" },
          ].map(({ icon, label }) => (
            <div key={label} className="bg-gray-800/60 rounded-lg px-3 py-2 flex items-center gap-2 text-gray-300">
              <span>{icon}</span><span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {steps.map(s => (
        <div key={s.n} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0">{s.n}</span>
            <p className="text-sm font-semibold text-white">{s.title}</p>
          </div>
          <Code lang="bash">{s.code}</Code>
        </div>
      ))}

      <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-sm font-bold text-white">🔀 CCXT vs Node.js Bot</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left px-3 py-2 text-gray-500 uppercase tracking-wider font-sans font-bold">Feature</th>
                <th className="text-left px-3 py-2 text-blue-400 uppercase tracking-wider font-sans font-bold">Python CCXT :3002</th>
                <th className="text-left px-3 py-2 text-green-400 uppercase tracking-wider font-sans font-bold">Node.js :3001</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-gray-300">
              {[
                ["Language",     "Python 3",         "Node.js 20"],
                ["Exchange lib", "CCXT (unified)",   "Raw HTTPS"],
                ["Exchanges",    "100+ supported",   "Binance only"],
                ["Time sync",    "Auto (CCXT)",      "Manual offset"],
                ["Indicators",   "Pure Python",      "Pure JS"],
                ["Port",         "3002",             "3001"],
                ["PM2 support",  "✅ ecosystem.cjs", "✅ ecosystem.cjs"],
              ].map(([f, py, nd]) => (
                <tr key={f}>
                  <td className="px-3 py-1.5 text-gray-500">{f}</td>
                  <td className="px-3 py-1.5 text-blue-300">{py}</td>
                  <td className="px-3 py-1.5 text-green-300">{nd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
