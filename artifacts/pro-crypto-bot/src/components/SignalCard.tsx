/**
 * SignalCard — displays a backend-wired OpportunityResult (entry signal)
 * with confidence, entry, SL, TP, strategy, time, reason,
 * conditions met/missing, signal lifetime.
 *
 * Also accepts the legacy Signal type (from crypto types) for backward compatibility.
 */
import { Signal } from "../types/crypto";
import { OpportunityResult } from "../hooks/useOpportunities";
import { PremiumCard } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";
import { Target, Activity, AlertCircle, Clock } from "lucide-react";

// ─── Time helpers ─────────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (p >= 1)    return p.toFixed(3);
  return p.toFixed(5);
}

function signalAge(iso: string): { label: string; pct: number; stale: boolean } {
  if (!iso) return { label: "—", pct: 0, stale: false };
  const elapsed = Date.now() - new Date(iso).getTime();
  const ttl     = 5 * 60 * 1000; // 5 min server cache TTL
  const pct     = Math.min(100, (elapsed / ttl) * 100);
  const stale   = elapsed >= ttl;
  const s       = Math.floor(elapsed / 1000);
  const label   = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  return { label, pct, stale };
}

// ─── RSI meter ────────────────────────────────────────────────────────────────

function RSIMeter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-600">N/A</span>;
  const color =
    value > 70 ? "text-rose-400"
    : value < 30 ? "text-green-400"
    : value > 60 ? "text-orange-400"
    : value < 40 ? "text-blue-400"
    : "text-yellow-400";
  const label =
    value > 70 ? "Overbought"
    : value < 30 ? "Oversold"
    : value > 60 ? "High"
    : value < 40 ? "Low"
    : "Neutral";
  return (
    <span className={`font-semibold ${color}`}>
      {value.toFixed(1)}
      <span className="text-sm font-normal ml-1 opacity-70">({label})</span>
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const clamped = Math.max(-100, Math.min(100, score));
  const isBuy   = clamped >= 0;
  const pct     = Math.abs(clamped);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden flex">
        <div className="w-1/2 flex justify-end">
          {!isBuy && (
            <div className="h-full bg-red-500 rounded-l-full" style={{ width: `${pct}%` }} />
          )}
        </div>
        <div className="w-px bg-gray-600 flex-shrink-0" />
        <div className="w-1/2">
          {isBuy && (
            <div className="h-full bg-green-500 rounded-r-full" style={{ width: `${pct}%` }} />
          )}
        </div>
      </div>
      <span className={`text-sm font-bold w-10 text-right ${
        clamped > 0 ? "text-green-400" : clamped < 0 ? "text-rose-400" : "text-slate-400"
      }`}>
        {clamped > 0 ? `+${clamped.toFixed(0)}` : clamped.toFixed(0)}
      </span>
    </div>
  );
}

// ─── Opportunity Card (wired to real backend data) ────────────────────────────

interface OpportunityCardProps {
  signal: OpportunityResult;
  compact?: boolean;
}

