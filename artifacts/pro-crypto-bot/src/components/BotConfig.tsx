/**
 * BotConfig — Unified Bot Control Center
 *
 * Connects directly to the Node.js server bot via useBotServer (lifted to App.tsx).
 * Flow:
 *   Start Bot → POST /api/config (save) → POST /api/start → in-memory bot active
 *   Stop  Bot → POST /api/stop → UI status updates
 *
 * Dashboard / Signals / Portfolio / Analytics read isBotRunning from App.tsx
 * which is sourced from serverBot.status.isRunning (server truth).
 */

import { useState, useEffect, useRef } from "react";
import AtrHealthBadge from "./AtrHealthBadge";
import { BotOperationsConsole } from "./BotOperationsConsole";
import type {
  ServerStatus,
  ServerLogEntry,
  ConnectionState,
  ServerConfig,
} from "../hooks/useBotServer";
import { StrategySignalPanel } from "./StrategySignalPanel";
import { PortfolioPanel }      from "./PortfolioPanel";
import { RiskDashboard }       from "./RiskDashboard";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";

// ─── Strategy presets ─────────────────────────────────────────────────────────
const STRATEGIES = [
  { id: "active-swing",          label: "Active Swing",          icon: "🚀", desc: "Trend-following · 4h",    sl: 0.012, tp: 0.020, tickMs: 60_000 },
  { id: "conservative-scalping", label: "Conservative Scalping", icon: "🎯", desc: "Triple-EMA, 15m candles", sl: 0.006, tp: 0.010, tickMs: 30_000 },
  { id: "scalping",              label: "Scalping",              icon: "⚡", desc: "Fast, 5s ticks",          sl: 0.008, tp: 0.012, tickMs: 5_000  },
  { id: "day-trading",           label: "Day Trading",           icon: "📊", desc: "Intraday, 15s",           sl: 0.015, tp: 0.025, tickMs: 15_000 },
  { id: "swing",                 label: "Swing",                 icon: "🌊", desc: "1–7 days, 60s",           sl: 0.030, tp: 0.060, tickMs: 60_000 },
  { id: "dca",                   label: "DCA Bot",               icon: "🔄", desc: "Interval buy, 30s",       sl: 0.020, tp: 0.040, tickMs: 30_000 },
  { id: "grid",                  label: "Grid Trading",          icon: "📐", desc: "Grid range, 10s",         sl: 0.010, tp: 0.020, tickMs: 10_000 },
] as const;

// ─── Pairs ────────────────────────────────────────────────────────────────────
const PAIRS = [
  { id: "BTCUSDT", label: "BTC/USDT" },
  { id: "ETHUSDT", label: "ETH/USDT" },
  { id: "SOLUSDT", label: "SOL/USDT" },
  { id: "BNBUSDT", label: "BNB/USDT" },
  { id: "XRPUSDT", label: "XRP/USDT" },
];

// ─── Risk presets ─────────────────────────────────────────────────────────────
const RISK_PRESETS = {
  low:    { stopLoss: 0.008, takeProfit: 0.015, orderSizeUsdt: 20 },
  medium: { stopLoss: 0.015, takeProfit: 0.025, orderSizeUsdt: 50 },
  high:   { stopLoss: 0.030, takeProfit: 0.050, orderSizeUsdt: 100 },
} as const;

// ─── AddSymbolInput mini-component ───────────────────────────────────────────
function AddSymbolInput({ onAdd }: { onAdd: (sym: string) => void }) {
  const [val, setVal] = useState("");
  const commit = () => {
    const trimmed = val.trim().toUpperCase();
    if (trimmed) { onAdd(trimmed); setVal(""); }
  };
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        placeholder="BTC_USDT"
        className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-cyan-500"
      />
      <button
        type="button"
        onClick={commit}
        className="px-2 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-bold hover:bg-cyan-500/30 transition-colors"
      >
        +
      </button>
    </div>
  );
}

