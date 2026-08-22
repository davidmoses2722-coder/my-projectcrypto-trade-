import type { HistoryOrderRow, OpenOrderRow, TradeHistoryRow } from "./types";

function fmt(n: number, dp = 2) { return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
function fmtDate(ms: number) { return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }

export function OpenOrdersTable({ orders }: { orders: OpenOrderRow[] }) {
  if (orders.length === 0) return <div className="py-8 text-center text-slate-700 text-xs">No open orders.</div>;
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-slate-600 text-left border-b border-white/[0.06]">
          <th className="px-3 py-2 font-normal">Symbol</th>
          <th className="px-3 py-2 font-normal">Side</th>
          <th className="px-3 py-2 font-normal">Type</th>
          <th className="px-3 py-2 font-normal">Price</th>
          <th className="px-3 py-2 font-normal">Qty</th>
          <th className="px-3 py-2 font-normal">Filled</th>
          <th className="px-3 py-2 font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id} className="border-b border-white/[0.04]">
            <td className="px-3 py-2 font-black text-white">{o.symbol}</td>
            <td className={`px-3 py-2 font-black ${o.side === "buy" ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>{o.side.toUpperCase()}</td>
            <td className="px-3 py-2 text-slate-400 capitalize">{o.kind}</td>
            <td className="px-3 py-2 font-mono text-slate-300">{o.price ? `$${fmt(o.price)}` : "Market"}</td>
            <td className="px-3 py-2 font-mono text-slate-300">{o.quantity}</td>
            <td className="px-3 py-2 text-slate-400">{o.filledPct}%</td>
            <td className="px-3 py-2 text-right">
              <button disabled title="UI build phase — not wired yet" className="text-[10px] font-black text-slate-600 border border-white/[0.08] rounded px-2 py-1 cursor-not-allowed">Cancel</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OrderHistoryTable({ orders }: { orders: HistoryOrderRow[] }) {
  if (orders.length === 0) return <div className="py-8 text-center text-slate-700 text-xs">No order history yet.</div>;
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-slate-600 text-left border-b border-white/[0.06]">
          <th className="px-3 py-2 font-normal">Symbol</th>
          <th className="px-3 py-2 font-normal">Side</th>
          <th className="px-3 py-2 font-normal">Type</th>
          <th className="px-3 py-2 font-normal">Price</th>
          <th className="px-3 py-2 font-normal">Qty</th>
          <th className="px-3 py-2 font-normal">Status</th>
          <th className="px-3 py-2 font-normal">Time</th>
        </tr>
      </thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id} className="border-b border-white/[0.04]">
            <td className="px-3 py-2 font-black text-white">{o.symbol}</td>
            <td className={`px-3 py-2 font-black ${o.side === "buy" ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>{o.side.toUpperCase()}</td>
            <td className="px-3 py-2 text-slate-400 capitalize">{o.kind}</td>
            <td className="px-3 py-2 font-mono text-slate-300">{o.price ? `$${fmt(o.price)}` : "Market"}</td>
            <td className="px-3 py-2 font-mono text-slate-300">{o.quantity}</td>
            <td className="px-3 py-2 text-slate-400 capitalize">{o.status}</td>
            <td className="px-3 py-2 text-slate-600">{fmtDate(o.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TradeHistoryTable({ trades }: { trades: TradeHistoryRow[] }) {
  if (trades.length === 0) return <div className="py-8 text-center text-slate-700 text-xs">No closed trades yet.</div>;
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-slate-600 text-left border-b border-white/[0.06]">
          <th className="px-3 py-2 font-normal">Symbol</th>
          <th className="px-3 py-2 font-normal">Side</th>
          <th className="px-3 py-2 font-normal">Entry</th>
          <th className="px-3 py-2 font-normal">Exit</th>
          <th className="px-3 py-2 font-normal">PnL</th>
          <th className="px-3 py-2 font-normal">Reason</th>
          <th className="px-3 py-2 font-normal">Closed</th>
        </tr>
      </thead>
      <tbody>
        {trades.map(t => (
          <tr key={t.id} className="border-b border-white/[0.04]">
            <td className="px-3 py-2 font-black text-white">{t.symbol}</td>
            <td className={`px-3 py-2 font-black ${t.side === "long" ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>{t.side.toUpperCase()}</td>
            <td className="px-3 py-2 font-mono text-slate-300">${fmt(t.entryPrice)}</td>
            <td className="px-3 py-2 font-mono text-slate-300">${fmt(t.exitPrice)}</td>
            <td className={`px-3 py-2 font-mono ${t.pnlUsd >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>{t.pnlUsd >= 0 ? "+" : ""}${fmt(t.pnlUsd)} ({t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%)</td>
            <td className="px-3 py-2 text-slate-400">{t.reason}</td>
            <td className="px-3 py-2 text-slate-600">{fmtDate(t.closedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