export function OpportunitySignalCard({ signal: opp, compact = false }: OpportunityCardProps) {
  const isLong  = opp.direction === "LONG"  || opp.action === "BUY";
  const isShort = opp.direction === "SHORT" || opp.action === "SHORT";

  const slPct = isLong  ? 0.97 : isShort ? 1.03 : null;
  const tpPct = isLong  ? 1.06 : isShort ? 0.94 : null;
  const sl    = slPct ? opp.lastPrice * slPct : null;
  const tp    = tpPct ? opp.lastPrice * tpPct : null;

  const c = isLong
    ? { bg: "bg-green-500/10",  border: "border-green-500/30",  text: "text-green-400",  badge: "bg-green-500 text-white"  }
    : isShort
    ? { bg: "bg-rose-500/10",    border: "border-red-500/30",    text: "text-rose-400",    badge: "bg-red-500 text-white"    }
    : { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400", badge: "bg-yellow-500/80 text-white" };

  const age = signalAge(opp.scannedAt);

  return (
    <div className={`rounded-xl border p-4 ${c.bg} ${c.border} transition-all hover:scale-[1.01] hover:shadow-lg hover:shadow-black/20`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-black px-3 py-1 rounded-lg ${c.badge}`}>
            {opp.direction ?? opp.action}
          </span>
          <div>
            <p className="text-white font-bold text-sm leading-tight">{opp.displaySymbol}</p>
            <p className="text-slate-500 text-sm capitalize">{opp.strategy.replace("-", " ")}</p>
          </div>
        </div>
        <div className="text-right">
          {opp.isReady && (
            <span className="text-sm font-bold px-1.5 py-0.5 rounded bg-yellow-400/20 border border-yellow-400/30 text-yellow-300 block mb-1">
              READY
            </span>
          )}
          <p className="text-slate-500 text-sm">{timeAgo(new Date(opp.scannedAt))}</p>
        </div>
      </div>

      {/* Reason */}
      {opp.reason && (
        <p className="text-gray-300 text-sm mb-3 leading-relaxed italic">{opp.reason}</p>
      )}

      {/* Price Targets */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-slate-900/60 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider mb-0.5">Entry</p>
          <p className="text-white font-semibold text-sm">${formatPrice(opp.lastPrice)}</p>
        </div>
        <div className="bg-slate-900/60 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider mb-0.5">Target</p>
          <p className="text-green-400 font-semibold text-sm">
            {tp ? `$${formatPrice(tp)}` : "—"}
          </p>
        </div>
        <div className="bg-slate-900/60 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider mb-0.5">Stop Loss</p>
          <p className="text-rose-400 font-semibold text-sm">
            {sl ? `$${formatPrice(sl)}` : "—"}
          </p>
        </div>
      </div>

      {/* Confidence */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-slate-500">Confidence</span>
          <span className={`${c.text} font-semibold`}>{opp.confidence}%</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isLong  ? "bg-gradient-to-r from-green-600 to-green-400"
              : isShort ? "bg-gradient-to-r from-red-600 to-red-400"
              : "bg-gradient-to-r from-yellow-600 to-yellow-400"
            }`}
            style={{ width: `${opp.confidence}%` }}
          />
        </div>
      </div>

      {!compact && (
        <>
          {/* Conditions */}
          <div className="mb-3">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-500">Conditions Met</span>
              <span className="font-bold text-white">
                {opp.conditionsMet}/{opp.conditionsTotal}
              </span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: opp.conditionsTotal }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 h-2 rounded-sm ${i < opp.conditionsMet ? "bg-emerald-400" : "bg-slate-700"}`}
                />
              ))}
            </div>
          </div>

          {/* RSI */}
          {opp.rsi !== null && (
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-slate-500 w-24 flex-shrink-0">RSI (14)</span>
              <RSIMeter value={opp.rsi} />
            </div>
          )}

          {/* Missing conditions */}
          {opp.missingConditions && opp.missingConditions.length > 0 && (
            <div className="mb-2">
              <p className="text-[13px] font-bold text-slate-600 uppercase tracking-wider mb-1">Missing Conditions</p>
              <div className="flex flex-wrap gap-1">
                {opp.missingConditions.map((cond, i) => (
                  <span
                    key={i}
                    className="text-sm px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400"
                  >
                    {cond}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Block reason */}
          {opp.blockReason && (
            <p className="text-sm text-amber-400/80 italic mb-2">Blocked: {opp.blockReason}</p>
          )}

          {/* Signal lifetime */}
          <div className="pt-2 border-t border-white/5/60">
            <div className="flex items-center justify-between text-sm text-slate-500 mb-1">
              <span>Signal age: {age.label}</span>
              <span className={age.stale ? "text-rose-400" : "text-slate-500"}>
                {age.stale ? "STALE" : `${(100 - age.pct).toFixed(0)}% fresh`}
              </span>
            </div>
            <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  age.stale ? "bg-red-500" : age.pct > 66 ? "bg-yellow-400" : "bg-emerald-400"
                }`}
                style={{ width: `${age.pct}%` }}
              />
            </div>
          </div>
        </>
      )}

      {compact && (
        <div className="flex flex-wrap gap-1.5 text-sm">
          {opp.rsi !== null && (
            <span className="bg-slate-800 rounded px-2 py-0.5 text-slate-400">
              RSI: <span className={
                opp.rsi > 70 ? "text-rose-400" : opp.rsi < 30 ? "text-green-400" : "text-yellow-400"
              }>{opp.rsi.toFixed(1)}</span>
            </span>
          )}
          <span className="bg-slate-800 rounded px-2 py-0.5 text-slate-400">
            Conf: <span className={c.text}>{opp.confidence}%</span>
          </span>
          <span className="bg-slate-800 rounded px-2 py-0.5 text-slate-400">
            Conds: <span className="text-white">{opp.conditionsMet}/{opp.conditionsTotal}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Legacy SignalCard (unchanged interface for backward compat) ───────────────

interface SignalCardProps {
  signal: Signal;
  compact?: boolean;
}

const macdColors   = { bullish: "text-green-400", bearish: "text-rose-400", neutral: "text-slate-400" } as const;
const emaColors    = { above: "text-green-400", below: "text-rose-400", crossing: "text-yellow-400" } as const;
const volColors    = { high: "text-green-400", normal: "text-slate-400", low: "text-rose-400" } as const;
const trendColors  = { uptrend: "text-green-400", downtrend: "text-rose-400", sideways: "text-yellow-400" } as const;
const trendIcons   = { uptrend: "↑", downtrend: "↓", sideways: "→" } as const;
const bbColors     = { upper: "text-rose-400", middle: "text-slate-400", lower: "text-green-400" } as const;

export function SignalCard({ signal, compact = false }: SignalCardProps) {
  const typeColors = {
    BUY:  { bg: "bg-green-500/10",  border: "border-green-500/30",  text: "text-green-400",  badge: "bg-green-500 text-white"      },
    SELL: { bg: "bg-rose-500/10",    border: "border-red-500/30",    text: "text-rose-400",    badge: "bg-red-500 text-white"        },
    HOLD: { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400", badge: "bg-yellow-500/80 text-white"  },
  };
  const strengthBadge = {
    STRONG:   "bg-green-500/20 text-green-300 border border-green-500/40",
    MODERATE: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40",
    WEAK:     "bg-gray-500/20 text-slate-400 border border-gray-600",
  };

  const c    = typeColors[signal.type];
  const ind  = signal.indicators;
  const score = ind.score ?? 0;

  return (
    <div className={`rounded-xl border p-4 ${c.bg} ${c.border} transition-all hover:scale-[1.01] hover:shadow-lg hover:shadow-black/20`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-black px-3 py-1 rounded-lg ${c.badge}`}>{signal.type}</span>
          <div>
            <p className="text-white font-bold text-sm leading-tight">{signal.symbol}</p>
            <p className="text-slate-500 text-sm">{signal.coin}</p>
          </div>
        </div>
        <div className="text-right">
          <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${strengthBadge[signal.strength]}`}>
            {signal.strength}
          </span>
          <p className="text-slate-500 text-sm mt-1">{timeAgo(signal.timestamp)}</p>
        </div>
      </div>

      <p className="text-gray-300 text-sm mb-3 leading-relaxed italic">{signal.reason}</p>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-slate-900/60 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider mb-0.5">Entry</p>
          <p className="text-white font-semibold text-sm">${formatPrice(signal.price)}</p>
        </div>
        <div className="bg-slate-900/60 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider mb-0.5">Target</p>
          <p className="text-green-400 font-semibold text-sm">${formatPrice(signal.target)}</p>
        </div>
        <div className="bg-slate-900/60 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[13px] font-bold uppercase tracking-wider mb-0.5">Stop Loss</p>
          <p className="text-rose-400 font-semibold text-sm">${formatPrice(signal.stopLoss)}</p>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-sm text-slate-500 mb-1">
          <span>SELL</span>
          <span className="text-slate-400 font-semibold">Composite Score</span>
          <span>BUY</span>
        </div>
        <ScoreBar score={score} />
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-slate-500">Confidence</span>
          <span className={`${c.text} font-semibold`}>{signal.confidence}%</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              signal.type === "BUY" ? "bg-gradient-to-r from-green-600 to-green-400"
              : signal.type === "SELL" ? "bg-gradient-to-r from-red-600 to-red-400"
              : "bg-gradient-to-r from-yellow-600 to-yellow-400"
            }`}
            style={{ width: `${signal.confidence}%` }}
          />
        </div>
      </div>

      {!compact && (
        <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
          <p className="text-[13px] font-bold uppercase tracking-wider text-slate-600 font-semibold mb-2">Technical Indicators</p>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 w-24 flex-shrink-0">RSI (14)</span>
            <div className="flex-1 mx-2 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  (ind.rsiRaw ?? 50) > 70 ? "bg-red-500"
                  : (ind.rsiRaw ?? 50) < 30 ? "bg-green-500"
                  : "bg-yellow-500"
                }`}
                style={{ width: `${ind.rsiRaw ?? 50}%` }}
              />
            </div>
            <RSIMeter value={ind.rsiRaw ?? null} />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 w-24 flex-shrink-0">MACD (12/26)</span>
            <span className={`${macdColors[ind.macd]} font-semibold`}>{ind.macd.toUpperCase()}</span>
            <span className="text-slate-600 text-sm">
              {ind.macdRaw !== undefined ? (ind.macdRaw > 0 ? "+" : "") + ind.macdRaw.toFixed(4) : "—"}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 w-24 flex-shrink-0">EMA 20/50</span>
            <span className={`${emaColors[ind.ema]} font-semibold`}>
              {ind.ema === "above" ? "BULL" : ind.ema === "below" ? "BEAR" : "CROSS"}
            </span>
            <span className="text-slate-600 text-sm">
              {ind.ema20 !== undefined ? `${formatPrice(ind.ema20)} / ${formatPrice(ind.ema50)}` : "—"}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 w-24 flex-shrink-0">Stochastic</span>
            <div className="flex-1 mx-2 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  (ind.stochastic ?? 50) > 80 ? "bg-red-500"
                  : (ind.stochastic ?? 50) < 20 ? "bg-green-500"
                  : "bg-blue-500"
                }`}
                style={{ width: `${ind.stochastic ?? 50}%` }}
              />
            </div>
            <span className={`font-semibold ${
              (ind.stochastic ?? 50) > 80 ? "text-rose-400"
              : (ind.stochastic ?? 50) < 20 ? "text-green-400"
              : "text-blue-400"
            }`}>
              {ind.stochastic != null ? ind.stochastic.toFixed(1) : "N/A"}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 w-24 flex-shrink-0">ATR (14)</span>
            <span className="text-slate-400">Volatility</span>
            <span className={`font-semibold ${
              (ind.atrPercent ?? 0) > 2 ? "text-rose-400"
              : (ind.atrPercent ?? 0) > 1 ? "text-yellow-400"
              : "text-green-400"
            }`}>
              {ind.atrPercent !== undefined ? ind.atrPercent.toFixed(2) + "%" : "—"}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 w-24 flex-shrink-0">Bollinger B.</span>
            <span className={ind.bbPosition ? bbColors[ind.bbPosition] : "text-slate-600"}>
              {ind.bbPosition
                ? ind.bbPosition === "upper" ? "Upper Band"
                  : ind.bbPosition === "lower" ? "Lower Band"
                  : "Middle Band"
                : "N/A"}
            </span>
            <span className={volColors[ind.volume]}>Vol: {ind.volume.toUpperCase()}</span>
          </div>

          <div className="flex items-center justify-between text-sm pt-1 border-t border-white/5">
            <span className="text-slate-500 w-24 flex-shrink-0">Market Trend</span>
            <span className={`font-bold ${trendColors[ind.trend]}`}>
              {trendIcons[ind.trend]} {ind.trend.toUpperCase()}
            </span>
            <span className="text-slate-600 text-sm">structure</span>
          </div>

          {ind.aiScoreRaw !== undefined && (
            <div className="mt-2 pt-2 border-t border-gray-700/60">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-bold uppercase tracking-wider text-purple-400 font-bold">AI Score</span>
                <span className={`text-sm font-black ${
                  ind.aiScoreRaw > 0 ? "text-green-400" : ind.aiScoreRaw < 0 ? "text-rose-400" : "text-slate-400"
                }`}>
                  {ind.aiScoreRaw > 0 ? "+" : ""}{ind.aiScoreRaw}
                  <span className="text-slate-600 font-normal"> / 7</span>
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-slate-600 w-6 text-right">−7</span>
                <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden flex">
                  <div className="w-1/2 flex justify-end">
                    {ind.aiScoreRaw < 0 && (
                      <div className="h-full bg-red-500 rounded-l-full"
                        style={{ width: `${(Math.abs(ind.aiScoreRaw) / 7) * 100}%` }} />
                    )}
                  </div>
                  <div className="w-px bg-gray-600 flex-shrink-0" />
                  <div className="w-1/2">
                    {ind.aiScoreRaw >= 0 && (
                      <div className="h-full bg-purple-500 rounded-r-full"
                        style={{ width: `${(ind.aiScoreRaw / 7) * 100}%` }} />
                    )}
                  </div>
                </div>
                <span className="text-sm text-slate-600 w-4">+7</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="bg-slate-800/60 rounded-lg p-1.5">
                  <p className="text-[13px] font-bold text-slate-500 uppercase tracking-wide">RSI</p>
                  <p className={`text-sm font-black ${
                    ind.aiRsiPart > 0 ? "text-green-400" : ind.aiRsiPart < 0 ? "text-rose-400" : "text-slate-500"
                  }`}>
                    {ind.aiRsiPart > 0 ? "+" : ""}{ind.aiRsiPart}<span className="text-slate-600 font-normal text-sm">/2</span>
                  </p>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-1.5">
                  <p className="text-[13px] font-bold text-slate-500 uppercase tracking-wide">MACD</p>
                  <p className={`text-sm font-black ${
                    ind.aiMacdPart > 0 ? "text-green-400" : "text-rose-400"
                  }`}>
                    {ind.aiMacdPart > 0 ? "+" : ""}{ind.aiMacdPart}<span className="text-slate-600 font-normal text-sm">/2</span>
                  </p>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-1.5">
                  <p className="text-[13px] font-bold text-slate-500 uppercase tracking-wide">Trend</p>
                  <p className={`text-sm font-black ${
                    ind.aiTrendPart > 0 ? "text-green-400" : ind.aiTrendPart < 0 ? "text-rose-400" : "text-slate-500"
                  }`}>
                    {ind.aiTrendPart > 0 ? "+" : ""}{ind.aiTrendPart}<span className="text-slate-600 font-normal text-sm">/3</span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {compact && (
        <div className="flex flex-wrap gap-1.5 text-sm">
          <span className="bg-slate-800 rounded px-2 py-0.5 text-slate-400">
            RSI: <span className={
              (ind.rsiRaw ?? ind.rsi) > 70 ? "text-rose-400"
              : (ind.rsiRaw ?? ind.rsi) < 30 ? "text-green-400"
              : "text-yellow-400"
            }>{(ind.rsiRaw ?? ind.rsi).toFixed(1)}</span>
          </span>
          <span className="bg-slate-800 rounded px-2 py-0.5 text-slate-400">
            MACD: <span className={macdColors[ind.macd]}>{ind.macd}</span>
          </span>
          <span className="bg-slate-800 rounded px-2 py-0.5 text-slate-400">
            EMA: <span className={emaColors[ind.ema]}>{ind.ema}</span>
          </span>
          <span className="bg-slate-800 rounded px-2 py-0.5 text-slate-400">
            ATR: <span className="text-blue-400">{ind.atrPercent?.toFixed(2) ?? "—"}%</span>
          </span>
          <span className="bg-slate-800 rounded px-2 py-0.5 text-slate-400">
            <span className={trendColors[ind.trend]}>{trendIcons[ind.trend]} {ind.trend}</span>
          </span>
        </div>
      )}
    </div>
  );
}
