import { useState, useEffect, useCallback } from "react";
import type { CoinPrice, Signal, Trade } from "../types/crypto";
import { OpenPositionCard } from "./OpenPositionCard";
import { SERVER_URL } from "../config/urls";
import { useAnalytics } from "../hooks/useAnalytics";
import { PremiumStatCard } from "./premium/PremiumStatCard";
import { StatusBadge } from "./premium/StatusBadge";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Bot, ChevronRight, Activity, Wallet, BarChart2, Zap, TrendingUp, TrendingDown, Server, Wifi, PieChart, LineChart, Shield, Key } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(price: number) {
  return price >= 1000
    ? price.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : price >= 1
    ? price.toFixed(2)
    : price.toFixed(4);
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// ─── Mini server status hook ──────────────────────────────────────────────────

interface MiniStatus {
  balanceUSDT: number;
  mode: string;
  activeStrategy?: string;
  connection: "connecting" | "connected" | "error";
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: string;
  performance?: {
    totalPnlUsd: number;
    weekly7dPnl: number;
    monthly30dPnl: number;
  } | null;
  portfolio?: {
    openCount: number;
    totalUnrealizedPnl: number;
  } | null;
}

function useMiniServerStatus(): MiniStatus {
  const [s, setS] = useState<MiniStatus>({
    balanceUSDT: 0,
    mode: "UNKNOWN",
    connection: "connecting",
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: "0",
  });

  const fetch_ = useCallback(() => {
    const token = localStorage.getItem("pcb_jwt") ?? "";
    fetch(`${SERVER_URL}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        if (d.ok) {
          setS({
            balanceUSDT:    (d.balanceUSDT as number) || 0,
            mode:           (d.mode as string) || "UNKNOWN",
            activeStrategy: d.activeStrategy as string | undefined,
            connection:     "connected",
            totalTrades:    (d.totalTrades as number) || 0,
            winningTrades:  (d.winningTrades as number) || 0,
            losingTrades:   (d.losingTrades as number) || 0,
            winRate:        (d.winRate as string) || "0",
            performance:    (d.performance as MiniStatus["performance"]) ?? null,
            portfolio:      (d.portfolio as MiniStatus["portfolio"]) ?? null,
          });
        }
      })
      .catch(() => setS(prev => ({ ...prev, connection: "error" })));
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 10_000);
    return () => clearInterval(id);
  }, [fetch_]);

  return s;
}

// ─── Mini equity curve ────────────────────────────────────────────────────────

function MiniEquityCurve() {
  const { snapshot, loading } = useAnalytics(SERVER_URL);
  const data = snapshot?.equityCurve ?? [];
  const latest = data.length > 0 ? data[data.length - 1].cumPnl : null;
  const isPos  = (latest ?? 0) >= 0;

  if (loading && data.length === 0) {
    return (
      <PremiumCard>
        <PremiumCardContent className="p-4">
          <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest font-semibold mb-2">Equity Curve</p>
          <div className="h-24 flex items-center justify-center">
            <span className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        </PremiumCardContent>
      </PremiumCard>
    );
  }

  if (data.length === 0) {
    return (
      <PremiumCard>
        <PremiumCardContent className="p-4">
          <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest font-semibold mb-1">Equity Curve</p>
          <p className="text-slate-500 text-xs text-center py-6">No trade history yet.</p>
        </PremiumCardContent>
      </PremiumCard>
    );
  }

  return (
    <PremiumCard>
      <PremiumCardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest font-semibold">Equity Curve</p>
          {latest !== null && (
            <span className={`text-sm font-bold ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
              {isPos ? "+" : ""}${latest.toFixed(2)}
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={96}>
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="mobileEquityGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ backgroundColor: "#090a0f", border: "1px solid #0ea5e9", borderRadius: 8, fontSize: 13, fontFamily: "Inter, sans-serif" }}
              formatter={(v: number) => [`$${v.toFixed(2)}`, "Cum. P&L"]}
              labelFormatter={() => ""}
            />
            <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="cumPnl"
              stroke="#0ea5e9"
              strokeWidth={2}
              fill="url(#mobileEquityGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "#0ea5e9", stroke: "#090a0f", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </PremiumCardContent>
    </PremiumCard>
  );
}

// ─── Market overview (mobile, compact) ───────────────────────────────────────

const MARKET_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE"];

function MobileMarketOverview({
  prices,
  connectionStatus,
  onTabChange,
}: {
  prices: CoinPrice[];
  connectionStatus?: "connecting" | "live" | "simulated";
  onTabChange: (tab: string) => void;
}) {
  const rows = MARKET_SYMBOLS
    .map((sym) => prices.find((p) => p.symbol === sym))
    .filter(Boolean) as CoinPrice[];

  return (
    <PremiumCard className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white">Market Overview</h3>
          <StatusBadge 
            variant={connectionStatus === "live" ? "live" : connectionStatus === "simulated" ? "simulated" : "connecting"} 
            label={connectionStatus === "live" ? "LIVE" : connectionStatus === "simulated" ? "SIM" : "..."}
            pulse={connectionStatus === "live"}
          />
        </div>
        <button onClick={() => onTabChange("orderbook")} className="text-[13px] font-bold uppercase tracking-wider tracking-wide text-cyan-400 hover:text-cyan-300">
          Order Book →
        </button>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr] gap-1 px-4 py-2 border-b border-white/5 bg-slate-900/40">
        <span className="text-slate-500 text-[13px] font-bold font-bold uppercase tracking-wider">Asset</span>
        <span className="text-slate-500 text-[13px] font-bold font-bold uppercase tracking-wider text-right">Price</span>
        <span className="text-slate-500 text-[13px] font-bold font-bold uppercase tracking-wider text-right">24h %</span>
        <span className="text-slate-500 text-[13px] font-bold font-bold uppercase tracking-wider text-right">Vol</span>
      </div>

      <div className="divide-y divide-white/5">
        {rows.map((coin) => {
          const isUp = coin.changePercent24h >= 0;
          const pctAbs = Math.abs(coin.changePercent24h);
          return (
            <div key={coin.id} className="grid grid-cols-[2fr_1.5fr_1fr_1fr] gap-1 items-center px-4 py-3 hover:bg-slate-800/30 transition-colors">
              {/* Asset */}
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                  isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                }`}>
                  {coin.symbol.slice(0, 2)}
                </div>
                <span className="text-white text-sm font-bold">{coin.symbol}</span>
              </div>
              {/* Price */}
              <div className="text-right">
                <p className="text-white text-sm font-bold">${fmt(coin.price)}</p>
              </div>
              {/* 24h % */}
              <div className="text-right flex items-center justify-end gap-0.5">
                {isUp ? <TrendingUp size={12} className="text-emerald-400" /> : <TrendingDown size={12} className="text-rose-400" />}
                <span className={`text-xs font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  {pctAbs.toFixed(2)}%
                </span>
              </div>
              {/* Volume */}
              <div className="text-right">
                <span className="text-slate-400 text-xs font-medium">{fmtVol(coin.volume24h)}</span>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-slate-500 text-[13px] font-bold font-medium uppercase tracking-widest">Loading Market Data...</div>
        )}
      </div>
    </PremiumCard>
  );
}

// ─── Status dot ───────────────────────────────────────────────────────────────

function MiniStatusDot({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-slate-400 font-medium">{label}</span>
      <StatusBadge 
        variant={ok === true ? "live" : ok === false ? "offline" : "connecting"} 
        label={ok === true ? "OK" : ok === false ? "DOWN" : "WAIT"} 
        pulse={ok === true}
        className="scale-90 origin-right"
      />
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface MobileDashboardProps {
  prices: CoinPrice[];
  signals: Signal[];
  trades: Trade[];
  totalPnL: number;
  fearGreedIndex: number;
  isBotRunning: boolean;
  onTabChange: (tab: string) => void;
  connectionStatus?: "connecting" | "live" | "simulated";
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MobileDashboard({
  prices, signals, trades, totalPnL, fearGreedIndex, isBotRunning, onTabChange, connectionStatus,
}: MobileDashboardProps) {
  const serverStatus  = useMiniServerStatus();

  const openTrades    = trades.filter((t) => t.status === "open");
  const closedTrades  = trades.filter((t) => t.status === "closed");
  const wins          = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const closedTotal   = closedTrades.length;
  const winRateLocal  = closedTotal > 0 ? (wins / closedTotal) * 100 : 0;
  const displayWR     = serverStatus.winRate !== "0"
    ? `${serverStatus.winRate}%`
    : `${winRateLocal.toFixed(1)}%`;

  const topSignal     = signals.find((s) => s.type !== "HOLD") ?? signals[0];
  const fgColor       = fearGreedIndex >= 70 ? "text-emerald-400" : fearGreedIndex >= 45 ? "text-amber-400" : "text-rose-400";

  const realizedPnL   = serverStatus.performance?.totalPnlUsd ?? totalPnL;
  const unrealizedPnL = serverStatus.portfolio?.totalUnrealizedPnl ?? 0;

  const wsOk          = connectionStatus === "live" || connectionStatus === "simulated";
  const serverUp      = serverStatus.connection === "connected";

  // Today's trades (last 24h)
  const now           = Date.now();
  const todayTrades   = trades.filter((t) => {
    try { return now - new Date(t.timestamp).getTime() < 86_400_000; } catch { return false; }
  }).length;

  return (
    <div className="space-y-4">
      {/* Bot status banner */}
      <PremiumCard className="overflow-visible" animatedBorder={isBotRunning}>
        <div className={`p-4 flex items-center gap-4 ${isBotRunning ? 'bg-emerald-500/5' : ''}`}>
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-lg ${
            isBotRunning ? "bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-emerald-500/30 text-white" : "bg-slate-800 text-slate-400"
          }`}>
            <Bot size={28} className={isBotRunning ? "animate-pulse" : ""} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-black text-base tracking-wide ${isBotRunning ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "text-slate-400"}`}>
              {isBotRunning ? "ENGINE LIVE" : "ENGINE STOPPED"}
            </p>
            <p className="text-xs text-slate-500 truncate font-medium mt-0.5">
              {isBotRunning
                ? `${serverStatus.activeStrategy ?? "strategy"} · ${openTrades.length} open`
                : "Tap Bot Config to start"}
            </p>
            {serverStatus.mode && (
              <span className={`text-[13px] font-bold px-2 py-0.5 rounded border font-bold mt-2 inline-block uppercase tracking-wider ${
                serverStatus.mode === "LIVE"  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
                serverStatus.mode === "PAPER" ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" :
                                                "bg-slate-800 border-white/10 text-slate-400"
              }`}>{serverStatus.mode}</span>
            )}
          </div>
          <button
            onClick={() => onTabChange("bot")}
            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              isBotRunning
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                : "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30"
            }`}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </PremiumCard>

      {/* Open Positions — rendered via the shared OpenPositionCard component */}
      {openTrades.map(t => (
        <OpenPositionCard
          key={t.id}
          trade={t}
          prices={prices}
          calledBy="MobileDashboard"
        />
      ))}

      {/* System health */}
      <PremiumCard>
        <PremiumCardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="text-cyan-400" size={16} />
            <p className="text-[13px] font-bold text-slate-400 font-semibold uppercase tracking-widest">System Health</p>
          </div>
          <div className="space-y-1">
            <MiniStatusDot ok={serverUp} label="API Server" />
            <MiniStatusDot ok={wsOk}     label="WebSocket Feed" />
            <MiniStatusDot ok={isBotRunning} label="Bot Engine" />
          </div>
        </PremiumCardContent>
      </PremiumCard>

      {/* Stats grid 2×3 */}
      <div className="grid grid-cols-2 gap-3">
        <PremiumStatCard
          title="Balance"
          value={serverStatus.balanceUSDT > 0 ? serverStatus.balanceUSDT : "—"}
          valuePrefix={serverStatus.balanceUSDT > 0 ? "$" : undefined}
          subtitle="Available USDT"
          icon={<Wallet size={16} />}
        />
        <PremiumStatCard
          title="Realized P&L"
          value={Math.abs(realizedPnL)}
          valuePrefix={realizedPnL >= 0 ? "+$" : "-$"}
          valueColor={realizedPnL >= 0 ? "text-emerald-400" : "text-rose-400"}
          subtitle={`${openTrades.length} open pos.`}
          icon={<BarChart2 size={16} />}
        />
        <PremiumStatCard
          title="Unrealized"
          value={Math.abs(unrealizedPnL)}
          valuePrefix={unrealizedPnL >= 0 ? "+$" : "-$"}
          valueColor={unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400"}
          subtitle="Open P&L"
        />
        <PremiumStatCard
          title="Win Rate"
          value={displayWR.replace('%', '')}
          valueSuffix="%"
          valueColor={parseFloat(displayWR) >= 55 ? "text-emerald-400" : parseFloat(displayWR) >= 40 ? "text-amber-400" : "text-rose-400"}
          subtitle={`${closedTotal} trades`}
        />
        <PremiumStatCard
          title="Fear & Greed"
          value={Math.round(fearGreedIndex)}
          valueColor={fgColor}
          subtitle={fearGreedIndex >= 70 ? "Extreme Greed" : fearGreedIndex >= 45 ? "Neutral" : "Fear"}
        />
        <PremiumStatCard
          title="Today's Trades"
          value={todayTrades}
          subtitle={`${serverStatus.totalTrades || closedTotal} total`}
        />
      </div>

      {/* Weekly / Monthly P&L */}
      {(serverStatus.performance?.weekly7dPnl !== undefined ||
        serverStatus.performance?.monthly30dPnl !== undefined) && (
        <PremiumCard>
          <PremiumCardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="text-emerald-400" size={16} />
              <p className="text-[13px] font-bold text-slate-400 font-semibold uppercase tracking-widest">Period P&amp;L</p>
            </div>
            <div className="space-y-2">
              {serverStatus.performance?.weekly7dPnl !== undefined && (
                <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-lg border border-white/5">
                  <span className="text-slate-400 text-[13px] font-bold uppercase tracking-wider tracking-wide">Weekly (7d)</span>
                  <span className={`font-bold text-sm ${
                    (serverStatus.performance.weekly7dPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {(serverStatus.performance.weekly7dPnl ?? 0) >= 0 ? "+" : ""}
                    ${(serverStatus.performance.weekly7dPnl ?? 0).toFixed(2)}
                  </span>
                </div>
              )}
              {serverStatus.performance?.monthly30dPnl !== undefined && (
                <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-lg border border-white/5">
                  <span className="text-slate-400 text-[13px] font-bold uppercase tracking-wider tracking-wide">Monthly (30d)</span>
                  <span className={`font-bold text-sm ${
                    (serverStatus.performance.monthly30dPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {(serverStatus.performance.monthly30dPnl ?? 0) >= 0 ? "+" : ""}
                    ${(serverStatus.performance.monthly30dPnl ?? 0).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </PremiumCardContent>
        </PremiumCard>
      )}

      {/* Equity curve */}
      <MiniEquityCurve />

      {/* Market overview table */}
      <MobileMarketOverview
        prices={prices}
        connectionStatus={connectionStatus}
        onTabChange={onTabChange}
      />

      {/* Top signal */}
      {topSignal && (
        <PremiumCard
          className={`cursor-pointer active:scale-[0.98] transition-all ${
            topSignal.type === "BUY"
              ? "border-emerald-500/30"
              : topSignal.type === "SELL"
              ? "border-rose-500/30"
              : "border-white/5"
          }`}
          hoverGlow
          onClick={() => onTabChange("signals")}
        >
          <div className={`p-4 ${
            topSignal.type === "BUY" ? "bg-emerald-500/5" : topSignal.type === "SELL" ? "bg-rose-500/5" : ""
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <StatusBadge variant={topSignal.type === "BUY" ? "buy" : topSignal.type === "SELL" ? "sell" : "unknown"} label={topSignal.type} />
                <span className="text-white font-black text-lg">{topSignal.symbol}</span>
                <span className="text-[13px] font-bold font-bold text-slate-400 uppercase tracking-wide bg-slate-800 px-2 py-0.5 rounded">{topSignal.strength}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[13px] font-bold text-slate-500 uppercase font-bold tracking-widest">Confidence</span>
                <span className={`text-sm font-black ${topSignal.confidence >= 80 ? "text-emerald-400" : topSignal.confidence >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                  {topSignal.confidence}%
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-400 font-medium mb-3 bg-slate-900/50 p-2.5 rounded-lg border border-white/5">
              <span>Entry <span className="text-white ml-1">${fmt(topSignal.price)}</span></span>
              <span>Target <span className="text-emerald-400 ml-1">${fmt(topSignal.target)}</span></span>
              <span>SL <span className="text-rose-400 ml-1">${fmt(topSignal.stopLoss)}</span></span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-3">
              <div className={`h-full rounded-full ${
                topSignal.type === "BUY" ? "bg-emerald-500" : topSignal.type === "SELL" ? "bg-rose-500" : "bg-slate-600"
              }`} style={{ width: `${topSignal.confidence}%` }} />
            </div>
            <p className="text-sm text-slate-400 leading-relaxed font-medium">{topSignal.reason}</p>
          </div>
        </PremiumCard>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { tab: "signals",   icon: Zap, label: "Signals",    cls: "text-cyan-400" },
          { tab: "portfolio", icon: PieChart, label: "Portfolio",  cls: "text-emerald-400" },
          { tab: "analytics", icon: LineChart, label: "Analytics",  cls: "text-purple-400" },
          { tab: "orderbook", icon: Activity, label: "Order Book", cls: "text-orange-400" },
          { tab: "deploy",    icon: Shield, label: "Safety",     cls: "text-rose-400" },
          { tab: "settings",  icon: Key, label: "API Keys",   cls: "text-slate-400" },
        ].map((item) => (
          <button
            key={item.tab}
            onClick={() => onTabChange(item.tab)}
            className="premium-glass bg-slate-900/40 border border-white/5 rounded-xl p-3 flex flex-col items-center gap-2.5 hover:bg-slate-800/60 active:scale-95 transition-all"
          >
            <item.icon size={20} className={item.cls} />
            <span className="text-[13px] font-bold text-slate-400 font-bold uppercase tracking-wider">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Spacer for mobile bottom nav */}
      <div className="h-20 lg:hidden" />
    </div>
  );
}
