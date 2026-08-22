import type { RecentTrade } from "./types";

function fmt(n: number, dp = 2) { return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
function fmtTime(ms: number) { return new Date(ms).toLocaleTimeString(undefined, { hour12: false }); }

export function RecentTrades({ trades }: { trades: RecentTrade[] }) {
  return (
    <div className="flex flex-col h-full text-[11px] font-mono overflow-hidden">
      <div className="flex justify-between px-3 py-1 text-[10px] text-slate-600 font-sans flex-shrink-0">
        <span>Price</span><span>Amount</span><span>Time</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {trades.map(t => (
          <div key={t.id} className="flex justify-between px-3 py-[2px]">
            <span className={t.side === "buy" ? "text-[#0ECB81]" : "text-[#F6465D]"}>{fmt(t.price)}</span>
            <span className="text-slate-300">{fmt(t.amount, 4)}</span>
            <span className="text-slate-600">{fmtTime(t.time)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