// ─── Local form state ─────────────────────────────────────────────────────────
interface FormState {
  strategy:            string;
  symbol:              string;
  symbolSelectionMode: "manual" | "auto";
  approvedSymbols:     string[];
  minimumMarketScore:  number;
  scanIntervalMinutes: number;
  orderSizeUsdt:       number;
  riskLevel:           "low" | "medium" | "high";
  stopLoss:            number;
  takeProfit:          number;
  tickMs:              number;
  maxDailyLoss:        number;
  dryRun:              boolean;
  positionSizeMode:     "fixed_usdt" | "pct_portfolio" | "auto_risk";
  fixedSizeUsdt:        number;
  portfolioSizePct:     number;
  riskPerTradePct:      number;
  takeProfitMode:       "strategy" | "fixed_pct" | "atr_multiple" | "risk_reward";
  fixedTpPct:            number;
  tpAtrMultiple:        number;
  tpRiskReward:         number;
  stopLossMode:         "strategy" | "fixed_pct" | "atr";
  fixedSlPct:            number;
  slAtrMultiple:        number;
  maxOpenPositions:     number;
  maxPositionSizePct:   number;
  maxTradesPerDay:      number;
  tradeCooldownMs:      number;
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface BotConfigViewProps {
  status:         ServerStatus;
  logs:           ServerLogEntry[];
  connection:     ConnectionState;
  error:          string | null;
  onStart:        (cfg?: ServerConfig) => Promise<{ ok: boolean; [k: string]: unknown }>;
  onStop:         () => Promise<{ ok: boolean; [k: string]: unknown }>;
  onUpdateConfig: (cfg: ServerConfig) => Promise<{ ok: boolean; [k: string]: unknown }>;
}

// ─── Log color helper ─────────────────────────────────────────────────────────
function logColor(l: ServerLogEntry) {
  if (l.level === "TRADE") return "text-green-400 font-bold";
  if (l.level === "ERROR") return "text-red-400";
  if (l.level === "WARN")  return "text-yellow-400";
  if (l.level === "INFO")  return "text-blue-300";
  return "text-gray-500";
}

// ─── Uptime formatter ─────────────────────────────────────────────────────────
function fmtUptime(s: number) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ─── Main component ───────────────────────────────────────────────────────────
export function BotConfigView({
  status,
  logs = [],
  connection,
  error,
  onStart,
  onStop,
  onUpdateConfig,
}: BotConfigViewProps) {

  const [form, setForm] = useState<FormState>({
    strategy:            "active-swing",
    symbol:              "BTCUSDT",
    symbolSelectionMode: "manual",
    approvedSymbols:     ["BTC_USDT", "ETH_USDT", "SOL_USDT", "BNB_USDT"],
    minimumMarketScore:  67,
    scanIntervalMinutes: 15,
    orderSizeUsdt:       25,
    riskLevel:           "medium",
    stopLoss:            0.009,
    takeProfit:          0.010,
    tickMs:              5_000,
    maxDailyLoss:        -50,
    dryRun:              true,
    positionSizeMode:     "fixed_usdt",
    fixedSizeUsdt:        25,
    portfolioSizePct:     0.02,
    riskPerTradePct:      0.01,
    takeProfitMode:       "fixed_pct",
    fixedTpPct:            0.010,
    tpAtrMultiple:         3,
    tpRiskReward:          2,
    stopLossMode:          "fixed_pct",
    fixedSlPct:            0.009,
    slAtrMultiple:         1.5,
    maxOpenPositions:     2,
    maxPositionSizePct:   0.10,
    maxTradesPerDay:      20,
    tradeCooldownMs:      30000,
  });

  const [busy,       setBusy]       = useState(false);
  const [saveMsg,    setSaveMsg]    = useState<{ ok: boolean; text: string } | null>(null);
  const [streamLogs, setStreamLogs] = useState<ServerLogEntry[]>([]);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const sseRef     = useRef<EventSource | null>(null);

  // ── Hydrate form from live server config when it arrives ──────────────────
  useEffect(() => {
    const cfg = status?.config;
    if (!cfg) return;
    setForm((f) => ({
      ...f,
      strategy:            cfg.strategy             ?? f.strategy,
      symbol:              cfg.symbol               ?? f.symbol,
      stopLoss:            cfg.stopLoss             ?? f.stopLoss,
      takeProfit:          cfg.takeProfit           ?? f.takeProfit,
      tickMs:              cfg.tickMs               ?? f.tickMs,
      maxDailyLoss:        cfg.maxDailyLoss         ?? f.maxDailyLoss,
      dryRun:              cfg.testMode             ?? f.dryRun,
      symbolSelectionMode: cfg.symbolSelectionMode  ?? f.symbolSelectionMode,
      approvedSymbols:     cfg.approvedSymbols       ?? f.approvedSymbols,
      minimumMarketScore:  (status?.scanner?.minimumMarketScore ?? (status?.scanner?.minimumScore ?? f.minimumMarketScore)),
      scanIntervalMinutes: status?.scanner?.scanIntervalMinutes ?? f.scanIntervalMinutes,
    }));
  // Re-hydrate when strategy, symbol, or scanner mode changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status?.config?.strategy,
    status?.config?.symbol,
    status?.config?.symbolSelectionMode,
    status?.tradingParams?.positionSizeMode,
    status?.tradingParams?.fixedSizeUsdt,
    status?.tradingParams?.portfolioSizePct,
    status?.tradingParams?.riskPerTradePct,
    status?.tradingParams?.takeProfitMode,
    status?.tradingParams?.fixedTpPct,
    status?.tradingParams?.tpAtrMultiple,
    status?.tradingParams?.tpRiskReward,
    status?.tradingParams?.stopLossMode,
    status?.tradingParams?.fixedSlPct,
    status?.tradingParams?.slAtrMultiple,
    status?.tradingParams?.maxOpenPositions,
    status?.tradingParams?.maxPositionSizePct,
    status?.tradingParams?.maxTradesPerDay,
    status?.tradingParams?.tradeCooldownMs,
  ]);

  // ── SSE log stream ────────────────────────────────────────────────────────
  useEffect(() => {
    // Seed with any existing logs from the REST poll (reversed: oldest→newest)
    if (logs.length > 0) {
      setStreamLogs([...logs].reverse());
    }

    const es = new EventSource("/api/bot/logs/stream");
    sseRef.current = es;

    es.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as
          | { type: "init"; logs: ServerLogEntry[] }
          | { type: "log";  entry: ServerLogEntry };

        if (msg.type === "init") {
          // Replace with full backlog from server (oldest→newest for scroll)
          setStreamLogs([...msg.logs].reverse());
        } else if (msg.type === "log") {
          setStreamLogs((prev) => {
            const next = [...prev, msg.entry];
            return next.length > 500 ? next.slice(next.length - 500) : next;
          });
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // Browser will auto-reconnect; no action needed
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll console to bottom on new log entries ──────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streamLogs]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const pickStrategy = (id: string) => {
    const p = STRATEGIES.find((s) => s.id === id);
    if (p) setForm((f) => ({ ...f, strategy: id, stopLoss: p.sl, takeProfit: p.tp, tickMs: p.tickMs }));
  };

  const pickRisk = (r: "low" | "medium" | "high") =>
    setForm((f) => ({ ...f, riskLevel: r, ...RISK_PRESETS[r] }));

  const buildCfg = (): ServerConfig => ({
    symbol:              form.symbol,
    takeProfit:          form.takeProfit,
    stopLoss:            form.stopLoss,
    maxDailyLoss:        form.maxDailyLoss,
    orderSizeUsdt:       form.orderSizeUsdt,
    tickMs:              form.tickMs,
    dryRun:              form.dryRun,
    testMode:            form.dryRun,
    strategy:            form.strategy,
    symbolSelectionMode: form.symbolSelectionMode,
    approvedSymbols:     form.approvedSymbols,
    minimumMarketScore:  form.minimumMarketScore,
    scanIntervalMinutes: form.scanIntervalMinutes,
    // Phase 14 — these values are consumed by the same tradingParamsService
    // that resolves every real/paper entry. No UI-only settings.
    positionSizeMode:     form.positionSizeMode,
    fixedSizeUsdt:        form.fixedSizeUsdt,
    portfolioSizePct:     form.portfolioSizePct,
    riskPerTradePct:      form.riskPerTradePct,
    takeProfitMode:       form.takeProfitMode,
    fixedTpPct:            form.fixedTpPct,
    tpAtrMultiple:        form.tpAtrMultiple,
    tpRiskReward:         form.tpRiskReward,
    stopLossMode:         form.stopLossMode,
    fixedSlPct:            form.fixedSlPct,
    slAtrMultiple:        form.slAtrMultiple,
    maxOpenPositions:     form.maxOpenPositions,
    maxPositionSizePct:   form.maxPositionSizePct,
    maxTradesPerDay:      form.maxTradesPerDay,
    tradeCooldownMs:      form.tradeCooldownMs,
  });

  const flash = (ok: boolean, text: string, ms = 6000) => {
    setSaveMsg({ ok, text });
    setTimeout(() => setSaveMsg(null), ms);
  };

  // ── Start: save config → start bot ──────────────────────────────────────
  const handleStart = async () => {
    setBusy(true);
    setSaveMsg({ ok: true, text: "⏳ Saving config & starting bot…" });
    try {
      await onUpdateConfig(buildCfg());
      const res = await onStart(buildCfg());
      if (res?.ok) {
        const strat = STRATEGIES.find((s) => s.id === form.strategy)?.label ?? form.strategy;
        const symDisplay = form.symbolSelectionMode === "auto" ? "Auto Mode 🔍" : form.symbol;
        flash(true, `✅ Bot started — ${strat} on ${symDisplay}`);
      } else {
        flash(false, `❌ ${String(res?.error ?? "Start failed")}`);
      }
    } catch (err) {
      flash(false, `❌ ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setBusy(false);
    }
  };

  // ── Stop bot ──────────────────────────────────────────────────────────────
  const handleStop = async () => {
    setBusy(true);
    try {
      await onStop();
      flash(true, "⛔ Bot stopped", 4000);
    } catch {
      flash(false, "❌ Stop failed", 4000);
    } finally {
      setBusy(false);
    }
  };

  // ── Save config without starting ──────────────────────────────────────────
  const handleSaveOnly = async () => {
    setBusy(true);
    try {
      const res = await onUpdateConfig(buildCfg());
      flash(res?.ok ? true : false,
        res?.ok ? "✅ Config saved to server" : `❌ ${String(res?.error ?? "Save failed")}`);
    } catch {
      flash(false, "❌ Save failed");
    } finally {
      setBusy(false);
    }
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const isRunning = status?.isRunning  ?? false;
  const keysReady = status?.keysReady  ?? (status?.hasApiKey && status?.hasSecret);
  const offline   = connection !== "connected";

  // Prefer the engine name confirmed by the server when bot is running
  const activeStratLabel = isRunning && status?.activeEngine
    ? status.activeEngine.replace("Strategy", " Strategy")
    : (STRATEGIES.find((s) => s.id === form.strategy)?.label ?? form.strategy);

  return (
    <div className="space-y-5">
      {/* Phase 14 premium command header */}
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950/30 p-6 shadow-2xl shadow-cyan-950/20">
        <div className="absolute -top-20 -right-20 h-48 w-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-cyan-400 text-xs font-black uppercase tracking-[0.25em]">Professional Execution Suite</span>
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">Bot Control Center</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Configure strategy, position sizing, risk limits, and SL/TP execution from one authoritative control layer.
            </p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 min-w-[280px] sm:min-w-[420px]">
            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Status</p>
              <p className={`mt-1 text-xs font-black flex items-center gap-1.5 ${
                status.isKilled ? "text-rose-400" : status.isRunning ? "text-emerald-400" : "text-slate-400"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  status.isKilled ? "bg-rose-400" : status.isRunning ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                }`} />
                {status.isKilled ? "HALTED" : status.isRunning ? "RUNNING" : "PAUSED"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Exchange</p>
              <p className={`mt-1 text-xs font-black ${connection === "connected" ? "text-emerald-400" : connection === "connecting" ? "text-amber-400" : "text-rose-400"}`}>
                {connection === "connected" ? "Gate.io ✓" : connection === "connecting" ? "Connecting…" : "Offline"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Mode</p>
              <p className={`mt-1 text-xs font-black ${status.dryRun ? "text-blue-300" : "text-rose-300"}`}>{status.dryRun ? "📄 PAPER" : "🔴 LIVE"}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Today's P&amp;L</p>
              <p className={`mt-1 text-xs font-black ${status.dailyPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {status.dailyPnL >= 0 ? "+" : ""}{status.dailyPnL.toFixed(2)}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Positions</p>
              <p className="mt-1 text-xs font-black text-white">{status.position ? "1" : "0"} / {form.maxOpenPositions} max</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Sizing</p>
              <p className="mt-1 text-xs font-black text-cyan-400">{form.positionSizeMode === "fixed_usdt" ? `$${form.fixedSizeUsdt}` : form.positionSizeMode === "pct_portfolio" ? `${(form.portfolioSizePct*100).toFixed(1)}%` : "AUTO"}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Balance</p>
              <p className="mt-1 text-xs font-black text-white">${status.balanceUSDT ? status.balanceUSDT.toFixed(2) : "—"}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Symbol</p>
              <p className="mt-1 text-xs font-black text-white">{status.symbol || "—"}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">

      {/* ── Left + center: controls ─────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">

        {/* ── Server offline banner ──────────────────────────────────────────── */}
        {offline && (
          <div className={`rounded-xl border p-4 flex items-center gap-3 ${
            connection === "connecting"
              ? "border-yellow-500/30 bg-yellow-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}>
            {connection === "connecting"
              ? <span className="w-4 h-4 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin shrink-0" />
              : <span className="text-xl shrink-0">🔌</span>}
            <div>
              <p className={`font-bold text-sm ${connection === "connecting" ? "text-yellow-400" : "text-red-400"}`}>
                {connection === "connecting" ? "Connecting to bot server…" : "Bot server offline"}
              </p>
              <p className="text-gray-400 text-xs mt-0.5">{error ?? "Cannot reach /api"}</p>
            </div>
          </div>
        )}

        {/* ── Status banner + Start / Stop ──────────────────────────────────── */}
        <div className={`rounded-xl border p-5 ${
          isRunning ? "border-green-500/40 bg-green-500/5" : "border-gray-800 bg-gray-900"
        }`}>
          <div className="flex items-center justify-between gap-4 flex-wrap">

            {/* Left: status text */}
            <div className="flex items-center gap-3 min-w-0">
              <span className={`text-3xl shrink-0 ${isRunning ? "animate-pulse" : ""}`}>🤖</span>
              <div className="min-w-0">

                {/* Badges */}
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="text-white font-bold">
                    {isRunning ? "Bot is RUNNING" : "Bot is STOPPED"}
                  </span>
                  {isRunning && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 border border-green-500/40 text-green-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      LIVE
                    </span>
                  )}
                  {form.dryRun
                    ? <span className="px-2 py-0.5 rounded-full text-xs bg-gray-700 border border-gray-600 text-gray-400">📄 PAPER</span>
                    : <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 border border-green-500/30 text-green-400">💰 LIVE</span>}
                  {!keysReady && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 border border-red-500/40 text-red-400">NO KEYS</span>
                  )}
                  {keysReady && !isRunning && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 border border-yellow-500/30 text-yellow-400">READY</span>
                  )}
                  {/* Phase 12.1: ATR health indicator — only surfaces when degraded */}
                  <AtrHealthBadge warnOnly size="sm" />
                </div>

                {/* Subtitle */}
                <p className="text-gray-500 text-sm truncate">
                  {isRunning
                    ? `${activeStratLabel} · ${status.symbol ?? form.symbol} · tick ${((status.config.tickMs ?? form.tickMs) / 1000).toFixed(0)}s`
                    : "Configure your strategy, then click Start Bot"}
                </p>

                {/* Live price + PnL row */}
                {isRunning && (
                  <p className="text-cyan-400 text-xs mt-1">
                    {status.lastPrice > 0 && `$${status.lastPrice.toLocaleString()} · `}
                    {status.totalTrades} trades · Daily PnL{" "}
                    <span className={status.dailyPnL >= 0 ? "text-green-400" : "text-red-400"}>
                      ${status.dailyPnL.toFixed(2)}
                    </span>
                  </p>
                )}
              </div>
            </div>

            {/* Right: buttons */}
            <div className="flex items-center gap-2 shrink-0">
              {isRunning ? (
                <button
                  onClick={handleStop}
                  disabled={busy || offline}
                  className="px-5 py-2.5 rounded-xl font-bold text-sm transition-all bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 disabled:opacity-40"
                >
                  ⛔ Stop Bot
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={busy || offline || (!keysReady && !form.dryRun)}
                  className="px-6 py-2.5 rounded-xl font-bold text-sm transition-all bg-green-500 text-black hover:bg-green-400 shadow-lg shadow-green-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={!keysReady && !form.dryRun ? "Add API keys to enable live trading" : undefined}
                >
                  {busy ? "⏳ Starting…" : "🚀 Start Bot"}
                </button>
              )}
            </div>
          </div>

          {/* Save / start result message */}
          {saveMsg && (
            <div className={`mt-3 text-sm font-semibold px-3 py-2 rounded-lg ${
              saveMsg.ok ? "bg-green-500/10 border border-green-500/20 text-green-400"
                        : "bg-red-500/10 border border-red-500/20 text-red-400"
            }`}>
              {saveMsg.text}
            </div>
          )}
        </div>

        {/* ── Active strategy display (when running) ─────────────────────────── */}
        {isRunning && (
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-5 py-3 flex items-center gap-3">
            <span className="text-lg">{STRATEGIES.find((s) => s.id === form.strategy)?.icon ?? "🤖"}</span>
            <div>
              <p className="text-cyan-400 text-[13px] font-bold font-bold uppercase tracking-wide">Active Strategy</p>
              <p className="text-white font-semibold">{activeStratLabel}</p>
            </div>
            <div className="ml-auto text-right text-xs text-gray-500 space-y-0.5">
              <div>SL {(form.stopLoss * 100).toFixed(1)}% · TP {(form.takeProfit * 100).toFixed(1)}%</div>
              <div>Tick {(form.tickMs / 1000).toFixed(0)}s · {form.symbol}</div>
            </div>
          </div>
        )}

        {/* ── Strategy selector ──────────────────────────────────────────────── */}
        <PremiumCard hoverGlow>
          <PremiumCardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-white">Trading Strategy</h3>
            <span className="text-xs text-gray-500">Phase 8.5 active: Active Swing + Conservative Scalping</span>
          </div>

          {/* Migration hint: Swing → Active Swing */}
          {form.strategy === "swing" && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5">
              <span className="text-yellow-400 text-sm shrink-0">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-yellow-300 text-sm font-semibold">Swing is disabled in Phase 8.5</p>
                <p className="text-gray-400 text-xs">Switch to <strong className="text-white">Active Swing</strong> for 4h trend-following with 15–25 trades/month.</p>
              </div>
              <button
                type="button"
                onClick={() => pickStrategy("active-swing")}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs font-bold hover:bg-purple-500/30 transition-colors"
              >
                Switch →
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {STRATEGIES.map((s) => {
              const isActive85 = s.id === "active-swing" || s.id === "conservative-scalping";
              const isDisabled85 = s.id === "swing" || s.id === "day-trading" || s.id === "scalping" || s.id === "dca" || s.id === "grid";
              const isSelected = form.strategy === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => pickStrategy(s.id)}
                  className={`text-left p-3 rounded-lg border transition-all relative ${
                    isSelected
                      ? s.id === "active-swing"
                        ? "border-purple-500/60 bg-purple-500/10 text-purple-300"
                        : "border-cyan-500/60 bg-cyan-500/10 text-cyan-400"
                      : isDisabled85
                        ? "border-gray-800 bg-gray-900/50 text-gray-600 hover:border-gray-700 hover:text-gray-500"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                  }`}
                >
                  {isActive85 && (
                    <span className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-xs font-bold ${
                      s.id === "active-swing"
                        ? "bg-purple-500/30 text-purple-300"
                        : "bg-cyan-500/20 text-cyan-400"
                    }`}>
                      ✓ ACTIVE
                    </span>
                  )}
                  {isDisabled85 && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-xs font-bold bg-gray-700 text-gray-500">
                      DISABLED
                    </span>
                  )}
                  <p className="font-semibold text-sm pr-14">{s.icon} {s.label}</p>
                  <p className="text-xs opacity-70 mt-0.5">{s.desc}</p>
                  <p className="text-xs mt-1 opacity-50">
                    SL {(s.sl * 100).toFixed(1)}% / TP {(s.tp * 100).toFixed(1)}%
                  </p>
                  {s.id === "active-swing" && (
                    <p className="text-xs mt-1 text-purple-400/70">15–25 trades/mo</p>
                  )}
                </button>
              );
            })}
          </div>
          </PremiumCardContent>
        </PremiumCard>

        {/* ── Symbol Selection ─────────────────────────────────────────────── */}
        <PremiumCard hoverGlow>
          <PremiumCardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Symbol Selection</h3>
            {form.symbolSelectionMode === "auto" && status?.scanner?.scannerBusy && (
              <span className="flex items-center gap-1.5 text-xs text-cyan-400">
                <span className="w-3 h-3 border border-cyan-400/40 border-t-cyan-400 rounded-full animate-spin" />
                Scanning…
              </span>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex gap-6">
            {(["manual", "auto"] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="symbolMode"
                  value={mode}
                  checked={form.symbolSelectionMode === mode}
                  onChange={() => set("symbolSelectionMode", mode)}
                  className="accent-cyan-500 w-4 h-4"
                />
                <span className={`text-sm font-semibold ${form.symbolSelectionMode === mode ? "text-white" : "text-gray-500"}`}>
                  {mode === "manual" ? "Manual" : "Auto (Scanner)"}
                </span>
              </label>
            ))}
          </div>

          {/* Manual mode: pair buttons */}
          {form.symbolSelectionMode === "manual" && (
            <div className="flex flex-wrap gap-2">
              {PAIRS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => set("symbol", p.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold border transition-all ${
                    form.symbol === p.id
                      ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-400"
                      : "border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Auto mode */}
          {form.symbolSelectionMode === "auto" && (
            <div className="space-y-4">

              {/* Scanner results banner */}
              {status?.scanner?.lastScanAt ? (
                <div className={`rounded-lg border p-4 space-y-2 ${
                  status.scanner.state === "WAITING"
                    ? "border-orange-500/40 bg-orange-500/5"
                    : status.scanner.selectedSymbol
                    ? "border-cyan-500/30 bg-cyan-500/5"
                    : "border-yellow-500/30 bg-yellow-500/5"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[13px] font-bold font-bold uppercase tracking-wide ${
                      status.scanner.state === "WAITING" ? "text-orange-400" : "text-cyan-400"
                    }`}>
                      {status.scanner.state === "WAITING" ? "⏸ Waiting for Market" : "Best Opportunity"}
                    </span>
                    <span className="text-gray-500 text-xs">
                      {new Date(status.scanner.lastScanAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {status.scanner.state === "WAITING" ? (
                    <div className="space-y-2">
                      <p className="text-orange-300 text-sm font-semibold">No market meets the minimum score threshold</p>
                      <div className="flex gap-4 text-xs">
                        <span className="text-gray-400">Best score <span className="text-white font-bold">{status.scanner.bestScore}/100</span></span>
                        <span className="text-gray-400">Minimum <span className="text-orange-400 font-bold">{status.scanner.minimumScore}/100</span></span>
                      </div>
                      {status.scanner.nextScanInMs > 0 && (
                        <p className="text-gray-500 text-xs">
                          Next scan in ~{Math.ceil(status.scanner.nextScanInMs / 60_000)} min
                        </p>
                      )}
                      <p className="text-gray-600 text-xs">Bot is running but holding — no trades will execute until a qualified market is found.</p>
                    </div>
                  ) : status.scanner.selectedSymbol ? (
                    <>
                      <p className="text-white font-bold text-xl">{status.scanner.selectedSymbol}</p>
                      <div className="flex gap-4 text-xs">
                        <span className="text-gray-400">Score <span className="text-white font-bold">{status.scanner.bestScore}/100</span></span>
                        <span className="text-gray-400">Regime <span className="text-emerald-400 font-semibold capitalize">{status.scanner.bestRegime?.replace(/_/g, " ") ?? "—"}</span></span>
                      </div>
                    </>
                  ) : (
                    <p className="text-yellow-400 text-sm font-semibold">No qualified market — all below minimum score</p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-center">
                  <p className="text-gray-500 text-sm">
                    {status?.scanner?.scannerBusy
                      ? "Scanning approved symbols…"
                      : "No scan yet — will run automatically when bot starts"}
                  </p>
                </div>
              )}

              {/* Per-symbol score cards */}
              {status?.scanner?.results && status.scanner.results.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider tracking-wide">Symbol Scores</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {status.scanner.results.map((r) => (
                      <div
                        key={r.symbol}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${
                          r.selected
                            ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                            : r.rejected
                            ? "border-gray-700/40 bg-gray-800/20 text-gray-600"
                            : "border-gray-700 bg-gray-800/60 text-gray-400"
                        }`}
                      >
                        <span className="font-bold">{r.symbol}</span>
                        <span className={r.rejected ? "text-red-400/70 text-xs" : r.selected ? "text-cyan-400 font-bold" : "text-white"}>
                          {r.rejected
                            ? (r.rejectReason?.slice(0, 14) ?? "⛔ reject")
                            : `${r.score}/100${r.selected ? " ✓" : ""}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Minimum Market Score */}
              <div className="space-y-2">
                <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider tracking-wide">Minimum Market Score</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={form.minimumMarketScore}
                    onChange={(e) => set("minimumMarketScore", Math.min(100, Math.max(1, parseInt(e.target.value) || 67)))}
                    className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-gray-500 text-xs">/100</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${
                    form.minimumMarketScore >= 80 ? "bg-red-500/15 border-red-500/30 text-red-400"
                    : form.minimumMarketScore >= 70 ? "bg-yellow-500/15 border-yellow-500/30 text-yellow-400"
                    : "bg-green-500/15 border-green-500/30 text-green-400"
                  }`}>
                    {form.minimumMarketScore >= 80 ? "strict" : form.minimumMarketScore >= 70 ? "balanced" : "permissive"}
                  </span>
                </div>
                <p className="text-gray-600 text-xs">
                  67 balances trade frequency and signal quality. Higher = fewer but stronger signals.
                </p>
              </div>

              {/* Scan Interval */}
              <div className="space-y-2">
                <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider tracking-wide">Scan Interval (minutes)</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    step={1}
                    value={form.scanIntervalMinutes}
                    onChange={(e) => set("scanIntervalMinutes", Math.max(1, parseInt(e.target.value) || 15))}
                    className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-gray-500 text-xs">min</span>
                  {status?.scanner?.nextScanInMs != null && status.scanner.nextScanInMs > 0 && (
                    <span className="text-gray-600 text-xs">
                      next in ~{Math.ceil(status.scanner.nextScanInMs / 60_000)} min
                    </span>
                  )}
                </div>
                <p className="text-gray-600 text-xs">
                  How often the scanner checks approved symbols for opportunities. 15 min is recommended.
                </p>
              </div>

              {/* Approved symbols editor */}
              <div className="space-y-2">
                <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider tracking-wide">Approved Symbols</p>
                <div className="flex flex-wrap gap-2 items-center">
                  {form.approvedSymbols.map((sym) => (
                    <span
                      key={sym}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-gray-300 text-xs"
                    >
                      {sym}
                      <button
                        type="button"
                        onClick={() => set("approvedSymbols", form.approvedSymbols.filter((s) => s !== sym))}
                        className="text-gray-500 hover:text-red-400 transition-colors leading-none"
                        title="Remove"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <AddSymbolInput
                    onAdd={(sym) => {
                      if (!form.approvedSymbols.includes(sym)) {
                        set("approvedSymbols", [...form.approvedSymbols, sym]);
                      }
                    }}
                  />
                </div>
                <p className="text-gray-600 text-xs">Gate.io format: BTC_USDT, ETH_USDT, SOL_USDT, etc.</p>
              </div>
            </div>
          )}
          </PremiumCardContent>
        </PremiumCard>

        {/* ── Phase 14: Execution Authority / Risk & Parameters ───────────────── */}
        <PremiumCard hoverGlow>
          <PremiumCardContent className="p-5 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">🛡️</span>
                  <h3 className="text-lg font-black text-white">Execution Authority</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">Phase 14</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  These settings are enforced by the server execution pipeline, not just displayed in the dashboard.
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-widest text-gray-600 font-bold">Active sizing</p>
                <p className="text-sm font-black text-cyan-400">
                  {form.positionSizeMode === "fixed_usdt" ? `$${form.fixedSizeUsdt.toFixed(2)} fixed` :
                   form.positionSizeMode === "pct_portfolio" ? `${(form.portfolioSizePct * 100).toFixed(1)}% portfolio` :
                   `${(form.riskPerTradePct * 100).toFixed(2)}% risk`}
                </p>
              </div>
            </div>

            {/* Position sizing */}
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 p-4 space-y-4">
              <div>
                <p className="text-sm font-black text-white">Position Sizing</p>
                <p className="text-xs text-gray-600 mt-1">Choose exactly how much capital each new entry may use.</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["fixed_usdt", "💵 Fixed USDT", "Exact amount"],
                  ["pct_portfolio", "📐 % Portfolio", "Balance based"],
                  ["auto_risk", "🧠 Auto Risk", "Risk based"],
                ] as const).map(([id, label, desc]) => (
                  <button key={id} type="button" onClick={() => set("positionSizeMode", id)}
                    className={`p-3 rounded-xl border text-left transition-all ${form.positionSizeMode === id
                      ? "border-cyan-400/70 bg-cyan-400/10 text-cyan-300 shadow-lg shadow-cyan-500/10"
                      : "border-slate-700 bg-slate-900/60 text-gray-400 hover:border-slate-600"}`}>
                    <p className="text-xs font-black">{label}</p><p className="text-[10px] mt-1 opacity-70">{desc}</p>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5">Fixed Position (USDT)</label>
                  <input type="number" min={5} step={1} value={form.fixedSizeUsdt}
                    onChange={e => set("fixedSizeUsdt", Math.max(5, +e.target.value))}
                    disabled={form.positionSizeMode !== "fixed_usdt"}
                    className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold disabled:opacity-40" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5">Portfolio Allocation (%)</label>
                  <input type="number" min={0.1} max={50} step={0.1} value={form.portfolioSizePct * 100}
                    onChange={e => set("portfolioSizePct", Math.max(0.001, +e.target.value / 100))}
                    disabled={form.positionSizeMode !== "pct_portfolio"}
                    className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold disabled:opacity-40" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5">Risk Per Trade (%)</label>
                  <input type="number" min={0.25} max={5} step={0.05} value={form.riskPerTradePct * 100}
                    onChange={e => set("riskPerTradePct", Math.max(0.0025, +e.target.value / 100))}
                    disabled={form.positionSizeMode !== "auto_risk"}
                    className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold disabled:opacity-40" />
                </div>
              </div>
              {(() => {
                const bal = status.balanceUSDT || 0;
                const calcUsdt =
                  form.positionSizeMode === "fixed_usdt" ? form.fixedSizeUsdt :
                  form.positionSizeMode === "pct_portfolio" ? bal * form.portfolioSizePct :
                  bal * form.riskPerTradePct / Math.max(form.fixedSlPct, 0.0001); // auto-risk: risk$ / SL distance
                const riskUsdt =
                  form.positionSizeMode === "auto_risk" ? bal * form.riskPerTradePct : calcUsdt * form.fixedSlPct;
                return (
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-cyan-500/70 font-bold">Calculated Position Size</p>
                      <p className="text-sm font-black text-white mt-0.5">
                        {bal > 0 ? `$${calcUsdt.toFixed(2)} USDT` : "— (balance unavailable)"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-cyan-500/70 font-bold">Risk Amount</p>
                      <p className="text-sm font-black text-white mt-0.5">
                        {bal > 0 ? `$${riskUsdt.toFixed(2)} (${((riskUsdt / Math.max(bal, 1)) * 100).toFixed(2)}% of balance)` : "—"}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* TP / SL authority */}
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 space-y-3">
                <div><p className="text-sm font-black text-white">🎯 Take Profit Authority</p><p className="text-[11px] text-gray-600">Controls the TP used when a new position is opened.</p></div>
                <select value={form.takeProfitMode} onChange={e => set("takeProfitMode", e.target.value as FormState["takeProfitMode"])}
                  className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm font-bold">
                  <option value="fixed_pct">Fixed Percentage</option><option value="strategy">Strategy Suggested</option><option value="atr_multiple">ATR Multiple</option><option value="risk_reward">Risk : Reward</option>
                </select>
                {form.takeProfitMode === "fixed_pct" && <input type="number" min={0.1} step={0.1} value={form.fixedTpPct * 100} onChange={e => set("fixedTpPct", Math.max(0.001, +e.target.value / 100))} placeholder="TP %" className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />}
                {form.takeProfitMode === "atr_multiple" && <input type="number" min={0.5} step={0.1} value={form.tpAtrMultiple} onChange={e => set("tpAtrMultiple", +e.target.value)} placeholder="ATR multiple" className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />}
                {form.takeProfitMode === "risk_reward" && <input type="number" min={0.5} step={0.1} value={form.tpRiskReward} onChange={e => set("tpRiskReward", +e.target.value)} placeholder="R:R multiple" className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />}
                {status.lastPrice > 0 && form.takeProfitMode === "fixed_pct" && (
                  <p className="text-[11px] text-emerald-400/80 font-bold">
                    Calculated TP price @ current {status.symbol || "price"}: ${(status.lastPrice * (1 + form.fixedTpPct)).toFixed(2)}
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-4 space-y-3">
                <div><p className="text-sm font-black text-white">🛑 Stop Loss Authority</p><p className="text-[11px] text-gray-600">Controls the SL used when a new position is opened.</p></div>
                <select value={form.stopLossMode} onChange={e => set("stopLossMode", e.target.value as FormState["stopLossMode"])}
                  className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm font-bold">
                  <option value="fixed_pct">Fixed Percentage</option><option value="strategy">Strategy Suggested</option><option value="atr">ATR Multiple</option>
                </select>
                {form.stopLossMode === "fixed_pct" && <input type="number" min={0.1} step={0.1} value={form.fixedSlPct * 100} onChange={e => set("fixedSlPct", Math.max(0.001, +e.target.value / 100))} placeholder="SL %" className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />}
                {form.stopLossMode === "atr" && <input type="number" min={0.25} step={0.1} value={form.slAtrMultiple} onChange={e => set("slAtrMultiple", +e.target.value)} placeholder="ATR multiple" className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />}
                {status.lastPrice > 0 && form.stopLossMode === "fixed_pct" && (
                  <p className="text-[11px] text-rose-400/80 font-bold">
                    Calculated SL price @ current {status.symbol || "price"}: ${(status.lastPrice * (1 - form.fixedSlPct)).toFixed(2)}
                  </p>
                )}
              </div>
            </div>

            {/* Execution guards */}
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 p-4 space-y-4">
              <div><p className="text-sm font-black text-white">⚙️ Execution Guards</p><p className="text-xs text-gray-600 mt-1">Limits that protect the bot from over-trading and excessive exposure.</p></div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5">Max Position / Balance (%)</label>
                  <input type="number" min={1} max={95} step={1} value={form.maxPositionSizePct * 100}
                    onChange={e => set("maxPositionSizePct", Math.max(0.01, Math.min(0.95, +e.target.value / 100)))}
                    className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5">Max Open Positions</label>
                  <input type="number" min={1} max={20} value={form.maxOpenPositions}
                    onChange={e => set("maxOpenPositions", Math.max(1, Math.min(20, +e.target.value)))}
                    className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5">Max Trades / Day</label>
                  <input type="number" min={1} max={200} value={form.maxTradesPerDay}
                    onChange={e => set("maxTradesPerDay", Math.max(1, Math.min(200, +e.target.value)))}
                    className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5">Cooldown (seconds)</label>
                  <input type="number" min={0} max={3600} value={Math.round(form.tradeCooldownMs / 1000)}
                    onChange={e => set("tradeCooldownMs", Math.max(0, Math.min(3600000, +e.target.value * 1000)))}
                    className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5">Max Daily Loss (USDT)</label>
                  <input type="number" max={-1} value={form.maxDailyLoss}
                    onChange={e => set("maxDailyLoss", +e.target.value)}
                    className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" />
                </div>
              </div>
            </div>

            {/* Position management — automatic, always-on per open position */}
            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.03] p-4 space-y-3">
              <div>
                <p className="text-sm font-black text-white">🛡️ Position Management</p>
                <p className="text-[11px] text-gray-600 mt-1">
                  These run automatically on every open position — there's no global on/off here because they're
                  always active. Override an individual position from its Positions card (Breakeven Now / Trailing
                  ON·OFF / Lock Profit).
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-xl border border-white/5 bg-slate-950/40 p-3">
                  <p className="font-black text-cyan-300">Breakeven</p>
                  <p className="text-gray-500 mt-1">Stop moves to entry once price reaches +1R (one initial-risk multiple) of profit.</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-slate-950/40 p-3">
                  <p className="font-black text-violet-300">ATR Trailing Stop</p>
                  <p className="text-gray-500 mt-1">Once engaged, the stop trails price by an ATR-based distance and only ever moves up.</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-slate-950/40 p-3">
                  <p className="font-black text-amber-300">Tiered Profit Lock</p>
                  <p className="text-gray-500 mt-1">At 25/50/75/90% of the way to TP, locks in 20/45/70/85% of that distance as the new stop.</p>
                </div>
              </div>
            </div>

            {/* Legacy bot config kept visible for compatibility */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-bold text-gray-500 hover:text-gray-300">Advanced compatibility settings</summary>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                <div><label className="text-[11px] text-gray-500 block mb-1.5">Fallback Trade Amount</label><input type="number" min={5} value={form.orderSizeUsdt} onChange={e => set("orderSizeUsdt", +e.target.value)} className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" /></div>
                <div><label className="text-[11px] text-gray-500 block mb-1.5">Fallback Stop Loss (%)</label><input type="number" step={0.1} value={form.stopLoss * 100} onChange={e => set("stopLoss", +e.target.value / 100)} className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" /></div>
                <div><label className="text-[11px] text-gray-500 block mb-1.5">Fallback Take Profit (%)</label><input type="number" step={0.1} value={form.takeProfit * 100} onChange={e => set("takeProfit", +e.target.value / 100)} className="w-full bg-gray-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold" /></div>
              </div>
            </details>
          </PremiumCardContent>
        </PremiumCard>

        {/* ── Paper / Live mode ─────────────────────────────────────────────── */}
        <PremiumCard hoverGlow>
          <PremiumCardContent className="p-5">
          <h3 className="text-base font-bold text-white mb-3">Trading Mode</h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => set("dryRun", true)}
              className={`p-4 rounded-xl border text-left transition-all ${
                form.dryRun
                  ? "border-yellow-500/60 bg-yellow-500/10"
                  : "border-gray-700 bg-gray-800 hover:border-gray-600"
              }`}
            >
              <p className={`font-bold text-sm ${form.dryRun ? "text-yellow-400" : "text-gray-400"}`}>
                📄 Paper Trading
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Simulates trades without real money. Safe for testing strategies.
              </p>
            </button>
            <button
              onClick={() => set("dryRun", false)}
              className={`p-4 rounded-xl border text-left transition-all ${
                !form.dryRun
                  ? "border-green-500/60 bg-green-500/10"
                  : "border-gray-700 bg-gray-800 hover:border-gray-600"
              }`}
            >
              <p className={`font-bold text-sm ${!form.dryRun ? "text-green-400" : "text-gray-400"}`}>
                💰 Live Trading
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Real orders on Gate.io. Requires valid API keys in Settings.
              </p>
            </button>
          </div>

          {!keysReady && !form.dryRun && (
            <p className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              ⚠️ No API keys configured — live trading is blocked. Go to API Keys tab to add keys.
            </p>
          )}
          </PremiumCardContent>
        </PremiumCard>

        {/* ── Action buttons when bot is stopped ─────────────────────────────── */}
        {!isRunning && (
          <div className="flex gap-3">
            <button
              onClick={handleStart}
              disabled={busy || offline || (!keysReady && !form.dryRun)}
              className="flex-1 py-3.5 rounded-xl font-bold text-sm transition-all bg-green-500 text-black hover:bg-green-400 shadow-lg shadow-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? "⏳ Starting…" : "🚀 Start Bot"}
            </button>
            <button
              onClick={handleSaveOnly}
              disabled={busy || offline}
              className="px-6 py-3.5 rounded-xl font-bold text-sm transition-all bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-40"
            >
              💾 Save
            </button>
          </div>
        )}

        {/* ── Live stats (while running) ─────────────────────────────────────── */}
        {isRunning && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Trades", value: String(status.totalTrades),              color: "text-white" },
              { label: "Win Rate",     value: `${status.winRate}%`,                    color: "text-green-400" },
              { label: "Daily PnL",    value: `$${status.dailyPnL.toFixed(2)}`,        color: status.dailyPnL >= 0 ? "text-green-400" : "text-red-400" },
              { label: "Uptime",       value: fmtUptime(status.uptime),               color: "text-cyan-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
                <p className="text-[13px] font-bold uppercase tracking-wider tracking-widest text-slate-500 mb-1.5">{label}</p>
                <p className={`text-xl font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Advanced Risk Dashboard ─────────────────────────────────────────── */}
        {isRunning && <RiskDashboard status={status} />}

        {/* ── Stop button (large, while running) ─────────────────────────────── */}
        {isRunning && (
          <button
            onClick={handleStop}
            disabled={busy || offline}
            className="w-full py-3.5 rounded-xl font-bold text-sm transition-all bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 disabled:opacity-40"
          >
            {busy ? "⏳ Stopping…" : "⛔ Stop Bot"}
          </button>
        )}
      </div>

      {/* ── Right column: Signal panel + Live bot console ───────────────────── */}
      <div className="space-y-4">

      {/* Signal panel — shown whenever bot is running */}
      {isRunning && (
        <StrategySignalPanel status={status} />
      )}

      {/* Portfolio panel — live open positions + exposure tracking */}
      {isRunning && (
        <PortfolioPanel status={status} />
      )}

      <BotOperationsConsole status={status} logs={streamLogs} />

      <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl overflow-hidden flex flex-col min-h-[400px]">
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2 shrink-0">
          <span className="text-xs">🖥️</span>
          <h3 className="text-base font-bold text-white">Live Bot Console</h3>
          {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse ml-1" />}
          <span className="flex items-center gap-1 ml-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
            <span className="text-gray-600 text-xs">STREAM</span>
          </span>
          <span className="text-gray-600 text-xs">{streamLogs.length} entries</span>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5 max-h-[680px]"
        >
          {streamLogs.length === 0 ? (
            <div className="text-gray-600 text-center py-20">
              <p className="text-3xl mb-3">🤖</p>
              <p className="font-semibold">No logs yet</p>
              <p className="text-xs mt-1">Start the bot to see real-time output here</p>
            </div>
          ) : (
            streamLogs.map((l, i) => (
              <div key={i} className="flex gap-2 leading-5">
                <span className="text-gray-600 shrink-0 text-xs pt-0.5 w-16">
                  {new Date(l.ts).toLocaleTimeString()}
                </span>
                <span className={`shrink-0 w-14 text-xs pt-0.5 ${logColor(l)}`}>
                  [{l.level}]
                </span>
                <span className="text-gray-300 break-all">{l.msg}</span>
              </div>
            ))
          )}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}