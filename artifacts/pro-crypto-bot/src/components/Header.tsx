import { useState, useEffect, useCallback } from "react";
import { SERVER_URL } from "../config/urls";
import { StatusBadge } from "./premium/StatusBadge";import {
  Activity, Radio, Target, BarChart2, Microscope, Beaker,
  Briefcase, ClipboardList, Bot, ShieldAlert, Key,
  Trophy, Brain, Repeat, Settings, ShieldCheck, Link, Zap, BookOpen,
  BotMessageSquare, TrendingUp, Crosshair, Server,
  Lock, Wallet, TrendingDown, RefreshCw, MoreHorizontal, ChevronDown,
  ArrowUpDown,
} from "lucide-react";

function useGateioBalance() {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    const token = localStorage.getItem("pcb_jwt");
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch(`${SERVER_URL}/api/exchanges/balance?exchange=gateio`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (d.ok && d.data?.totalUsd != null) setBalance(Number(d.data.totalUsd));
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 60_000);
    return () => clearInterval(id);
  }, [fetch_]);

  return { balance, loading, refresh: fetch_ };
}

interface HeaderProps {
  totalMarketCap: number;
  fearGreedIndex: number;
  lastUpdate: Date;
  isBotRunning: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
  connectionStatus?: "connecting" | "live" | "simulated";
  onLock?: () => void;
}

// ── Primary navigation — the core trading workflow, always visible ─────────────
const PRIMARY_TABS = [
  { id: "dashboard",        label: "Dashboard",       icon: <Activity size={16} /> },
  { id: "manual-trading",   label: "Trade",           icon: <TrendingUp size={16} /> },
  { id: "futures",          label: "Futures",         icon: <ArrowUpDown size={16} /> },
  { id: "bot",              label: "Bot Control",     icon: <Bot size={16} /> },
  { id: "trades",           label: "Positions",       icon: <ClipboardList size={16} /> },
  { id: "capital-protection", label: "Risk Center",   icon: <ShieldCheck size={16} /> },
  { id: "analytics",        label: "Analytics",       icon: <Microscope size={16} /> },
  { id: "trade-journal",    label: "Journal",         icon: <BookOpen size={16} /> },
  { id: "strategy-lab",     label: "Strategies",      icon: <Brain size={16} /> },
];

// ── Secondary navigation — grouped under "More" so the primary bar stays a  ──
// professional handful of tabs instead of a 26-wide scrolling strip. Order Book
// lives here now that it's embedded as a panel inside the Manual Trading
// terminal — kept reachable as a standalone page, just no longer competing
// with Trade/Bot Control/Dashboard for top-level attention.
const MORE_GROUPS: { heading: string; items: typeof PRIMARY_TABS }[] = [
  {
    heading: "Portfolio & Data",
    items: [
      { id: "portfolio",  label: "Portfolio",   icon: <Briefcase size={16} /> },
      { id: "orderbook",  label: "Order Book",  icon: <BarChart2 size={16} /> },
      { id: "backtest",   label: "Backtest",    icon: <Beaker size={16} /> },
      { id: "copy-trading", label: "Copy Trading", icon: <Repeat size={16} /> },
    ],
  },
  {
    heading: "Signals",
    items: [
      { id: "livesignals", label: "Live Signals", icon: <Radio size={16} /> },
      { id: "signals",     label: "Signals",       icon: <Target size={16} /> },
    ],
  },
  {
    heading: "Advanced / Research",
    items: [
      { id: "strategy-ranking",    label: "Strategy Ranking", icon: <Trophy size={16} /> },
      { id: "regime-intelligence", label: "Regime Intel",     icon: <Brain size={16} /> },
      { id: "walk-forward",        label: "Walk-Forward",     icon: <Repeat size={16} /> },
      { id: "optimizer",           label: "Optimizer",        icon: <Settings size={16} /> },
      { id: "correlation-risk",    label: "Correlation Risk", icon: <Link size={16} /> },
      { id: "execution-analytics", label: "Execution",        icon: <Zap size={16} /> },
      { id: "trade-review",        label: "AI Review",        icon: <BotMessageSquare size={16} /> },
      { id: "live-performance",    label: "Live Perf.",       icon: <TrendingUp size={16} /> },
      { id: "benchmark",           label: "Benchmark",        icon: <Crosshair size={16} /> },
      { id: "orchestrator",        label: "Orchestrator",     icon: <Server size={16} /> },
    ],
  },
  {
    heading: "System",
    items: [
      { id: "deploy",   label: "VPS · Safety", icon: <ShieldAlert size={16} /> },
      { id: "settings", label: "API Keys",     icon: <Key size={16} /> },
    ],
  },
];
const ALL_TABS = [...PRIMARY_TABS, ...MORE_GROUPS.flatMap(g => g.items)];

function fearLabel(v: number) {
  if (v >= 80) return { label: "Extreme Greed", color: "text-green-400" };
  if (v >= 60) return { label: "Greed",         color: "text-green-300" };
  if (v >= 45) return { label: "Neutral",        color: "text-yellow-300" };
  if (v >= 25) return { label: "Fear",           color: "text-orange-400" };
  return              { label: "Extreme Fear",   color: "text-red-400" };
}

