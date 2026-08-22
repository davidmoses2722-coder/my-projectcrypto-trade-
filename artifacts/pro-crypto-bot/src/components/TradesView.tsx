/**
 * TradesView — Full Profit Tracking Dashboard + Trade Journal
 * ─────────────────────────────────────────────────────────────────────────────
 * Tabs:
 *   1. 📊 Profit Overview  — equity curve, key stats, daily breakdown
 *   2. 📋 Open Positions   — live P&L, close button, TP/SL display
 *   3. 📜 Trade Journal    — full history table with all trade fields
 *   4. 🏆 Performance      — advanced metrics, coin breakdown, streaks
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useMemo, useEffect } from "react";
import { Trade, CoinPrice } from "../types/crypto";
import { ProfitStats } from "../hooks/useProfitTracker";
import { SERVER_URL } from "../config/urls";
import { PositionActionButtons } from "./PositionActionButtons";
import { OpenPositionCard } from "./OpenPositionCard";
import { PremiumCard } from "./premium/PremiumCard";
import { PremiumStatCard } from "./premium/PremiumStatCard";
import { StatusBadge } from "./premium/StatusBadge";
import { Activity, LayoutDashboard, ClipboardList, Target, Award, Clock, DollarSign, ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Percent, Zap } from "lucide-react";
import { motion } from "framer-motion";

// ─── Local StatCard (compact metric tile) ────────────────────────────────────
function StatCard({ label, value, sub, color = "white" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  const colors: Record<string, string> = {
    green: "text-emerald-400", red: "text-rose-400", yellow: "text-amber-400",
    blue: "text-blue-400",  white: "text-slate-50",  cyan: "text-cyan-400",
    orange: "text-orange-400", purple: "text-purple-400",
  };
  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 hover:border-slate-600/50 transition-colors">
      <div className="text-[13px] font-bold uppercase tracking-wider tracking-widest text-slate-500 mb-2">{label}</div>
      <div className={`text-2xl font-black ${colors[color] ?? "text-slate-50"}`}>{value}</div>
      {sub && <div className="text-sm text-slate-600 mt-1">{sub}</div>}
    </div>
  );
}

// ─── Phase 11: Live Position Analytics ───────────────────────────────────────

interface TimelineEvent { time: string; event: string; detail: string; }

interface LivePosition {
  symbol:            string;
  entryPrice:        number;
  currentPrice:      number;
  highestPrice:      number;
  lowestPrice:       number;
  unrealizedPnlUsd:  number;
  unrealizedPnlPct:  number;
  openedAt:          number;
  durationMs:        number;
  tpPrice:           number | null;
  slPrice:           number | null;
  initialSlPrice:    number | null;
  initialTpPrice:    number | null;
  trailingActive:    boolean;
  breakevenActive:   boolean;
  lockedProfitPct:   number;
  lockedSlPrice:     number | null;
  rrMultiple:        number;
  profitPctOfTP:     number;
  distToTpPct:       number | null;
  distToSlPct:       number | null;
  healthScore:       number;
  healthColor:       "green" | "yellow" | "red";
  momentumScore:     number;
  atrEstimate:       number | null;
  strategyType:      string;
  timeline:          TimelineEvent[];
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TradesViewProps {
  trades:      Trade[];
  totalPnL:    number;
  prices?:     CoinPrice[];
  stats:       ProfitStats;
  onClose?:    (id: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400)return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

function durStr(ms?: number): string {
  if (!ms) return "—";
  const s = ms / 1000;
  if (s < 60)   return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400)return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtPrice(p: number): string {
  return p >= 100 ? p.toLocaleString(undefined, { maximumFractionDigits: 1 }) : p.toFixed(5);
}

function fmtPnL(v: number, showSign = true): string {
  return `${showSign && v >= 0 ? "+" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

const REASON_EMOJI: Record<string, string> = {
  TP: "🏆", SL: "🛑", TRAILING: "📏", MANUAL: "✋", LIQUIDATION: "💥", CANCELLED: "✕",
};

// ─── Equity Curve SVG ────────────────────────────────────────────────────────

function EquityCurve({ curve }: { curve: { equity: number; drawdown: number }[] }) {
  if (curve.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-gray-700 text-sm">
        Complete 2+ trades to see the equity curve
      </div>
    );
  }

  const W = 600, H = 160;
  const equities  = curve.map(c => c.equity);
  const drawdowns = curve.map(c => c.drawdown);
  const minE = Math.min(...equities, 0);
  const maxE = Math.max(...equities, 1);
  const minD = Math.min(...drawdowns, 0);

  const scaleY = (v: number, mn: number, mx: number) =>
    H - ((v - mn) / ((mx - mn) || 1)) * H;

  const equityPath = curve.map((c, i) => {
    const x = (i / (curve.length - 1)) * W;
    const y = scaleY(c.equity, minE, maxE);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  const ddPath = curve.map((c, i) => {
    const x  = (i / (curve.length - 1)) * W;
    const y  = scaleY(c.drawdown, minD, 0);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  const zeroY = scaleY(0, minE, maxE);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48" preserveAspectRatio="none">
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.25" />
        </linearGradient>
      </defs>

      {/* Zero line */}
      <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#374151" strokeWidth="1" strokeDasharray="4 4" />

      {/* Drawdown fill */}
      {minD < 0 && (
        <>
          <path d={`${ddPath} L ${W} ${H} L 0 ${H} Z`} fill="url(#ddGrad)" />
          <path d={ddPath} stroke="#ef4444" strokeWidth="1.5" fill="none" strokeOpacity="0.6" />
        </>
      )}

      {/* Equity fill */}
      <path d={`${equityPath} L ${W} ${zeroY} L 0 ${zeroY} Z`} fill="url(#eqGrad)" />
      {/* Equity line */}
      <path d={equityPath} stroke="#22c55e" strokeWidth="2" fill="none" />

      {/* Last point dot */}
      {(() => {
        const last = curve[curve.length - 1];
        const x    = W;
        const y    = scaleY(last.equity, minE, maxE);
        return <circle cx={x} cy={y} r="4" fill={last.equity >= 0 ? "#22c55e" : "#ef4444"} />;
      })()}
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function TradesView({ trades, stats, onClose }: TradesViewProps) {
  const [tab, setTab]       = useState<"overview" | "positions" | "journal" | "performance">(
    () => trades.filter(t => t.status === "open").length > 0 ? "positions" : "overview",
  );
  const [sortField, setSortField] = useState<"time" | "pnl" | "symbol" | "duration">("time");
  const [sortDir,  setSortDir]    = useState<"asc" | "desc">("desc");
  const [filterSym, setFilterSym] = useState("ALL");

  // ── Phase 11: Live position analytics (polls every 3 s) ──────────────────
  const [livePositions, setLivePositions] = useState<LivePosition[]>([]);
  const [expandedTimeline, setExpandedTimeline] = useState<Set<string>>(new Set());

  // ── Phase 11.1: buttons/modal delegated to <PositionActionButtons> ──────

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const token = localStorage.getItem("pcb_jwt") ?? "";
        const res = await fetch(`${SERVER_URL}/api/positions/live`, {
          headers: { ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        });
        if (!cancelled && res.ok) {
          const data = await res.json() as { ok: boolean; positions: LivePosition[] };
          if (data.ok) setLivePositions(data.positions);
        }
      } catch { /* network error — ignore, keep previous data */ }
    };
    void poll();
    const id = setInterval(() => { void poll(); }, 3_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const openTrades   = trades.filter(t => t.status === "open");
  const closedTrades = trades.filter(t => t.status === "closed");

  // ── Auto-switch to positions tab when open trades appear/disappear ────────
  const openCount = openTrades.length;
  useEffect(() => {
    setTab(prev =>
      openCount === 0 && prev === "positions" ? "overview" :
      openCount > 0  && prev === "overview"  ? "positions" :
      prev,
    );
  }, [openCount]);

  const allSymbols = useMemo(() => ["ALL", ...Array.from(new Set(trades.map(t => t.symbol)))], [trades]);

  const sortedClosed = useMemo(() => {
    let list = filterSym === "ALL" ? closedTrades : closedTrades.filter(t => t.symbol === filterSym);
    return list.sort((a, b) => {
      let va: number, vb: number;
      if (sortField === "time")     { va = new Date(a.exitTime ?? a.timestamp).getTime(); vb = new Date(b.exitTime ?? b.timestamp).getTime(); }
      else if (sortField === "pnl") { va = a.pnl ?? 0; vb = b.pnl ?? 0; }
      else if (sortField === "duration") { va = a.duration ?? 0; vb = b.duration ?? 0; }
      else                          { va = a.symbol.localeCompare(b.symbol); vb = 0; }
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [closedTrades, sortField, sortDir, filterSym]);

  const TABS = [
    { id: "overview",    label: "Overview", icon: <LayoutDashboard size={14} /> },
    { id: "positions",   label: `Open (${openTrades.length})`, icon: <Activity size={14} /> },
    { id: "journal",     label: `Journal (${closedTrades.length})`, icon: <ClipboardList size={14} /> },
    { id: "performance", label: "Analytics", icon: <Award size={14} /> },
  ] as const;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

      {/* ── Tab nav ─────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-slate-900 border border-white/5 rounded-xl p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-lg transition-all ${
              tab === t.id
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-[0_0_15px_rgba(34,211,238,0.15)]"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ═══ OVERVIEW ════════════════════════════════════════════════════ */}
      {tab === "overview" && (
        <div className="space-y-4">

          {/* Quick stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <PremiumStatCard title="Total Net PnL" value={fmtPnL(stats.totalNet)} subtitle={`${stats.totalNet >= 0 ? "+" : ""}${stats.closedTrades ? ((stats.totalNet / (stats.closedTrades * 100)) * 100).toFixed(1) : "0"}%`} valueColor={stats.totalNet >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <PremiumStatCard title="Today" value={fmtPnL(stats.todayPnL)} subtitle={`${stats.todayTrades} trades`} valueColor={stats.todayPnL >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <StatCard label="This Week"        value={fmtPnL(stats.weekPnL)}         sub="7-day PnL"                                color={stats.weekPnL >= 0 ? "green" : "red"} />
            <StatCard label="Win Rate"         value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L`}    color={stats.winRate >= 55 ? "green" : stats.winRate >= 45 ? "yellow" : "red"} />
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Realized PnL"    value={fmtPnL(stats.totalRealised)}  sub="closed trades"    color="cyan" />
            <PremiumStatCard title="Unrealized PnL" value={fmtPnL(stats.totalUnrealized)} subtitle={`${stats.openTrades} open`} valueColor={stats.totalUnrealized >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <StatCard label="Total Fees Paid" value={`$${stats.totalFees.toFixed(2)}`} sub={`${stats.feeImpact.toFixed(1)}% of gross`} color="yellow" />
            <StatCard label="Profit Factor"   value={stats.profitFactor >= 999 ? "∞" : stats.profitFactor.toFixed(2)} sub="gross W / gross L" color={stats.profitFactor >= 1.5 ? "green" : stats.profitFactor >= 1 ? "yellow" : "red"} />
          </div>

          {/* Equity curve */}
          <div className="bg-slate-900 border border-white/5 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-sm">📈 Equity Curve</h3>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-green-400">
                  <span className="w-3 h-0.5 bg-green-400 rounded" /> Equity
                </span>
                <span className="flex items-center gap-1.5 text-rose-400">
                  <span className="w-3 h-0.5 bg-red-400 rounded" /> Drawdown
                </span>
              </div>
            </div>
            <EquityCurve curve={stats.equityCurve} />
            <div className="flex justify-between text-sm text-slate-600 mt-2">
              <span>Peak: <span className="text-green-400">${stats.peakEquity.toFixed(2)}</span></span>
              <span>Max DD: <span className="text-rose-400">${stats.maxDrawdown.toFixed(2)} ({stats.maxDrawdownPct.toFixed(1)}%)</span></span>
              <span>Current DD: <span className={stats.currentDrawdown < 0 ? "text-rose-400" : "text-slate-400"}>${stats.currentDrawdown.toFixed(2)}</span></span>
            </div>
          </div>

          {/* Daily PnL bar chart */}
          {stats.dailyStats.length > 0 && (
            <div className="bg-slate-900 border border-white/5 rounded-2xl p-5">
              <h3 className="text-white font-bold text-sm mb-4">📅 Daily PnL</h3>
              <div className="flex items-end gap-1 h-24">
                {stats.dailyStats.slice(-14).map(d => {
                  const maxAbs = Math.max(...stats.dailyStats.map(x => Math.abs(x.pnl)), 1);
                  const h      = (Math.abs(d.pnl) / maxAbs) * 100;
                  const pos    = d.pnl >= 0;
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                      <div
                        className={`w-full rounded-t transition-all ${pos ? "bg-green-500" : "bg-rose-500"}`}
                        style={{ height: `${h}%`, minHeight: 2 }}
                      />
                      <span className="text-gray-700 text-sm rotate-45 origin-left">{d.date.slice(5)}</span>
                      <div className="absolute bottom-full mb-2 hidden group-hover:block bg-slate-800 border border-white/5 rounded-lg px-2 py-1 text-sm text-white whitespace-nowrap z-10">
                        {d.date}: {fmtPnL(d.pnl)} ({d.trades} trades)
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ OPEN POSITIONS ══════════════════════════════════════════════ */}
      {tab === "positions" && (
        <div className="space-y-3">
          {/* Live refresh indicator */}
          {openTrades.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
              Live analytics • refreshes every 3s
            </div>
          )}

          {openTrades.length === 0 ? (
            <div className="bg-slate-900 border border-white/5 rounded-2xl p-12 text-center text-slate-600">
              <div className="text-4xl mb-3">📡</div>
              <p className="font-semibold text-slate-500">No open positions</p>
              <p className="text-sm mt-1 text-slate-600">
                The bot opens positions automatically when strategy conditions are met.
              </p>
            </div>
          ) : (
            openTrades.map(t => {
              // Merge static trade data with live lifecycle analytics
              const lc = livePositions.find(p => p.symbol === t.symbol.toUpperCase());

              // P&L: prefer live lifecycle data; fall back to trade snapshot
              const pnl  = lc?.unrealizedPnlUsd ?? t.pnl ?? 0;
              const pPct = lc?.unrealizedPnlPct  ?? t.pnlPercent ?? 0;
              const up   = pnl >= 0;

              // SL/TP: use trailed values from lifecycle if available
              const currentSl = lc?.slPrice ?? t.sl ?? null;
              const currentTp = lc?.tpPrice ?? t.tp ?? null;
              const currentPx = lc?.currentPrice ?? t.price;

              const distToTP = currentTp ? ((currentTp - currentPx) / currentPx * 100) : null;
              const distToSL = currentSl ? ((currentPx - currentSl) / currentPx * 100) : null;

              const isTimelineExpanded = expandedTimeline.has(t.id);

              const healthColor =
                lc?.healthColor === "green"  ? "text-green-400 bg-green-500/10 border-green-500/30" :
                lc?.healthColor === "yellow" ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" :
                lc?.healthColor === "red"    ? "text-rose-400 bg-rose-500/10 border-red-500/30" :
                "text-slate-400 bg-slate-800 border-white/5";

              const fmtDurMs = (ms: number) => {
                const s = ms / 1000;
                if (s < 60)    return `${Math.floor(s)}s`;
                if (s < 3600)  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
                return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
              };

              return (
                <OpenPositionCard
                  key={t.id}
                  trade={t}
                  currentPrice={currentPx}
                  pnlUsd={pnl}
                  pnlPct={pPct}
                  calledBy="TradesView"
                  liveData={lc ? {
                    trailingActive:  lc.trailingActive,
                    breakevenActive: lc.breakevenActive,
                    lockedProfitPct: lc.lockedProfitPct,
                    lockedSlPrice:   lc.lockedSlPrice,
                    tpPrice:         lc.tpPrice,
                    slPrice:         lc.slPrice,
                    healthScore:     lc.healthScore,
                    healthColor:     lc.healthColor,
                    rrMultiple:      lc.rrMultiple,
                    distToTpPct:     lc.distToTpPct,
                    distToSlPct:     lc.distToSlPct,
                    atrEstimate:     lc.atrEstimate,
                    strategyType:    lc.strategyType,
                    timeline:        lc.timeline,
                    durationMs:      lc.durationMs,
                  } : undefined}
                >
                  {/* ── Side + order id row ─────────────────────────────── */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-4 -mt-1">
                    <span className={`text-sm font-bold px-2 py-0.5 rounded ${
                      t.type === "BUY" ? "bg-green-500/15 text-green-400" : "bg-rose-500/15 text-rose-400"
                    }`}>{t.type}</span>
                    {t.orderId && <span className="text-slate-600 text-sm">#{t.orderId.slice(-6)}</span>}
                    <span className="text-slate-500 text-sm">
                      {t.strategy}
                      {!lc && t.entryReason ? ` · ${t.entryReason}` : ""}
                    </span>
                  </div>

                  {/* ── Core metrics grid (always shown) ─────────────────── */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
                    <div className="bg-slate-800/60 rounded-xl p-3">
                      <p className="text-slate-600 text-sm">Entry</p>
                      <p className="text-white text-sm font-semibold">${fmtPrice(t.price)}</p>
                    </div>
                    <div className="bg-slate-800/60 rounded-xl p-3">
                      <p className="text-slate-600 text-sm">Current</p>
                      <p className={`text-sm font-semibold ${up ? "text-green-400" : "text-rose-400"}`}>
                        ${fmtPrice(currentPx)}
                      </p>
                    </div>
                    <div className="bg-slate-800/60 rounded-xl p-3">
                      <p className="text-slate-600 text-sm">Qty</p>
                      <p className="text-white text-sm font-semibold">{t.amount.toFixed(6)}</p>
                    </div>
                    <div className="bg-slate-800/60 rounded-xl p-3">
                      <p className="text-slate-600 text-sm">Size</p>
                      <p className="text-white text-sm font-semibold">${t.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    </div>
                    {lc && (
                      <>
                        <div className="bg-slate-800/60 rounded-xl p-3">
                          <p className="text-slate-600 text-sm">High</p>
                          <p className="text-green-500 text-sm font-semibold">${fmtPrice(lc.highestPrice)}</p>
                        </div>
                        <div className="bg-slate-800/60 rounded-xl p-3">
                          <p className="text-slate-600 text-sm">Low</p>
                          <p className="text-red-500 text-sm font-semibold">${fmtPrice(lc.lowestPrice)}</p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Fallback TP/SL when no lifecycle data yet */}
                  {!lc && (t.tp || t.sl) && (
                    <div className="flex gap-3 mb-4">
                      {t.tp && (
                        <div className="flex-1 bg-green-500/8 border border-green-500/20 rounded-xl p-2.5 text-sm">
                          <span className="text-green-400 font-bold">🎯 TP: ${fmtPrice(t.tp)}</span>
                          {distToTP !== null && <span className="text-slate-500 ml-2">({distToTP.toFixed(1)}% away)</span>}
                        </div>
                      )}
                      {t.sl && (
                        <div className="flex-1 bg-rose-500/8 border border-red-500/20 rounded-xl p-2.5 text-sm">
                          <span className="text-rose-400 font-bold">🛑 SL: ${fmtPrice(t.sl)}</span>
                          {distToSL !== null && <span className="text-slate-500 ml-2">({distToSL.toFixed(1)}% away)</span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Fees ─────────────────────────────────────────────── */}
                  {t.fees != null && (
                    <p className="text-slate-600 text-sm mb-3">Fee: ${t.fees.toFixed(4)}</p>
                  )}
                </OpenPositionCard>
              );
            })
          )}
        </div>
      )}

      {/* ═══ TRADE JOURNAL ═══════════════════════════════════════════════ */}
      {tab === "journal" && (
        <div className="bg-slate-900 border border-white/5 rounded-2xl overflow-hidden">
          {/* Filter + sort bar */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/5">
            <div className="flex gap-1 flex-wrap">
              {allSymbols.map(s => (
                <button
                  key={s}
                  onClick={() => setFilterSym(s)}
                  className={`text-sm px-2.5 py-1 rounded-lg transition-all ${
                    filterSym === s
                      ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                      : "bg-slate-800 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-1 ml-auto">
              {(["time", "pnl", "duration"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => { if (sortField === f) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortField(f); setSortDir("desc"); }}}
                  className={`text-sm px-2.5 py-1 rounded-lg transition-all capitalize ${
                    sortField === f
                      ? "bg-gray-700 text-white"
                      : "bg-slate-800 text-slate-600 hover:text-slate-400"
                  }`}
                >
                  {f} {sortField === f ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </button>
              ))}
            </div>
          </div>

          {/* Journal table */}
          {sortedClosed.length === 0 ? (
            <p className="text-slate-600 text-sm text-center py-12">No closed trades yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-600 border-b border-white/5/50 text-left">
                    <th className="px-4 py-2.5 uppercase tracking-wider font-sans font-bold">Asset</th>
                    <th className="px-4 py-2.5 uppercase tracking-wider font-sans font-bold">Side</th>
                    <th className="px-4 py-2.5 text-right uppercase tracking-wider font-sans font-bold">Entry</th>
                    <th className="px-4 py-2.5 text-right uppercase tracking-wider font-sans font-bold">Exit</th>
                    <th className="px-4 py-2.5 text-right uppercase tracking-wider font-sans font-bold">Size</th>
                    <th className="px-4 py-2.5 text-right uppercase tracking-wider font-sans font-bold">Gross P&L</th>
                    <th className="px-4 py-2.5 text-right uppercase tracking-wider font-sans font-bold">Fee</th>
                    <th className="px-4 py-2.5 text-right uppercase tracking-wider font-sans font-bold">Net P&L</th>
                    <th className="px-4 py-2.5 text-center uppercase tracking-wider font-sans font-bold">Exit</th>
                    <th className="px-4 py-2.5 text-center uppercase tracking-wider font-sans font-bold">Mode</th>
                    <th className="px-4 py-2.5 text-right uppercase tracking-wider font-sans font-bold">Duration</th>
                    <th className="px-4 py-2.5 text-right uppercase tracking-wider font-sans font-bold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClosed.map(t => {
                    const pnl   = t.pnl ?? 0;
                    const net   = t.realised ?? pnl;
                    const up    = pnl >= 0;
                    return (
                      <tr key={t.id} className="border-b border-white/5/30 hover:bg-slate-800/20 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          <p className="text-white font-semibold">{t.symbol}/USDT</p>
                          <p className="text-slate-600 text-sm">{t.strategy ?? "—"}</p>
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <span className={`font-bold px-2 py-0.5 rounded text-sm ${
                            t.type === "BUY" ? "bg-green-500/15 text-green-400" : "bg-rose-500/15 text-rose-400"
                          }`}>{t.type}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-sans text-slate-300 font-medium">${fmtPrice(t.price)}</td>
                        <td className="px-4 py-3 text-right font-sans text-slate-300 font-medium">
                          {t.exitPrice ? `$${fmtPrice(t.exitPrice)}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-sans text-slate-400 font-medium">${t.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3 text-right font-medium">
                          <span className={`font-semibold ${up ? "text-green-400" : "text-rose-400"}`}>
                            {fmtPnL(pnl)}
                          </span>
                          <p className={`text-sm ${up ? "text-green-600" : "text-red-600"}`}>
                            {up ? "+" : ""}{t.pnlPercent?.toFixed(2)}%
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right text-yellow-500 font-sans font-medium">
                          ${(t.fees ?? 0).toFixed(3)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          <span className={`font-black ${net >= 0 ? "text-green-300" : "text-red-300"}`}>
                            {fmtPnL(net)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-medium">
                          <span title={t.exitReason}>{REASON_EMOJI[t.exitReason ?? "MANUAL"] ?? "✋"}</span>
                        </td>
                        <td className="px-4 py-3 text-center font-medium">
                          <span className={`text-sm px-1.5 py-0.5 rounded ${
                            t.isReal
                              ? "bg-cyan-500/15 text-cyan-400"
                              : "bg-yellow-500/15 text-yellow-500"
                          }`}>
                            {t.isReal ? "LIVE" : "SIM"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500 font-medium">{durStr(t.duration)}</td>
                        <td className="px-4 py-3 text-right text-slate-600 font-medium">{timeAgo(t.exitTime ?? t.timestamp)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ PERFORMANCE ═════════════════════════════════════════════════ */}
      {tab === "performance" && (
        <div className="space-y-4">

          {/* Key metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <MetricCard label="Profit Factor"  value={stats.profitFactor >= 999 ? "∞" : stats.profitFactor.toFixed(2)} desc="Gross W / Gross L" good={stats.profitFactor >= 1.5} />
            <MetricCard label="Sharpe Ratio"   value={stats.sharpeRatio.toFixed(2)}    desc="Risk-adjusted return" good={stats.sharpeRatio >= 1} />
            <MetricCard label="Max Drawdown"   value={`${stats.maxDrawdownPct.toFixed(1)}%`} desc={`$${Math.abs(stats.maxDrawdown).toFixed(2)}`} good={Math.abs(stats.maxDrawdownPct) < 10} />
            <MetricCard label="Avg Win"        value={`$${stats.avgWin.toFixed(2)}`}   desc="Per winning trade" good />
            <MetricCard label="Avg Loss"       value={`$${Math.abs(stats.avgLoss).toFixed(2)}`} desc="Per losing trade" good={false} />
            <MetricCard label="Avg Duration"   value={durStr(stats.avgDuration)}       desc="Per trade" good />
            <MetricCard label="Win Streak"     value={`${stats.maxWinStreak}`}         desc="Max consecutive wins" good />
            <MetricCard label="Loss Streak"    value={`${stats.maxLossStreak}`}        desc="Max consecutive losses" good={false} />
          </div>

          {/* Current streak */}
          <div className={`flex items-center gap-4 px-5 py-4 rounded-2xl border ${
            stats.currentStreak > 0
              ? "bg-green-500/8 border-green-500/20"
              : stats.currentStreak < 0
                ? "bg-rose-500/8 border-red-500/20"
                : "bg-slate-900 border-white/5"
          }`}>
            <span className="text-3xl">{stats.currentStreak > 0 ? "🔥" : stats.currentStreak < 0 ? "🥶" : "💤"}</span>
            <div>
              <p className={`font-black text-lg ${
                stats.currentStreak > 0 ? "text-green-400" : stats.currentStreak < 0 ? "text-rose-400" : "text-slate-500"
              }`}>
                {stats.currentStreak > 0
                  ? `${stats.currentStreak} WIN streak`
                  : stats.currentStreak < 0
                    ? `${Math.abs(stats.currentStreak)} LOSS streak`
                    : "No streak"}
              </p>
              <p className="text-slate-500 text-sm">Current active streak</p>
            </div>
          </div>

          {/* Best / Worst trade */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {stats.bestTrade && (
              <div className="bg-green-500/8 border border-green-500/20 rounded-2xl p-4">
                <p className="text-green-400 font-bold text-sm mb-3">🏆 Best Trade</p>
                <p className="text-white font-bold">{stats.bestTrade.symbol}/USDT {stats.bestTrade.type}</p>
                <p className="text-green-400 font-black text-2xl">
                  +${(stats.bestTrade.pnl ?? 0).toFixed(2)}
                </p>
                <p className="text-green-500 text-sm">+{stats.bestTrade.pnlPercent?.toFixed(2)}%</p>
                <p className="text-slate-600 text-sm mt-1">{timeAgo(stats.bestTrade.timestamp)} ago</p>
              </div>
            )}
            {stats.worstTrade && (
              <div className="bg-rose-500/8 border border-red-500/20 rounded-2xl p-4">
                <p className="text-rose-400 font-bold text-sm mb-3">💥 Worst Trade</p>
                <p className="text-white font-bold">{stats.worstTrade.symbol}/USDT {stats.worstTrade.type}</p>
                <p className="text-rose-400 font-black text-2xl">
                  ${(stats.worstTrade.pnl ?? 0).toFixed(2)}
                </p>
                <p className="text-red-500 text-sm">{stats.worstTrade.pnlPercent?.toFixed(2)}%</p>
                <p className="text-slate-600 text-sm mt-1">{timeAgo(stats.worstTrade.timestamp)} ago</p>
              </div>
            )}
          </div>

          {/* Symbol breakdown */}
          {Object.keys(stats.bySymbol).length > 0 && (
            <div className="bg-slate-900 border border-white/5 rounded-2xl p-5">
              <h3 className="text-white font-bold text-sm mb-4">📊 PnL by Asset</h3>
              <div className="space-y-2">
                {Object.entries(stats.bySymbol)
                  .sort(([,a], [,b]) => b.pnl - a.pnl)
                  .map(([sym, data]) => {
                    const wr = data.trades ? (data.wins / data.trades * 100) : 0;
                    return (
                      <div key={sym} className="flex items-center gap-3">
                        <span className="text-slate-400 font-bold text-sm w-10">{sym}</span>
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${data.pnl >= 0 ? "bg-green-500" : "bg-rose-500"}`}
                            style={{ width: `${Math.min(100, Math.abs(data.pnl) / Math.max(...Object.values(stats.bySymbol).map(d => Math.abs(d.pnl)), 1) * 100)}%` }}
                          />
                        </div>
                        <span className={`text-sm w-20 text-right ${data.pnl >= 0 ? "text-green-400" : "text-rose-400"}`}>
                          {fmtPnL(data.pnl)}
                        </span>
                        <span className="text-slate-600 text-sm w-16 text-right">{data.trades}T / {wr.toFixed(0)}%W</span>
                        <span className="text-yellow-600 text-sm w-14 text-right">${data.fees.toFixed(2)} fee</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Real vs Sim breakdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900 border border-cyan-500/20 rounded-2xl p-4">
              <p className="text-cyan-400 text-sm font-bold mb-1">🔗 Live Trades</p>
              <p className="text-white font-black text-2xl">{stats.realTrades}</p>
              <p className="text-slate-500 text-sm">Executed on Binance</p>
            </div>
            <div className="bg-slate-900 border border-yellow-500/20 rounded-2xl p-4">
              <p className="text-yellow-400 text-sm font-bold mb-1">🔶 Simulated</p>
              <p className="text-white font-black text-2xl">{stats.simTrades}</p>
              <p className="text-slate-500 text-sm">Paper trading</p>
            </div>
          </div>
        </div>
      )}

    </motion.div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────



function MetricCard({ label, value, desc, good }: { label: string; value: string; desc?: string; good?: boolean }) {
  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-4">
      <p className="text-slate-600 text-sm mb-1">{label}</p>
      <p className={`font-black text-lg ${good ? "text-green-400" : "text-rose-400"}`}>{value}</p>
      {desc && <p className="text-slate-600 text-sm mt-0.5">{desc}</p>}
    </div>
  );
}
