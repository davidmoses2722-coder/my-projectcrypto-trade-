/**
 * FootprintChart — Visual footprint candle chart
 * Shows bid/ask volume at every price level, delta bars, CVD, and absorption zones
 */

import { useState } from "react";
import { FootprintData, FootprintCandle } from "../utils/footprint";
import { FootprintAnalytics } from "../hooks/useFootprint";

interface Props {
  footprint:  FootprintData | null;
  analytics:  FootprintAnalytics | null;
  symbol:     string;
  isLoading:  boolean;
  isLive:     boolean;
  lastUpdate: Date;
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(2);
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 1)    return p.toFixed(3);
  return p.toFixed(6);
}

function DeltaBar({ delta, maxVol }: { delta: number; maxVol: number }) {
  const pct = maxVol > 0 ? Math.abs(delta) / maxVol : 0;
  const w   = Math.round(pct * 100);
  const pos = delta >= 0;
  return (
    <div className="flex items-center gap-1 h-4">
      <div className="flex-1 flex justify-end">
        {!pos && <div style={{ width: `${w}%` }} className="h-2 rounded-sm bg-red-500/70" />}
      </div>
      <div className="w-px h-3 bg-gray-700" />
      <div className="flex-1">
        {pos && <div style={{ width: `${w}%` }} className="h-2 rounded-sm bg-green-500/70" />}
      </div>
    </div>
  );
}

