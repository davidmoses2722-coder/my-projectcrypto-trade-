/**
 * OrderBookPanel — Live bid/ask depth ladder with:
 *   - Heatmap coloring by size
 *   - Large-order detection (top 5% by size highlighted)
 *   - Order-book imbalance (bid/ask volume ratio)
 *   - Liquidity-pressure indicator
 *   - Spread display
 *   - Depth visualization bars
 */
import { useState, useMemo } from "react";
import { OrderBook, OrderBookLevel } from "../types/crypto";
import { OrderBookAnalytics } from "../hooks/useOrderBook";
import { PremiumCard } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";

interface Props {
  book:      OrderBook;
  analytics: OrderBookAnalytics;
}

function fmt(n: number, price: number): string {
  if (price >= 100)  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (price >= 1)    return n.toFixed(4);
  return n.toFixed(6);
}

function fmtQty(qty: number, price: number): string {
  if (price > 10000) return qty.toFixed(4);
  if (price > 100)   return qty.toFixed(3);
  return qty.toFixed(2);
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ─── Heatmap alpha for a level's notional value ───────────────────────────────
// Returns 0–1 opacity relative to the max notional in the visible book.
function heatAlpha(total: number, maxTotal: number): number {
  if (maxTotal <= 0) return 0;
  return Math.min(1, total / maxTotal);
}

// ─── Level Row ────────────────────────────────────────────────────────────────
function LevelRow({
  level, side, maxTotal, price, isLargeOrder,
}: {
  level:        OrderBookLevel;
  side:         "bid" | "ask";
  maxTotal:     number;
  price:        number;
  isLargeOrder: boolean;
}) {
  const pct      = (level.total / (maxTotal || 1)) * 100;
  const alpha    = heatAlpha(level.total, maxTotal);
  const isWall   = level.isWall;

  // Heatmap: blend base color with intensity
  const bidBase  = isLargeOrder ? `rgba(16,185,129,${0.15 + alpha * 0.45})`  : `rgba(34,197,94,${0.04 + alpha * 0.25})`;
  const askBase  = isLargeOrder ? `rgba(244,63,113,${0.15 + alpha * 0.45})`   : `rgba(244,63,113,${0.04 + alpha * 0.25})`;
  const bgColor  = side === "bid" ? bidBase : askBase;
  const textColor = side === "bid" ? "text-green-400" : "text-rose-400";

  return (
    <div
      className={`relative flex items-center justify-between px-3 py-[3px] text-sm
        hover:bg-white/5 transition-colors
        ${isWall ? "border-l-2 " + (side === "bid" ? "border-green-400" : "border-red-400") : ""}
        ${isLargeOrder ? "ring-1 ring-inset " + (side === "bid" ? "ring-emerald-400/30" : "ring-rose-400/30") : ""}
      `}
      style={{ background: bgColor }}
    >
      {/* Depth fill bar */}
      <div
        className={`absolute inset-y-0 ${side === "bid" ? "right-0" : "left-0"} opacity-20`}
        style={{
          width: `${pct}%`,
          background: side === "bid" ? "rgba(34,197,94,0.4)" : "rgba(244,63,113,0.4)",
        }}
      />

      <span className={`relative z-10 font-semibold ${textColor}`}>
        {fmt(level.price, price)}
        {isWall && <span className="ml-1 text-yellow-400 text-sm">WALL</span>}
        {isLargeOrder && !isWall && (
          <span className={`ml-1 text-sm font-bold ${side === "bid" ? "text-emerald-300" : "text-rose-300"}`}>
            LARGE
          </span>
        )}
      </span>
      <span className="relative z-10 text-slate-400">{fmtQty(level.quantity, price)}</span>
      <span className={`relative z-10 ${
        isLargeOrder ? (side === "bid" ? "text-emerald-300 font-bold" : "text-rose-300 font-bold")
        : isWall      ? "text-yellow-300 font-bold"
        : "text-slate-500"
      }`}>
        {fmtK(level.total)}
      </span>
    </div>
  );
}

// ─── Liquidity Pressure Gauge ─────────────────────────────────────────────────
function LiquidityPressure({ imbalance }: { imbalance: number }) {
  // imbalance is 0–100, >50 = bid heavy
  const bidPressure = imbalance;
  const pressure    =
    bidPressure > 70 ? "Strong Buy Pressure"  :
    bidPressure > 55 ? "Buy Pressure"         :
    bidPressure < 30 ? "Strong Sell Pressure" :
    bidPressure < 45 ? "Sell Pressure"        :
                       "Balanced";

  const pressureColor =
    bidPressure > 70 ? "text-emerald-400" :
    bidPressure > 55 ? "text-green-400"   :
    bidPressure < 30 ? "text-red-500"     :
    bidPressure < 45 ? "text-rose-400"     :
                       "text-slate-400";

  // Needle position: 0% = full sell, 100% = full buy
  const needlePct = Math.max(2, Math.min(98, bidPressure));

  return (
    <div className="px-3 py-3 border-t border-white/5">
      <p className="text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-2 font-semibold">
        Liquidity Pressure
      </p>
      {/* Gauge bar */}
      <div className="relative h-4 bg-slate-800 rounded-full overflow-hidden mb-1.5">
        {/* Gradient fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{
            width: `${needlePct}%`,
            background: `linear-gradient(90deg, rgba(244,63,113,0.6) 0%, rgba(234,179,8,0.6) 50%, rgba(34,197,94,0.8) 100%)`,
          }}
        />
        {/* Needle */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/80 transition-all duration-500"
          style={{ left: `${needlePct}%` }}
        />
        {/* Labels */}
        <div className="absolute inset-0 flex items-center justify-between px-2 text-sm font-bold pointer-events-none">
          <span className="text-rose-300">SELL</span>
          <span className="text-slate-400">NEUTRAL</span>
          <span className="text-emerald-300">BUY</span>
        </div>
      </div>
      <p className={`text-sm font-bold text-center ${pressureColor}`}>{pressure}</p>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function OrderBookPanel({ book, analytics }: Props) {
  const [depthLevels, setDepthLevels] = useState<10 | 15 | 20>(15);
  const [showHeatmap, setShowHeatmap] = useState(true);

  const currentPrice = book.midPrice;
  const bids         = book.bids.slice(0, depthLevels);
  const asks         = book.asks.slice(0, depthLevels);

  // Combined max for unified depth bar scale
  const maxBidTotal  = Math.max(...bids.map(b => b.total), 1);
  const maxAskTotal  = Math.max(...asks.map(a => a.total), 1);
  const maxTotal     = Math.max(maxBidTotal, maxAskTotal);

  // ── Large-order detection: top 5% by notional value ─────────────────────
  const largeOrderThreshold = useMemo(() => {
    const allTotals = [...bids, ...asks].map(l => l.total).sort((a, b) => a - b);
    if (allTotals.length === 0) return Infinity;
    const idx = Math.floor(allTotals.length * 0.95);
    return allTotals[idx] ?? Infinity;
  }, [bids, asks]);

  const imbalance   = analytics.imbalance;
  const isBidHeavy  = imbalance > 50;

  const priceColor =
    currentPrice > (book.bids[1]?.price ?? currentPrice)
      ? "text-green-400"
      : "text-rose-400";

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm">Order Book</span>
          <span className="text-sm text-slate-500">{book.symbol}/USDT</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHeatmap(v => !v)}
            className={`text-sm px-2 py-0.5 rounded transition-colors border ${
              showHeatmap
                ? "bg-purple-500/20 text-purple-400 border-purple-500/40"
                : "text-slate-500 border-gray-700 hover:text-gray-300"
            }`}
          >
            Heatmap
          </button>
          {([10, 15, 20] as const).map(n => (
            <button
              key={n}
              onClick={() => setDepthLevels(n)}
              className={`text-sm px-2 py-0.5 rounded transition-colors ${
                depthLevels === n
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                  : "text-slate-500 hover:text-gray-300"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5/60 text-sm text-slate-600 font-medium">
        <span>Price (USDT)</span>
        <span>Qty</span>
        <span>Total</span>
      </div>

      {/* Asks (sell side) — shown top, reversed so lowest ask at bottom */}
      <div className="flex flex-col-reverse">
        {asks.map((level, i) => (
          <LevelRow
            key={`ask-${i}`}
            level={level}
            side="ask"
            maxTotal={showHeatmap ? maxTotal : maxAskTotal}
            price={currentPrice}
            isLargeOrder={level.total >= largeOrderThreshold}
          />
        ))}
      </div>

      {/* Mid price / spread bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-950 border-y border-gray-700">
        <span className={`text-sm font-black ${priceColor}`}>
          {fmt(currentPrice, currentPrice)}
        </span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">
            Spread: <span className="text-gray-300">{book.spread.toFixed(currentPrice < 1 ? 5 : 2)}</span>
          </span>
          <span className="text-slate-500">
            (<span className="text-yellow-400">{book.spreadPct.toFixed(3)}%</span>)
          </span>
        </div>
      </div>

      {/* Bids (buy side) */}
      <div>
        {bids.map((level, i) => (
          <LevelRow
            key={`bid-${i}`}
            level={level}
            side="bid"
            maxTotal={showHeatmap ? maxTotal : maxBidTotal}
            price={currentPrice}
            isLargeOrder={level.total >= largeOrderThreshold}
          />
        ))}
      </div>

      {/* Imbalance bar */}
      <div className="px-3 py-3 border-t border-white/5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-green-400 font-semibold">Bids {fmtK(analytics.totalBidVol)}</span>
          <span className="text-sm text-slate-500">Imbalance</span>
          <span className="text-sm text-rose-400 font-semibold">Asks {fmtK(analytics.totalAskVol)}</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-500"
            style={{ width: `${imbalance}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-red-400 to-red-600 transition-all duration-500"
            style={{ width: `${100 - imbalance}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-sm text-green-400">{imbalance.toFixed(1)}%</span>
          <span className={`text-sm font-bold ${isBidHeavy ? "text-green-400" : "text-rose-400"}`}>
            {isBidHeavy ? "Buy Pressure" : "Sell Pressure"}
          </span>
          <span className="text-sm text-rose-400">{(100 - imbalance).toFixed(1)}%</span>
        </div>
      </div>

      {/* Liquidity pressure gauge */}
      <LiquidityPressure imbalance={imbalance} />

      {/* Depth summary */}
      <div className="grid grid-cols-2 gap-0 border-t border-white/5">
        <div className="px-3 py-2 border-r border-white/5">
          <p className="text-sm text-slate-600 mb-0.5">Bid depth ±1%</p>
          <p className="text-sm font-bold text-green-400">{fmtK(analytics.depth1pct.bidDepth)}</p>
        </div>
        <div className="px-3 py-2">
          <p className="text-sm text-slate-600 mb-0.5">Ask depth ±1%</p>
          <p className="text-sm font-bold text-rose-400">{fmtK(analytics.depth1pct.askDepth)}</p>
        </div>
        <div className="px-3 py-2 border-t border-r border-white/5">
          <p className="text-sm text-slate-600 mb-0.5">Bid depth ±2%</p>
          <p className="text-sm font-bold text-green-400">{fmtK(analytics.depth2pct.bidDepth)}</p>
        </div>
        <div className="px-3 py-2 border-t border-white/5">
          <p className="text-sm text-slate-600 mb-0.5">Ask depth ±2%</p>
          <p className="text-sm font-bold text-rose-400">{fmtK(analytics.depth2pct.askDepth)}</p>
        </div>
      </div>

      {/* Large order legend */}
      <div className="px-3 py-2 border-t border-white/5 flex items-center gap-3 text-sm text-slate-600">
        <span>
          <span className="text-emerald-400 font-bold">LARGE</span> = top 5% by notional
        </span>
        <span>
          <span className="text-yellow-400 font-bold">WALL</span> = detected support/resistance
        </span>
      </div>

      {/* Largest wall callout */}
      {analytics.largestWall && (
        <div className="mx-3 mb-3 rounded-lg px-3 py-2 bg-yellow-500/8 border border-yellow-500/25">
          <div className="flex items-center gap-2">
            <span className="text-yellow-400 text-sm font-bold">!</span>
            <div>
              <p className="text-yellow-400 text-sm font-bold">
                Largest Wall — {analytics.largestWall.side === "bid" ? "BUY" : "SELL"} side
              </p>
              <p className="text-slate-400 text-sm">
                {fmt(analytics.largestWall.level.price, currentPrice)} USDT ·{" "}
                {fmtK(analytics.largestWall.level.total)} resting
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
