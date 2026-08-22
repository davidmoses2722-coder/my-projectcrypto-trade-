import { useMemo } from "react";
import type { OrderBookSnapshot } from "./types";

function fmt(n: number, dp = 2) { return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }

export function OrderBook({ book }: { book: OrderBookSnapshot }) {
  const maxAmount = useMemo(
    () => Math.max(1e-9, ...book.asks.map(a => a.amount), ...book.bids.map(b => b.amount)),
    [book],
  );
  const bidTotal = useMemo(() => book.bids.reduce((s, b) => s + b.amount, 0), [book]);
  const askTotal = useMemo(() => book.asks.reduce((s, a) => s + a.amount, 0), [book]);
  const bidPct = bidTotal + askTotal > 0 ? (bidTotal / (bidTotal + askTotal)) * 100 : 50;

  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[book.asks.length - 1]?.price ?? 0;
  const spread = bestAsk - bestBid;
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;

  return (
    <div className="flex flex-col h-full text-[11px] font-mono">
      <div className="flex justify-between px-3 py-1 text-[10px] text-slate-600 font-sans">
        <span>Price (USDT)</span><span>Amount</span>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {book.asks.map((a, i) => (
          <div key={`ask-${i}`} className="relative flex justify-between px-3 py-[2px]">
            <div className="absolute inset-y-0 right-0 bg-[#F6465D]/[0.12]" style={{ width: `${(a.amount / maxAmount) * 100}%` }} />
            <span className="relative z-10 text-[#F6465D]">{fmt(a.price)}</span>
            <span className="relative z-10 text-slate-300">{fmt(a.amount, 4)}</span>
          </div>
        ))}
      </div>

      <div className="px-3 py-1.5 my-0.5 border-y border-white/[0.06]">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-black text-[#0ECB81]">{fmt(mid)}</span>
          <span className="text-[10px] text-slate-600">Spread {fmt(spread)} ({spreadPct.toFixed(3)}%)</span>
        </div>
      </div>

      <div>
        {book.bids.map((b, i) => (
          <div key={`bid-${i}`} className="relative flex justify-between px-3 py-[2px]">
            <div className="absolute inset-y-0 right-0 bg-[#0ECB81]/[0.12]" style={{ width: `${(b.amount / maxAmount) * 100}%` }} />
            <span className="relative z-10 text-[#0ECB81]">{fmt(b.price)}</span>
            <span className="relative z-10 text-slate-300">{fmt(b.amount, 4)}</span>
          </div>
        ))}
      </div>

      <div className="flex h-4 flex-shrink-0 font-sans text-[9px] font-black">
        <div className="flex items-center justify-center text-[#0ECB81]" style={{ width: `${bidPct}%`, background: "rgba(14,203,129,0.15)" }}>
          {bidPct.toFixed(0)}%
        </div>
        <div className="flex items-center justify-center text-[#F6465D]" style={{ width: `${100 - bidPct}%`, background: "rgba(246,70,93,0.15)" }}>
          {(100 - bidPct).toFixed(0)}%
        </div>
      </div>
    </div>
  );
}
