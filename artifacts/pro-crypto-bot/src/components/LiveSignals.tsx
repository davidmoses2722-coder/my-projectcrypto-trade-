/**
 * LiveSignals v5.0 — Real-time Market Prices, NO backend required
 *
 * DATA FLOW:
 *   Public WebSocket → useLiveSignals → here
 *   (WebSocket bypasses CORS — works from any browser / deployed site)
 *
 * ALWAYS SHOWS DATA:
 *   • Live WS feed  → ⚡ LIVE badge, sub-second ticks
 *   • REST fallback → 🟡 REST badge, 3s refresh
 *   • Mock sim      → 🟠 SIM badge, 1.5s animated prices (never blank)
 */

import { useState, useEffect, useRef } from "react";
import { useLiveSignals, LiveTicker, LiveSignal, SignalType, StreamStatus, WsStats } from "../hooks/useLiveSignals";
import { PremiumCard } from "./premium/PremiumCard";
import { Radio, Activity, Search, Clock, Cpu, Filter, Zap, LayoutDashboard, Grid3x3 } from "lucide-react";
import { motion } from "framer-motion";

// ─── Coin metadata ─────────────────────────────────────────────────────────────
const COIN: Record<string, { name: string; icon: string; color: string }> = {
  BTCUSDT:  { name: "Bitcoin",   icon: "₿",  color: "#F7931A" },
  ETHUSDT:  { name: "Ethereum",  icon: "Ξ",  color: "#627EEA" },
  SOLUSDT:  { name: "Solana",    icon: "◎",  color: "#9945FF" },
  BNBUSDT:  { name: "BNB",       icon: "⬡",  color: "#F3BA2F" },
  XRPUSDT:  { name: "XRP",       icon: "✕",  color: "#00AAE4" },
  ADAUSDT:  { name: "Cardano",   icon: "₳",  color: "#0033AD" },
  AVAXUSDT: { name: "Avalanche", icon: "▲",  color: "#E84142" },
  DOGEUSDT: { name: "Dogecoin",  icon: "Ð",  color: "#C2A633" },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmt(price: number, sym: string) {
  if (!price) return "—";
  if (sym.startsWith("DOGE") || sym.startsWith("ADA") || sym.startsWith("XRP"))
    return `$${price.toFixed(4)}`;
  if (price < 10)   return `$${price.toFixed(3)}`;
  if (price < 1000) return `$${price.toFixed(2)}`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(p: number) {
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

function sigStyle(sig: SignalType) {
  switch (sig) {
    case "STRONG_BUY":  return { bg: "bg-emerald-500/20", border: "border-emerald-500/50", text: "text-emerald-300", bar: "bg-emerald-400" };
    case "BUY":         return { bg: "bg-green-500/15",   border: "border-green-500/40",   text: "text-green-400",   bar: "bg-green-400"   };
    case "SELL":        return { bg: "bg-red-500/15",     border: "border-red-500/40",     text: "text-rose-400",     bar: "bg-rose-400"     };
    case "STRONG_SELL": return { bg: "bg-rose-600/20",    border: "border-rose-500/50",    text: "text-rose-300",    bar: "bg-rose-400"    };
    default:            return { bg: "bg-slate-700/30",    border: "border-gray-600/30",    text: "text-slate-400",    bar: "bg-gray-500"    };
  }
}

function rsiColor(r: number) {
  if (r >= 70) return "text-rose-400";
  if (r <= 30) return "text-emerald-400";
  return "text-yellow-400";
}

function trendBadge(t: number) {
  if (t === 1)  return <span className="text-emerald-400 text-sm font-bold">▲ UP</span>;
  if (t === -1) return <span className="text-rose-400 text-sm font-bold">▼ DN</span>;
  return <span className="text-slate-500 text-sm">→ FLAT</span>;
}

function ago(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ─── Stream Status Badge ───────────────────────────────────────────────────────
function StatusBadge({
  status, wsConnected, lastUpdate, tickTotal,
}: {
  status: StreamStatus;
  wsConnected: boolean;
  lastUpdate: number;
  tickTotal: number;
}) {
  const [age, setAge] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAge(Math.floor((Date.now() - lastUpdate) / 1000)), 500);
    return () => clearInterval(t);
  }, [lastUpdate]);

  if (status === "live" && wsConnected) return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/40">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-emerald-300 text-sm font-bold">⚡ LIVE · Gate.io WebSocket</span>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800 border border-white/5">
        <span className="text-gray-300 text-sm">{tickTotal.toLocaleString()} ticks · {age}s ago</span>
      </div>
    </div>
  );

  if (status === "polling") return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-500/15 border border-yellow-500/40">
        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        <span className="text-yellow-300 text-sm font-bold">🟡 REST · Market Data · every 3s</span>
      </div>
      <div className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-full bg-slate-800 border border-white/5">
        <span className="text-slate-400 text-sm">{age}s ago</span>
      </div>
    </div>
  );

  if (status === "reconnecting") return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/40">
        <span className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
        <span className="text-amber-300 text-sm font-bold">🔄 RECONNECTING · auto in 5s…</span>
      </div>
      <div className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-full bg-slate-800 border border-white/5">
        <span className="text-slate-400 text-sm">{tickTotal.toLocaleString()} ticks</span>
      </div>
    </div>
  );

  if (status === "offline") return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500/15 border border-orange-500/40">
        <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        <span className="text-orange-300 text-sm font-bold">🟠 SIM · Connecting…</span>
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/15 border border-blue-500/40">
      <span className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
      <span className="text-blue-300 text-sm font-bold">Connecting to market feed…</span>
    </div>
  );
}