function CandleCluster({ candle, maxVol, isSelected, onClick }: {
  candle: FootprintCandle;
  maxVol: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isBull     = candle.isBullish;
  const pocPrice   = candle.poc;
  const topClusters = candle.clusters.slice(0, 8);

  return (
    <div
      onClick={onClick}
      className={`flex flex-col gap-px cursor-pointer rounded-lg p-1.5 transition-all border ${ 
        isSelected
          ? "border-cyan-500/60 bg-cyan-500/8"
          : "border-transparent hover:border-gray-700 hover:bg-gray-900/40"
      }`}
    >
      {/* OHLC header */}
      <div className={`text-center text-xs font-bold mb-1 ${isBull ? "text-green-400" : "text-red-400"}`}>
        {isBull ? "▲" : "▼"} {fmtPrice(candle.close)}
      </div>

      {/* Cluster rows */}
      {topClusters.map((cluster, idx) => {
        const isPOC      = cluster.price === pocPrice;
        const isImbalance = cluster.imbalance !== "none";
        const bidW = maxVol > 0 ? Math.round((cluster.bidVol / maxVol) * 60) : 0;
        const askW = maxVol > 0 ? Math.round((cluster.askVol / maxVol) * 60) : 0;

        return (
          <div
            key={idx}
            className={`flex items-center gap-1 text-xs rounded px-1 py-px ${ 
              isPOC        ? "bg-yellow-500/20 border border-yellow-500/40" :
              isImbalance  ? "bg-purple-500/10" : ""
            }`}
          >
            {/* Bid vol (sell side) */}
            <div className="w-10 flex justify-end">
              <div className="flex items-center gap-0.5">
                {bidW > 0 && <div style={{ width: `${Math.min(bidW, 40)}px` }} className="h-1.5 bg-red-500/60 rounded-sm" />}
                <span className={`text-[7px] tabular-nums ${cluster.delta < 0 ? "text-red-400" : "text-gray-600"}`}>
                  {fmtVol(cluster.bidVol)}
                </span>
              </div>
            </div>

            {/* Price */}
            <div className={`w-14 text-center text-[7px] tabular-nums ${isPOC ? "text-yellow-400 font-bold" : "text-gray-400"}`}>
              {fmtPrice(cluster.price)}
              {isPOC && <span className="ml-0.5 text-yellow-500">★</span>}
            </div>

            {/* Ask vol (buy side) */}
            <div className="w-10">
              <div className="flex items-center gap-0.5">
                <span className={`text-[7px] tabular-nums ${cluster.delta > 0 ? "text-green-400" : "text-gray-600"}`}>
                  {fmtVol(cluster.askVol)}
                </span>
                {askW > 0 && <div style={{ width: `${Math.min(askW, 40)}px` }} className="h-1.5 bg-green-500/60 rounded-sm" />}
              </div>
            </div>

            {/* Imbalance badge */}
            {isImbalance && (
              <span className={`text-[6px] px-0.5 rounded ${cluster.imbalance === "ask" ? "text-green-300 bg-green-500/20" : "text-red-300 bg-red-500/20"}`}>
                {cluster.imbalance === "ask" ? "BUY" : "SELL"}
              </span>
            )}
          </div>
        );
      })}

      {/* Delta bar */}
      <div className="mt-1 px-1">
        <DeltaBar delta={candle.totalDelta} maxVol={candle.totalVol} />
      </div>

      {/* Delta label */}
      <div className={`text-center text-xs font-bold tabular-nums ${
        candle.totalDelta >= 0 ? "text-green-400" : "text-red-400"
      }`}>
        {candle.totalDelta >= 0 ? "+" : ""}{fmtVol(candle.totalDelta)}
      </div>

      {candle.absorbed && (
        <div className="text-center text-[7px] text-purple-400 font-bold">ABSORB</div>
      )}
    </div>
  );
}

function CVDLine({ candles }: { candles: FootprintCandle[] }) {
  const cvds  = candles.map((c) => c.cvd);
  const minC  = Math.min(...cvds);
  const maxC  = Math.max(...cvds);
  const range = maxC - minC || 1;
  const H     = 40;
  const W     = 100 / (candles.length - 1 || 1);

  const points = cvds.map((c, i) => {
    const x = i * W;
    const y = H - ((c - minC) / range) * H;
    return `${x},${y}`;
  }).join(" ");

  const lastCVD = cvds[cvds.length - 1] ?? 0;
  const isPos   = lastCVD >= (cvds[0] ?? 0);

  return (
    <div className="mt-3 px-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500 font-semibold">CVD (Cumulative Volume Delta)</span>
        <span className={`text-xs font-bold tabular-nums ${isPos ? "text-green-400" : "text-red-400"}`}>
          {lastCVD >= 0 ? "+" : ""}{fmtVol(lastCVD)}
        </span>
      </div>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="w-full h-8">
        <polyline
          points={points}
          fill="none"
          stroke={isPos ? "#22c55e" : "#ef4444"}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        {/* Zero line */}
        <line
          x1="0" y1={H - ((0 - minC) / range) * H}
          x2="100" y2={H - ((0 - minC) / range) * H}
          stroke="#374151" strokeWidth="0.8" strokeDasharray="2,2" vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

export function FootprintChart({ footprint, analytics, symbol, isLoading, isLive, lastUpdate }: Props) {
  const [selectedCandle, setSelectedCandle] = useState<number | null>(null);

  if (isLoading || !footprint) {
    return (
      <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Building footprint candles...</p>
        </div>
      </div>
    );
  }

  const candles = footprint.candles.slice(-16);
  const maxVol  = footprint.maxAbsVol;

  const selected = selectedCandle !== null ? candles[selectedCandle] : candles[candles.length - 1];

  return (
    <div className="rounded-2xl bg-gray-900 border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            🦶 Footprint Chart
            <span className="text-xs font-normal text-gray-400">— {symbol}/USDT</span>
          </h3>
          <p className="text-xs text-gray-600 mt-0.5">Bid/Ask cluster volume · Delta · POC · Imbalance</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full border ${ 
            isLive ? "bg-green-500/10 border-green-500/30 text-green-400"
                   : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
            {isLive ? "LIVE" : "SIM"} · {lastUpdate.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Analytics bar */}
      {analytics && (
        <div className="grid grid-cols-4 divide-x divide-gray-800 border-b border-gray-800">
          {[
            {
              label: "CVD Trend",
              value: analytics.cvdTrend.toUpperCase(),
              color: analytics.cvdTrend === "bullish" ? "text-green-400" :
                     analytics.cvdTrend === "bearish" ? "text-red-400" : "text-gray-400",
            },
            {
              label: "Delta Bias",
              value: analytics.deltaBias.toUpperCase(),
              color: analytics.deltaBias === "buying" ? "text-green-400" :
                     analytics.deltaBias === "selling" ? "text-red-400" : "text-gray-400",
            },
            {
              label: "Buy Pressure",
              value: `${analytics.buyPressure}%`,
              color: analytics.buyPressure > 55 ? "text-green-400" : "text-gray-300",
            },
            {
              label: "Divergence",
              value: analytics.divergence.type === "none" ? "—" :
                     `${analytics.divergence.type.toUpperCase()} ${analytics.divergence.strength}%`,
              color: analytics.divergence.type === "bullish" ? "text-green-400" :
                     analytics.divergence.type === "bearish" ? "text-red-400" : "text-gray-500",
            },
          ].map((stat) => (
            <div key={stat.label} className="px-4 py-2 text-center">
              <p className="text-[13px] font-bold text-gray-600 uppercase tracking-wide">{stat.label}</p>
              <p className={`text-xs font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-gray-600 border-b border-gray-800/50">
        <span className="flex items-center gap-1"><span className="w-2 h-1.5 bg-red-500/60 rounded-sm inline-block" /> Sell (Bid)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-1.5 bg-green-500/60 rounded-sm inline-block" /> Buy (Ask)</span>
        <span className="flex items-center gap-1"><span className="text-yellow-400">★</span> POC (Point of Control)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-1.5 bg-purple-500/40 rounded-sm inline-block" /> ABSORB</span>
        <span className="flex items-center gap-1"><span className="text-green-300 text-xs">BUY</span>/<span className="text-red-300 text-xs">SELL</span> 3:1 Imbalance</span>
      </div>

      {/* Candle grid */}
      <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-800">
        <div className="flex gap-1 p-3 min-w-max">
          {candles.map((candle, i) => (
            <div key={i} className="flex-shrink-0" style={{ width: "120px" }}>
              <CandleCluster
                candle={candle}
                maxVol={maxVol}
                isSelected={selectedCandle === i || (selectedCandle === null && i === candles.length - 1)}
                onClick={() => setSelectedCandle(i === selectedCandle ? null : i)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* CVD Line */}
      <div className="border-t border-gray-800 px-3 pb-3">
        <CVDLine candles={candles} />
      </div>

      {/* Selected candle detail */}
      {selected && (
        <div className="border-t border-gray-800 px-4 py-3 bg-gray-950/50">
          <div className="grid grid-cols-5 gap-3 text-center">
            {[
              { label: "Open",       value: fmtPrice(selected.open),       color: "text-gray-300" },
              { label: "Close",      value: fmtPrice(selected.close),      color: selected.isBullish ? "text-green-400" : "text-red-400" },
              { label: "Total Vol",  value: fmtVol(selected.totalVol),     color: "text-cyan-400" },
              { label: "Net Delta",  value: `${selected.totalDelta >= 0 ? "+" : ""}${fmtVol(selected.totalDelta)}`, color: selected.totalDelta >= 0 ? "text-green-400" : "text-red-400" },
              { label: "POC",        value: fmtPrice(selected.poc),        color: "text-yellow-400" },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-xs text-gray-600">{s.label}</p>
                <p className={`text-xs font-bold tabular-nums ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
            <span>Value Area: {fmtPrice(selected.valueAreaLow)} – {fmtPrice(selected.valueAreaHigh)}</span>
            <span>CVD: {selected.cvd >= 0 ? "+" : ""}{fmtVol(selected.cvd)}</span>
            {selected.absorbed && <span className="text-purple-400 font-semibold">⚡ Absorption Detected</span>}
          </div>
        </div>
      )}
    </div>
  );
}