export function Header({ totalMarketCap, fearGreedIndex, lastUpdate, isBotRunning, activeTab, onTabChange, connectionStatus = "connecting", onLock }: HeaderProps) {
  const [tick, setTick] = useState(false);
  useEffect(() => { setTick((t) => !t); }, [lastUpdate]);
  const { balance, loading: balLoading, refresh: refreshBalance } = useGateioBalance();
  const [moreOpen, setMoreOpen] = useState(false);
  const isInMore = MORE_GROUPS.some(g => g.items.some(i => i.id === activeTab));

  const fear = fearLabel(fearGreedIndex);
  const fmt = (n: number) => {
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
    return `$${n.toLocaleString()}`;
  };

  return (
    <header className="et-topbar sticky top-0 z-50">
      {/* Top bar */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-sm font-bold shadow-[0_0_15px_rgba(14,165,233,0.3)]">
              ET
            </div>
            <div className="flex flex-col">
              <span className="font-black text-white text-xl tracking-tight leading-none">ELITE<span className="text-cyan-400">-TRADE</span></span>
              <span className="text-[13px] font-bold text-slate-400 font-semibold tracking-widest uppercase mt-0.5">Trading &amp; Automation Platform</span>
            </div>
          </div>
          {isBotRunning && (
            <div className="ml-2">
              <StatusBadge variant="live" label="BOT LIVE" pulse glow />
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-6 text-sm text-slate-300">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">M.Cap</span>
            <span className="text-white font-medium">{fmt(totalMarketCap)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">F&G</span>
            <span className={`font-bold ${fear.color}`}>{Math.round(fearGreedIndex)}</span>
            <span className={`text-xs ${fear.color} opacity-80`}>({fear.label})</span>
          </div>
          {balance !== null && (
            <button
              onClick={refreshBalance}
              className="flex items-center gap-2 bg-slate-800/50 hover:bg-slate-800 border border-white/5 rounded-full px-3 py-1.5 transition-colors group"
              title="Gate.io balance — click to refresh"
            >
              <Wallet size={14} className="text-cyan-400 group-hover:scale-110 transition-transform" />
              <span className="text-white font-bold">
                {balLoading ? "…" : `${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </span>
            </button>
          )}
          <div className="flex items-center">
            <StatusBadge 
              variant={connectionStatus === "live" ? "connected" : connectionStatus === "simulated" ? "simulated" : "connecting"} 
              label={connectionStatus === "live" ? "Gate.io Live" : connectionStatus === "simulated" ? "Simulated" : "Connecting..."}
              pulse={connectionStatus === "connecting" || (connectionStatus === "live" && tick)}
            />
          </div>
        </div>
      </div>

      {/* Nav tabs */}
      <nav className="px-2 flex items-center gap-1 pt-1 relative">
        {PRIMARY_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap transition-all border-b-2 ${
              activeTab === tab.id
                ? "border-cyan-400 text-cyan-400 bg-cyan-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
            }`}
          >
            <span className={activeTab === tab.id ? "text-cyan-400" : "text-slate-500"}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}

        {/* More — everything else (research tools, signals, order book, system pages),   */}
        {/* grouped instead of diluting the primary trading workflow with 18 extra tabs.   */}
        <div className="relative">
          <button
            onClick={() => setMoreOpen(v => !v)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap transition-all border-b-2 ${
              isInMore
                ? "border-cyan-400 text-cyan-400 bg-cyan-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
            }`}
          >
            <MoreHorizontal size={16} className={isInMore ? "text-cyan-400" : "text-slate-500"} />
            <span>{isInMore ? (ALL_TABS.find(t => t.id === activeTab)?.label ?? "More") : "More"}</span>
            <ChevronDown size={13} className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-50 w-[560px] max-w-[90vw] rounded-xl border border-white/10 bg-[#0b0e16] shadow-2xl p-3 grid grid-cols-2 gap-3">
                {MORE_GROUPS.map(group => (
                  <div key={group.heading}>
                    <div className="text-[10px] uppercase tracking-widest text-slate-600 font-black px-2 pb-1.5">{group.heading}</div>
                    <div className="space-y-0.5">
                      {group.items.map(item => (
                        <button
                          key={item.id}
                          onClick={() => { onTabChange(item.id); setMoreOpen(false); }}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-semibold text-left transition ${
                            activeTab === item.id
                              ? "bg-cyan-500/10 text-cyan-300"
                              : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
                          }`}
                        >
                          <span className={activeTab === item.id ? "text-cyan-400" : "text-slate-600"}>{item.icon}</span>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {onLock && (
          <button
            onClick={onLock}
            className="flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 border-transparent text-slate-500 hover:text-rose-400 transition-all ml-auto"
          >
            <Lock size={16} />
            <span className="hidden xl:inline">Lock</span>
          </button>
        )}
      </nav>
    </header>
  );
}