// ─── WS Reconnect Stats Panel ──────────────────────────────────────────────────
function WsReconnectPanel({ stats, status }: { stats: WsStats; status: StreamStatus }) {
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(Math.max(0, Math.ceil(stats.nextReconnectIn / 1000)));
    }, 250);
    return () => clearInterval(t);
  }, [stats.nextReconnectIn]);

  const isReconnecting = status === "reconnecting";
  const uptimeSec      = Math.floor(stats.uptime / 1000);
  const uptimeStr      = uptimeSec < 60
    ? `${uptimeSec}s`
    : uptimeSec < 3600
    ? `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`
    : `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

  return (
    <div className={`rounded-xl border p-4 ${
      isReconnecting
        ? "bg-amber-500/8 border-amber-500/30"
        : "bg-slate-800/40 border-white/5/50"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-200">WebSocket Health</span>
          {isReconnecting && (
            <span className="flex items-center gap-1 text-amber-400 text-sm">
              <span className="w-2.5 h-2.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
              Reconnecting…
            </span>
          )}
        </div>
        {isReconnecting && countdown > 0 && (
          <div className="text-center">
            <div className="text-2xl font-extrabold text-amber-400 tabular-nums leading-none">
              {countdown}s
            </div>
            <div className="text-sm text-amber-400/60 mt-0.5">until reconnect</div>
          </div>
        )}
      </div>

      {/* Reconnect progress bar */}
      {isReconnecting && stats.currentDelay > 0 && (
        <div className="mb-3">
          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-250"
              style={{
                width: `${Math.max(0, Math.min(100, 100 - (stats.nextReconnectIn / stats.currentDelay) * 100))}%`
              }}
            />
          </div>
          <div className="flex justify-between text-sm text-slate-600 mt-1">
            <span>reconnecting in {countdown}s</span>
            <span>delay: {stats.currentDelay / 1000}s</span>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCell
          label="Connects"
          value={stats.connectCount.toString()}
          color="text-emerald-400"
          icon="🟢"
        />
        <StatCell
          label="Disconnects"
          value={stats.disconnectCount.toString()}
          color={stats.disconnectCount > 0 ? "text-rose-400" : "text-slate-500"}
          icon="🔴"
        />
        <StatCell
          label="Reconnects"
          value={stats.reconnectCount.toString()}
          color={stats.reconnectCount > 0 ? "text-amber-400" : "text-slate-500"}
          icon="🔄"
        />
        <StatCell
          label="Uptime"
          value={stats.lastConnectedAt ? uptimeStr : "—"}
          color="text-blue-400"
          icon="⏱"
        />
      </div>

      {/* Backoff ladder */}
      <div className="mt-3 pt-3 border-t border-white/5/50">
        <p className="text-[13px] font-bold text-slate-500 mb-2 font-sans uppercase tracking-wider">
          Reconnect backoff ladder
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[5, 10, 20, 30].map((s) => {
            const ms = s * 1000;
            const isActive = stats.currentDelay === ms && isReconnecting;
            const isPast   = ms < stats.currentDelay;
            return (
              <div key={s} className={`px-2 py-0.5 rounded text-sm font-bold border transition-all ${
                isActive  ? "bg-amber-500/20 border-amber-500/50 text-amber-300" :
                isPast    ? "bg-slate-700/50 border-gray-600/50 text-slate-400"    :
                            "bg-slate-800/50 border-white/5/30 text-slate-600"
              }`}>
                {s}s {isActive ? "← now" : ""}
              </div>
            );
          })}
          <span className="text-sm text-slate-600">→ 30s max cap</span>
        </div>
      </div>

      {/* onclose guarantee note */}
      <div className="mt-3 pt-3 border-t border-white/5/50">
        <p className="text-sm text-slate-600 leading-relaxed">
          <span className="text-emerald-500/80">✓</span> onclose handler always fires after disconnect ·{" "}
          <span className="text-emerald-500/80">✓</span> onerror calls close() to trigger onclose ·{" "}
          <span className="text-emerald-500/80">✓</span> reconnect guaranteed — bot never stays dead
        </p>
      </div>
    </div>
  );
}

