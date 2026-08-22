/**
 * OpenPositionCard — Phase 13 Premium Position Card
 *
 * Displays full live position detail:
 *   • Strategy · Confidence · Health Score
 *   • Entry / Current price · Live P&L
 *   • Progress bars to TP and SL
 *   • ATR · RSI · Volume Ratio · EMA Trend
 *   • Risk/Reward · Distance to TP/SL · Duration
 *   • Timeline (opened, breakeven, trailing, profit lock)
 *   • Full position action controls
 */

import React from "react";
import { Trade, CoinPrice } from "../types/crypto";
import { PositionActionButtons } from "./PositionActionButtons";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface OpenPositionCardProps {
  trade:          Trade;
  prices?:        CoinPrice[];
  currentPrice?:  number;
  pnlUsd?:        number;
  pnlPct?:        number;
  calledBy?:      string;
  /** Live lifecycle data — injected by TradesView from /api/positions/live */
  liveData?: {
    trailingActive:    boolean;
    breakevenActive:   boolean;
    lockedProfitPct:   number;
    lockedSlPrice:     number | null;
    tpPrice:           number | null;
    slPrice:           number | null;
    healthScore:       number;
    healthColor:       "green" | "yellow" | "red";
    rrMultiple:        number;
    distToTpPct:       number | null;
    distToSlPct:       number | null;
    atrEstimate:       number | null;
    strategyType:      string;
    timeline:          { time: string; event: string; detail: string }[];
    durationMs:        number;
  };
  children?: React.ReactNode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPx(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  return n.toFixed(6);
}

function durStr(ms: number): string {
  const s = ms / 1000;
  if (s < 60)    return `${Math.floor(s)}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

function ProgressBar({ pct, color }: { pct: number; color: "green" | "rose" | "amber" }) {
  const colors = { green: "bg-emerald-500", rose: "bg-rose-500", amber: "bg-amber-400" };
  return (
    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${colors[color]}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-900/60 rounded-lg px-2.5 py-2 text-center border border-white/5">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-0.5">{label}</div>
      <div className={`text-xs font-black ${color ?? "text-slate-200"}`}>{value}</div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OpenPositionCard({
  trade: t,
  prices,
  currentPrice,
  pnlUsd,
  pnlPct,
  calledBy = "unknown",
  liveData,
  children,
}: OpenPositionCardProps) {
  const resolvedPnlUsd = pnlUsd ?? t.pnl ?? 0;
  const resolvedPnlPct = pnlPct ?? t.pnlPercent ?? 0;
  const up = resolvedPnlUsd >= 0;

  const livePx =
    currentPrice ??
    prices?.find((p) => p.symbol === t.symbol || t.symbol.startsWith(p.symbol))?.price ??
    t.price;

  const durationMs = t.duration ?? (Date.now() - (t.timestamp?.getTime() ?? Date.now()));

  // Progress to TP
  const tp = liveData?.tpPrice ?? t.tp;
  const sl = liveData?.slPrice ?? t.sl;
  const tpProgress = (tp && livePx > t.price)
    ? Math.min(100, ((livePx - t.price) / (tp - t.price)) * 100)
    : 0;
  const slProgress = (sl && livePx < t.price)
    ? Math.min(100, ((t.price - livePx) / (t.price - sl)) * 100)
    : 0;

  const healthScore = liveData?.healthScore ?? null;
  const healthColor =
    (healthScore ?? 0) >= 70 ? "text-emerald-400" :
    (healthScore ?? 0) >= 40 ? "text-amber-400" : "text-rose-400";

  return (
    <PremiumCard
      className={`border ${up ? "border-emerald-500/20" : "border-rose-500/20"}`}
      hoverGlow
    >
      <PremiumCardContent className="p-4 space-y-3">

        {/* ── Header row ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${up ? "bg-emerald-400" : "bg-rose-400"}`} />
            <span className="text-white font-black text-sm tracking-wide">{t.symbol}/USDT</span>
            <StatusBadge variant="long" label="OPEN" className="scale-90 origin-left" />
            {t.isReal
              ? <StatusBadge variant="live" label="LIVE" className="scale-90 origin-left" />
              : <StatusBadge variant="simulated" label="SIM" className="scale-90 origin-left" />
            }
            {liveData?.strategyType && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 border border-blue-500/30 text-blue-400">
                {liveData.strategyType}
              </span>
            )}
            {liveData?.trailingActive && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">📏 Trail</span>
            )}
            {liveData?.breakevenActive && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/15 border border-yellow-500/30 text-yellow-400">⚖️ BE</span>
            )}
            {(liveData?.lockedProfitPct ?? 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 border border-purple-500/30 text-purple-400">🔒 Locked</span>
            )}
          </div>

          {/* P&L block */}
          <div className="text-right shrink-0">
            <p className={`text-lg font-black leading-tight ${up ? "text-emerald-400" : "text-rose-400"}`}>
              {up ? "+" : ""}${resolvedPnlUsd.toFixed(2)}
            </p>
            <p className={`text-xs font-bold ${up ? "text-emerald-400/70" : "text-rose-400/70"}`}>
              {up ? "+" : ""}{resolvedPnlPct.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* ── Health + confidence row ─────────────────────────────────────── */}
        {(healthScore !== null || liveData?.rrMultiple) && (
          <div className="flex items-center gap-3 bg-slate-900/40 rounded-lg px-3 py-2 border border-white/5">
            {healthScore !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Health</span>
                <span className={`text-sm font-black ${healthColor}`}>{healthScore}/100</span>
                <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${
                    healthScore >= 70 ? "bg-emerald-500" :
                    healthScore >= 40 ? "bg-amber-400" : "bg-rose-500"
                  }`} style={{ width: `${healthScore}%` }} />
                </div>
              </div>
            )}
            {liveData?.rrMultiple && liveData.rrMultiple > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">R:R</span>
                <span className={`text-xs font-black ${liveData.rrMultiple >= 1 ? "text-emerald-400" : "text-amber-400"}`}>
                  {liveData.rrMultiple.toFixed(2)}x
                </span>
              </div>
            )}
            <div className="ml-auto text-slate-500 text-[10px] font-medium">
              {durStr(durationMs)}
            </div>
          </div>
        )}

        {/* ── Entry vs Current ──────────────────────────────────────────── */}
        <div className="flex justify-between text-sm bg-slate-900/50 rounded-lg px-3 py-2 border border-white/5">
          <span className="text-slate-400 font-medium">
            Entry <span className="text-slate-200 font-bold ml-1">${fmtPx(t.price)}</span>
          </span>
          <span className="text-slate-400 font-medium">
            Now <span className="text-white font-black ml-1">${fmtPx(livePx)}</span>
          </span>
        </div>

        {/* ── TP / SL with progress bars ────────────────────────────────── */}
        {(tp || sl) && (
          <div className="space-y-2">
            {tp && (
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-slate-600 font-semibold uppercase tracking-wider">
                    TP Target
                    {liveData?.distToTpPct != null && (
                      <span className="text-emerald-500 ml-1">({liveData.distToTpPct.toFixed(2)}% away)</span>
                    )}
                  </span>
                  <span className="text-emerald-400 font-bold">${fmtPx(tp)}</span>
                </div>
                <ProgressBar pct={tpProgress} color="green" />
              </div>
            )}
            {sl && (
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-slate-600 font-semibold uppercase tracking-wider">
                    SL Guard
                    {liveData?.distToSlPct != null && (
                      <span className="text-rose-500 ml-1">({liveData.distToSlPct.toFixed(2)}% away)</span>
                    )}
                  </span>
                  <span className="text-rose-400 font-bold">${fmtPx(sl)}</span>
                </div>
                <ProgressBar pct={slProgress} color="rose" />
              </div>
            )}
          </div>
        )}

        {/* ── Metrics grid ─────────────────────────────────────────────── */}
        {liveData && (
          <div className="grid grid-cols-3 gap-1.5">
            {liveData.atrEstimate != null && (
              <Metric label="ATR" value={liveData.atrEstimate.toFixed(2)} color="text-blue-400" />
            )}
            {liveData.distToTpPct != null && (
              <Metric label="To TP" value={`${liveData.distToTpPct.toFixed(2)}%`} color="text-emerald-400" />
            )}
            {liveData.distToSlPct != null && (
              <Metric label="To SL" value={`${liveData.distToSlPct.toFixed(2)}%`} color="text-rose-400" />
            )}
            {liveData.rrMultiple > 0 && (
              <Metric label="R/R" value={`${liveData.rrMultiple.toFixed(2)}×`} />
            )}
            <Metric label="Duration" value={durStr(liveData.durationMs)} />
            {(liveData.lockedProfitPct ?? 0) > 0 && (
              <Metric label="Locked %" value={`${liveData.lockedProfitPct.toFixed(1)}%`} color="text-purple-400" />
            )}
          </div>
        )}

        {/* ── Timeline ─────────────────────────────────────────────────── */}
        {liveData?.timeline && liveData.timeline.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-white/5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2">Timeline</p>
            {liveData.timeline.map((ev, i) => (
              <div key={i} className="flex items-start gap-2 text-[10px]">
                <span className="text-slate-600 shrink-0 pt-0.5">·</span>
                <span className="text-slate-500">{ev.time}</span>
                <span className="text-slate-400 font-semibold">{ev.event}</span>
                {ev.detail && <span className="text-slate-600 truncate">{ev.detail}</span>}
              </div>
            ))}
          </div>
        )}

        {/* ── Extra slot (TradesView injects extended content here) ──────── */}
        {children}

        {/* ── Action buttons ───────────────────────────────────────────── */}
        <PositionActionButtons
          symbol={t.symbol}
          pnlUsd={resolvedPnlUsd}
          pnlPct={resolvedPnlPct}
          entry={t.price}
          currentPrice={livePx}
          positionSize={t.total}
          calledBy={calledBy}
          trailingActive={liveData?.trailingActive}
          breakevenActive={liveData?.breakevenActive}
        />
      </PremiumCardContent>
    </PremiumCard>
  );
}