function StatCell({
  label, value, color, icon,
}: {
  label: string; value: string; color: string; icon: string;
}) {
  return (
    <div className="bg-slate-900/60 rounded-lg p-2 text-center">
      <div className="text-sm mb-0.5">{icon}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[13px] font-bold text-slate-500 font-sans uppercase">{label}</div>
    </div>
  );
}

// ─── Connection Info Banner ────────────────────────────────────────────────────
function ConnectionInfo({ source: dataSource, wsConnected }: { source: string; wsConnected: boolean }) {
  const isExchangeLive = dataSource === "gateio-ws" || dataSource === "gateio-rest";
  if (isExchangeLive) return null;

  return (
    <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
      <span className="text-xl mt-0.5 shrink-0">📡</span>
      <div className="min-w-0">
        <p className="text-blue-300 font-bold text-sm">
          {wsConnected ? "Live data connected!" : "Connecting to live market feed…"}
        </p>
        <p className="text-slate-400 text-sm mt-0.5">
          {wsConnected
            ? "Receiving real-time prices via live WebSocket stream. No server needed."
            : "Prices are simulated while connecting. WebSocket opens automatically — no reload needed."}
        </p>
        <p className="text-slate-600 text-sm mt-1">
          Public WebSocket · ticker channels · 8 symbols
        </p>
      </div>
    </div>
  );
}

// ─── Ticker Tape ───────────────────────────────────────────────────────────────
function TickerTape({ tickers }: { tickers: LiveTicker[] }) {
  const items = [...tickers, ...tickers]; // doubled for seamless loop
  return (
    <div className="bg-black/60 border-b border-white/5 overflow-hidden py-2">
      <div className="flex animate-[scroll_35s_linear_infinite] w-max">
        {items.map((t, i) => (
          <div key={i} className="flex items-center gap-2 px-5 border-r border-white/5/60 shrink-0">
            <span className="text-sm font-bold text-gray-300">
              {t.symbol.replace("USDT", "")}
            </span>
            <span className="text-sm font-bold text-white">{fmt(t.price, t.symbol)}</span>
            <span className={`text-sm ${t.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {pct(t.changePct)}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${
              t.signal.includes("BUY") ? "bg-emerald-400" :
              t.signal.includes("SELL") ? "bg-rose-400" : "bg-gray-600"
            }`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Signal Detail Drawer ──────────────────────────────────────────────────────
function SignalDetailDrawer({
  sym, tickers, signals, onClose,
}: {
  sym: string;
  tickers: LiveTicker[];
  signals: LiveSignal[];
  onClose: () => void;
}) {
  const t = tickers.find(t => t.symbol === sym);
  const s = signals.find(s => s.symbol === sym);
  const meta = COIN[sym] ?? { name: sym, icon: "●", color: "#888" };
  const data = s ?? t;
  if (!data) return null;

  const price     = "price" in data ? data.price : 0;
  const changePct = "changePct" in data ? data.changePct : 0;
  const signal    = "signal" in data ? data.signal : "HOLD";
  const rsi       = "rsi" in data ? data.rsi : 50;
  const macd      = "macd" in data ? data.macd : 0;
  const aiScore   = "aiScore" in data ? data.aiScore : 0;
  const trend     = "trend" in data ? data.trend : 0;
  const strength  = s?.strength ?? Math.abs(aiScore) / 7 * 100;
  const ss        = sigStyle(signal as SignalType);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
              style={{ background: meta.color + "22", color: meta.color }}>
              {meta.icon}
            </div>
            <div>
              <div className="text-base font-black text-white">{sym.replace("USDT", "")}</div>
              <div className="text-sm text-slate-400">{meta.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 transition-colors">✕</button>
        </div>

        {/* Price */}
        <div className="bg-slate-800/60 rounded-xl p-4 mb-4 flex items-center justify-between">
          <div>
            <div className="text-2xl font-black text-white">{fmt(price, sym)}</div>
            <div className={`text-sm font-bold mt-0.5 ${changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {pct(changePct)} 24h
            </div>
          </div>
          <span className={`px-3 py-1.5 rounded-full text-sm font-black border ${ss.bg} ${ss.border} ${ss.text}`}>
            {signal.replace("_", " ")}
          </span>
        </div>

        {/* Indicators grid */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: "RSI", value: rsi.toFixed(0), color: rsiColor(rsi) },
            { label: "MACD", value: `${macd >= 0 ? "+" : ""}${Math.abs(macd) < 0.001 ? macd.toExponential(1) : macd.toFixed(2)}`, color: macd >= 0 ? "text-emerald-400" : "text-rose-400" },
            { label: "AI", value: `${aiScore > 0 ? "+" : ""}${aiScore}/7`, color: aiScore > 0 ? "text-emerald-400" : aiScore < 0 ? "text-rose-400" : "text-slate-400" },
            { label: "Trend", value: trend === 1 ? "▲ UP" : trend === -1 ? "▼ DN" : "→ FLAT", color: trend === 1 ? "text-emerald-400" : trend === -1 ? "text-rose-400" : "text-slate-500" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-800/80 rounded-xl p-3 text-center">
              <div className={`text-sm font-black ${color}`}>{value}</div>
              <div className="text-xs text-slate-600 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Signal strength bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-slate-400 font-semibold">Signal Strength</span>
            <span className={`font-black ${ss.text}`}>{strength.toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${ss.bar}`} style={{ width: `${strength}%` }} />
          </div>
        </div>

        {/* Context note */}
        <p className="text-xs text-slate-600 text-center">
          Indicators computed in-browser · RSI(14) · MACD(12,26,9) · EMA(20,50) · aiScore(−7→+7)
        </p>
      </div>
    </div>
  );
}

// ─── Price Flash Row (Table view) ──────────────────────────────────────────────
function TickerRow({ ticker, rank, onSelect }: { ticker: LiveTicker; rank: number; onSelect: (sym: string) => void }) {
  const [flash, setFlash] = useState<"up" | "dn" | null>(null);
  const prev = useRef(ticker.price);

  useEffect(() => {
    if (!ticker.price || ticker.price === prev.current) return;
    setFlash(ticker.price > prev.current ? "up" : "dn");
    prev.current = ticker.price;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [ticker.price]);

  const meta = COIN[ticker.symbol] ?? { name: ticker.symbol, icon: "●", color: "#888" };
  const ss   = sigStyle(ticker.signal);
  const isUp = ticker.changePct >= 0;
  const bg   = flash === "up" ? "bg-emerald-500/8" : flash === "dn" ? "bg-red-500/8" : "";

  return (
    <div
      onClick={() => onSelect(ticker.symbol)}
      className={`grid grid-cols-12 gap-1 items-center px-4 py-3 cursor-pointer
        border-b border-white/5/50 hover:bg-slate-800/20 transition-all duration-150 ${bg}`}>

      {/* # + Coin */}
      <div className="col-span-3 flex items-center gap-2.5">
        <span className="text-sm text-slate-600 w-4 text-right">{rank}</span>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
          style={{ background: meta.color + "22", color: meta.color }}>
          {meta.icon}
        </div>
        <div>
          <div className="text-sm font-bold text-white leading-none">
            {ticker.symbol.replace("USDT", "")}
          </div>
          <div className="text-sm text-slate-500 mt-0.5">{meta.name}</div>
        </div>
      </div>

      {/* Price */}
      <div className="col-span-2 text-right">
        <div className={`text-sm font-bold transition-colors duration-200 ${
          flash === "up" ? "text-emerald-300" : flash === "dn" ? "text-rose-300" : "text-white"
        }`}>{fmt(ticker.price, ticker.symbol)}</div>
        <div className={`text-sm ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
          {pct(ticker.changePct)}
        </div>
      </div>

      {/* RSI */}
      <div className="col-span-1 text-center">
        <div className={`text-sm font-bold ${rsiColor(ticker.rsi)}`}>
          {ticker.rsi.toFixed(0)}
        </div>
        <div className="text-sm text-slate-600">RSI</div>
      </div>

      {/* MACD */}
      <div className="col-span-1 text-center">
        <div className={`text-sm font-bold ${ticker.macd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {ticker.macd >= 0 ? "+" : ""}
          {Math.abs(ticker.macd) < 0.001 ? ticker.macd.toExponential(1) : ticker.macd.toFixed(2)}
        </div>
        <div className="text-sm text-slate-600">MACD</div>
      </div>

      {/* Trend */}
      <div className="col-span-1 flex justify-center">{trendBadge(ticker.trend)}</div>

      {/* AI Score */}
      <div className="col-span-2">
        <div className="flex items-center justify-between mb-0.5">
          <span className={`text-sm font-bold ${
            ticker.aiScore > 0 ? "text-emerald-400" : ticker.aiScore < 0 ? "text-rose-400" : "text-slate-500"
          }`}>{ticker.aiScore > 0 ? "+" : ""}{ticker.aiScore}/7</span>
        </div>
        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${ss.bar}`}
            style={{ width: `${Math.abs(ticker.aiScore) / 7 * 100}%` }} />
        </div>
      </div>

      {/* Signal */}
      <div className="col-span-2 flex justify-center">
        <span className={`px-2 py-0.5 rounded-full text-sm font-bold border ${ss.bg} ${ss.border} ${ss.text}`}>
          {ticker.signal.replace("_", " ")}
        </span>
      </div>
    </div>
  );
}

// ─── Signal Card (Cards view) ──────────────────────────────────────────────────
function SigCard({ sig, rank, onSelect }: { sig: LiveSignal; rank: number; onSelect: (sym: string) => void }) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(sig.price);

  useEffect(() => {
    if (sig.price !== prev.current) {
      setFlash(true);
      prev.current = sig.price;
      const t = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [sig.price]);

  const meta = COIN[sig.symbol] ?? { name: sig.symbol, icon: "●", color: "#888" };
  const ss   = sigStyle(sig.signal);
  const isUp = sig.changePct >= 0;

  return (
    <PremiumCard hoverGlow onClick={() => onSelect(sig.symbol)} className={`relative ${ss.bg} border ${ss.border} cursor-pointer transition-all duration-300 ${flash ? "ring-1 ring-white/20" : ""}`}>
      <div className="p-4">

      <div className="absolute top-3 right-3 text-sm text-slate-600">#{rank}</div>

      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-base font-bold shrink-0"
          style={{ background: meta.color + "22", color: meta.color }}>
          {meta.icon}
        </div>
        <div>
          <div className="text-sm font-bold text-white">{sig.symbol.replace("USDT", "")}</div>
          <div className="text-sm text-slate-400">{meta.name}</div>
        </div>
      </div>

      <div className="text-xl font-bold text-white mb-0.5">
        {fmt(sig.price, sig.symbol)}
      </div>
      <div className={`text-sm mb-3 ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
        {pct(sig.changePct)} 24h
      </div>

      {/* Signal badge */}
      <span className={`inline-block px-2.5 py-1 rounded-full text-sm font-bold border mb-3
        ${ss.bg} ${ss.border} ${ss.text}`}>
        {sig.signal.replace("_", " ")}
      </span>

      {/* Indicators */}
      <div className="grid grid-cols-3 gap-1 mb-3">
        <div className="bg-black/20 rounded-lg p-2 text-center">
          <div className={`text-sm font-bold ${rsiColor(sig.rsi)}`}>{sig.rsi.toFixed(0)}</div>
          <div className="text-sm text-slate-500">RSI</div>
        </div>
        <div className="bg-black/20 rounded-lg p-2 text-center">
          <div className={`text-sm font-bold ${sig.macd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {sig.macd >= 0 ? "+" : ""}
            {Math.abs(sig.macd) < 0.001 ? sig.macd.toExponential(1) : sig.macd.toFixed(2)}
          </div>
          <div className="text-sm text-slate-500">MACD</div>
        </div>
        <div className="bg-black/20 rounded-lg p-2 text-center">
          <div className={`text-sm font-bold ${
            sig.aiScore > 0 ? "text-emerald-400" : sig.aiScore < 0 ? "text-rose-400" : "text-slate-400"
          }`}>{sig.aiScore > 0 ? "+" : ""}{sig.aiScore}</div>
          <div className="text-sm text-slate-500">AI</div>
        </div>
      </div>

      {/* Strength bar */}
      <div>
        <div className="flex justify-between text-sm text-slate-500 mb-1">
          <span>Strength</span><span>{sig.strength.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${ss.bar}`}
            style={{ width: `${sig.strength}%` }} />
        </div>
      </div>

      {/* Trend + timestamp */}
      <div className="flex items-center justify-between mt-2.5">
        {trendBadge(sig.trend)}
        <span className="text-sm text-slate-600">{ago(sig.ts)}</span>
      </div>
    </div>
    </PremiumCard>
  );
}

// ─── Market Mood ───────────────────────────────────────────────────────────────
function MarketMood({ mood, signals }: { mood: number; signals: LiveSignal[] }) {
  const pctPos = ((mood + 7) / 14) * 100;
  const label  = mood >= 4 ? "EXTREME GREED" : mood >= 2 ? "GREED" :
                 mood <= -4 ? "EXTREME FEAR"  : mood <= -1 ? "FEAR" : "NEUTRAL";
  const col    = mood >= 3 ? "from-emerald-500 to-green-400" :
                 mood >= 0 ? "from-yellow-500 to-green-500"  :
                 mood >= -3 ? "from-orange-500 to-red-500"   :
                              "from-red-700 to-rose-500";

  const buys  = signals.filter(s => s.signal.includes("BUY")).length;
  const sells = signals.filter(s => s.signal.includes("SELL")).length;
  const holds = signals.filter(s => s.signal === "HOLD").length;

  return (
    <div className="bg-slate-800/60 border border-white/5 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-white">Market Mood</span>
        <span className={`text-sm font-bold px-2.5 py-1 rounded-full border ${
          mood >= 2 ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" :
          mood <= -2 ? "bg-red-500/20 border-red-500/40 text-rose-300" :
                       "bg-yellow-500/20 border-yellow-500/40 text-yellow-300"
        }`}>{label}</span>
      </div>

      <div className="h-4 bg-slate-900 rounded-full overflow-hidden mb-2 border border-white/5">
        <div className={`h-full rounded-full bg-gradient-to-r ${col} transition-all duration-1000`}
          style={{ width: `${Math.max(4, Math.min(96, pctPos))}%` }} />
      </div>
      <div className="flex justify-between text-sm text-slate-500 mb-4">
        <span>😨 FEAR</span>
        <span className="text-white font-bold">{mood > 0 ? "+" : ""}{mood.toFixed(2)}/7</span>
        <span>🤑 GREED</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="text-center bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
          <div className="text-emerald-300 text-xl font-bold">{buys}</div>
          <div className="text-sm text-slate-500 mt-0.5">BUY</div>
        </div>
        <div className="text-center bg-slate-700/20 border border-gray-600/20 rounded-xl p-3">
          <div className="text-slate-400 text-xl font-bold">{holds}</div>
          <div className="text-sm text-slate-500 mt-0.5">HOLD</div>
        </div>
        <div className="text-center bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <div className="text-rose-300 text-xl font-bold">{sells}</div>
          <div className="text-sm text-slate-500 mt-0.5">SELL</div>
        </div>
      </div>
    </div>
  );
}

// ─── Mini signal panel (Top Buys / Top Sells) ──────────────────────────────────
function MiniPanel({ title, items, color }: {
  title: string; items: LiveSignal[]; color: "green" | "red";
}) {
  const cls = color === "green"
    ? { hdr: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", tag: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" }
    : { hdr: "text-rose-400",     bg: "bg-red-500/10",     border: "border-red-500/20",     tag: "bg-red-500/20 text-rose-300 border-red-500/30" };

  return (
    <div className="bg-slate-800/60 border border-white/5 rounded-xl p-4">
      <div className={`text-sm font-bold mb-3 ${cls.hdr}`}>{title}</div>
      {items.length === 0
        ? <p className="text-sm text-slate-600 italic">No signals yet…</p>
        : items.slice(0, 3).map(s => (
          <div key={s.symbol} className="flex items-center justify-between py-2 border-b border-white/5/40 last:border-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">{s.symbol.replace("USDT", "")}</span>
              <span className={`text-sm px-1.5 py-0.5 rounded border ${cls.tag}`}>
                {s.signal.replace("_", " ")}
              </span>
            </div>
            <div className="text-right">
              <div className="text-sm text-white">{fmt(s.price, s.symbol)}</div>
              <div className={`text-sm ${color === "green" ? "text-emerald-400" : "text-rose-400"}`}>
                AI: {s.aiScore > 0 ? "+" : ""}{s.aiScore}/7
              </div>
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ─── Heatmap Cell ─────────────────────────────────────────────────────────────
function HeatCell({ t, onSelect }: { t: LiveTicker; onSelect: (sym: string) => void }) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(t.price);
  useEffect(() => {
    if (t.price !== prev.current) {
      setFlash(true);
      prev.current = t.price;
      setTimeout(() => setFlash(false), 500);
    }
  }, [t.price]);

  const meta      = COIN[t.symbol] ?? { name: t.symbol, icon: "●", color: "#888" };
  const intensity = Math.min(Math.abs(t.changePct) / 5, 1);
  const isBull    = t.changePct >= 0;
  const ss        = sigStyle(t.signal);

  return (
    <div
      onClick={() => onSelect(t.symbol)}
      className={`relative rounded-xl p-4 border ${ss.border} cursor-pointer
        hover:scale-[1.03] transition-all duration-300 ${flash ? "ring-1 ring-white/20" : ""}`}
      style={{
        background: isBull
          ? `rgba(16, 185, 129, ${0.05 + intensity * 0.3})`
          : `rgba(239, 68, 68, ${0.05 + intensity * 0.3})`,
      }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-bold text-white">{t.symbol.replace("USDT", "")}</div>
          <div className="text-sm text-slate-400">{meta.name}</div>
        </div>
        <span className="text-lg" style={{ color: meta.color }}>{meta.icon}</span>
      </div>
      <div className="text-base font-bold text-white">{fmt(t.price, t.symbol)}</div>
      <div className={`text-sm font-bold ${isBull ? "text-emerald-300" : "text-rose-300"}`}>
        {pct(t.changePct)}
      </div>
      <div className={`mt-2 text-sm font-bold ${ss.text}`}>
        {t.signal.replace("_", " ")}
      </div>
      <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
        <span>RSI {t.rsi.toFixed(0)}</span>
        <span>·</span>
        <span>AI {t.aiScore > 0 ? "+" : ""}{t.aiScore}</span>
      </div>
      {flash && (
        <div className="absolute inset-0 rounded-xl pointer-events-none"
          style={{ background: isBull ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }} />
      )}
    </div>
  );
}

// ─── Stats Bar ─────────────────────────────────────────────────────────────────
function StatsBar({ tickers }: { tickers: LiveTicker[] }) {
  const gainers = tickers.filter(t => t.changePct > 0).length;
  const losers  = tickers.filter(t => t.changePct < 0).length;
  const avgRsi  = tickers.length ? tickers.reduce((s, t) => s + t.rsi, 0) / tickers.length : 50;
  const topGain = tickers.reduce((best, t) => t.changePct > best.changePct ? t : best, tickers[0]);
  const topLoss = tickers.reduce((worst, t) => t.changePct < worst.changePct ? t : worst, tickers[0]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: "Gainers / Losers", value: `${gainers} ▲ / ${losers} ▼`, color: "text-emerald-400" },
        { label: "Avg RSI", value: avgRsi.toFixed(1), color: avgRsi > 65 ? "text-rose-400" : avgRsi < 35 ? "text-emerald-400" : "text-yellow-400" },
        { label: "Top Gainer", value: topGain ? `${topGain.symbol.replace("USDT","")} ${pct(topGain.changePct)}` : "—", color: "text-emerald-400" },
        { label: "Top Loser",  value: topLoss ? `${topLoss.symbol.replace("USDT","")} ${pct(topLoss.changePct)}` : "—", color: "text-rose-400" },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-slate-800/60 border border-white/5 rounded-xl px-4 py-3">
          <div className="text-sm text-slate-500 mb-1">{label}</div>
          <div className={`text-sm font-bold ${color}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function LiveSignals() {
  const {
    tickers, signals, topBuys, topSells,
    streamStatus, wsConnected, lastUpdate,
    marketMood, tickTotal, source, wsStats,
  } = useLiveSignals();

  const [view,        setView]       = useState<"cards" | "table" | "heatmap">("cards");
  const [filter,      setFilter]     = useState<"all" | "buy" | "sell" | "hold">("all");
  const [selectedSym, setSelectedSym] = useState<string | null>(null);

  const filtered = signals.filter(s => {
    if (filter === "buy")  return s.signal.includes("BUY");
    if (filter === "sell") return s.signal.includes("SELL");
    if (filter === "hold") return s.signal === "HOLD";
    return true;
  });

  const filteredTickers = tickers.filter(t => {
    if (filter === "buy")  return t.signal.includes("BUY");
    if (filter === "sell") return t.signal.includes("SELL");
    if (filter === "hold") return t.signal === "HOLD";
    return true;
  });

  return (
    <div className="space-y-4 pb-6">

      {/* ── Ticker Tape ───────────────────────────────────────────────────── */}
      {tickers.length > 0 && <TickerTape tickers={tickers} />}

      {/* ── Connection Info ────────────────────────────────────────────────── */}
      <ConnectionInfo source={source} wsConnected={wsConnected} />

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            📡 Live Signals
            {wsConnected && (
              <span className="text-sm font-normal px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
                ⚡ LIVE
              </span>
            )}
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {source === "gateio-ws"
              ? "Real-time WebSocket feed · RSI(14) · MACD(12,26) · EMA(20,50) · aiScore"
              : source === "gateio-rest"
              ? "REST API feed · refreshing every 3s · RSI(14) · MACD(12,26) · EMA(20,50)"
              : "Live simulation · connecting to WebSocket feed…"}
          </p>
        </div>
        <StatusBadge
          status={streamStatus}
          wsConnected={wsConnected}
          lastUpdate={lastUpdate}
          tickTotal={tickTotal}
        />
      </div>

      {/* ── Stats Bar ─────────────────────────────────────────────────────── */}
      <StatsBar tickers={tickers} />

      {/* ── WS Reconnect Health Panel ──────────────────────────────────────── */}
      <WsReconnectPanel stats={wsStats} status={streamStatus} />

      {/* ── Market Mood + Top panels ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MarketMood mood={marketMood} signals={signals} />
        <MiniPanel title="🟢 Top Buy Signals"  items={topBuys}  color="green" />
        <MiniPanel title="🔴 Top Sell Signals" items={topSells} color="red" />
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">

        {/* Filter tabs */}
        <div className="flex gap-1 bg-slate-900 border border-white/5 rounded-xl p-1">
          {(["all", "buy", "sell", "hold"] as const).map(f => {
            const count = f === "all"  ? signals.length :
                          f === "buy"  ? topBuys.length :
                          f === "sell" ? topSells.length :
                          signals.filter(s => s.signal === "HOLD").length;
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  filter === f
                    ? f === "buy"  ? "bg-emerald-600 text-white shadow" :
                      f === "sell" ? "bg-red-600 text-white shadow" :
                      "bg-blue-600 text-white shadow"
                    : "text-slate-400 hover:text-gray-200"
                }`}>
                {f.toUpperCase()}
                <span className="ml-1 opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        {/* View toggle */}
        <div className="flex gap-1 bg-slate-900 border border-white/5 rounded-xl p-1">
          {(["cards", "table", "heatmap"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                view === v ? "bg-purple-600 text-white shadow" : "text-slate-400 hover:text-gray-200"
              }`}>
              {v === "cards" ? "🃏 Cards" : v === "table" ? "📋 Table" : "🟥 Heatmap"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Cards View ────────────────────────────────────────────────────── */}
      {view === "cards" && (
        filtered.length === 0
          ? <div className="text-center py-16 text-slate-500">No signals for this filter</div>
          : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {filtered.map((sig, i) => <SigCard key={sig.symbol} sig={sig} rank={i + 1} onSelect={setSelectedSym} />)}
            </div>
      )}

      {/* ── Table View ────────────────────────────────────────────────────── */}
      {view === "table" && (
        <div className="bg-slate-900 border border-white/5 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-1 px-4 py-2.5 bg-slate-800/80 border-b border-white/5
            text-[13px] font-bold text-slate-500 font-bold uppercase tracking-wider">
            <div className="col-span-3">Coin</div>
            <div className="col-span-2 text-right">Price / 24h</div>
            <div className="col-span-1 text-center">RSI</div>
            <div className="col-span-1 text-center">MACD</div>
            <div className="col-span-1 text-center">Trend</div>
            <div className="col-span-2">AI Score</div>
            <div className="col-span-2 text-center">Signal</div>
          </div>
          {filteredTickers.length === 0
            ? <div className="text-center py-12 text-slate-500 text-sm">No coins match this filter</div>
            : filteredTickers.map((t, i) => <TickerRow key={t.symbol} ticker={t} rank={i + 1} onSelect={setSelectedSym} />)
          }
        </div>
      )}

      {/* ── Heatmap View ──────────────────────────────────────────────────── */}
      {view === "heatmap" && (
        filteredTickers.length === 0
          ? <div className="text-center py-16 text-slate-500">No coins match this filter</div>
          : <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {filteredTickers.map(t => <HeatCell key={t.symbol} t={t} onSelect={setSelectedSym} />)}
            </div>
      )}

      {/* ── Signal detail drawer ──────────────────────────────────────────── */}
      {selectedSym && (
        <SignalDetailDrawer
          sym={selectedSym}
          tickers={tickers}
          signals={signals}
          onClose={() => setSelectedSym(null)}
        />
      )}

      {/* ── Data flow footer ──────────────────────────────────────────────── */}
      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-slate-500 font-semibold mb-1">Data Source</div>
            <div className="text-white text-sm">
              {source === "gateio-ws"
                ? "⚡ Public WebSocket → direct browser"
                : source === "gateio-rest"
                ? "🟡 Public REST → direct browser"
                : "🟠 Simulated (WS connecting)"}
            </div>
          </div>
          <div>
            <div className="text-slate-500 font-semibold mb-1">Refresh Rate</div>
            <div className="text-white text-sm">
              {source === "gateio-ws"
                ? "⚡ ~1s per symbol (push)"
                : source === "gateio-rest"
                ? "🕐 Every 3s (poll)"
                : "🎭 Every 1.5s (sim)"}
            </div>
          </div>
          <div>
            <div className="text-slate-500 font-semibold mb-1">Indicators</div>
            <div className="text-white text-sm">RSI(14) · MACD(12,26) · EMA(20,50)</div>
          </div>
          <div>
            <div className="text-slate-500 font-semibold mb-1">AI Score</div>
            <div className="text-white text-sm">aiScore(−7→+7) · computed in browser</div>
          </div>
        </div>
      </div>

    </div>
  );
}
