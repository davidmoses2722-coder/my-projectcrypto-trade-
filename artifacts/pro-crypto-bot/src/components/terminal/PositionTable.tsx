import type { OpenPositionRow } from "./types";

function fmt(n: number, dp = 2) { return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }

export function PositionTable({ positions }: { positions: OpenPositionRow[] }) {
  if (positions.length === 0) {
    return <div className="py-8 text-center text-slate-700 text-xs">No open positions.</div>;
  }
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-slate-600 text-left border-b border-white/[0.06]">
          <th className="px-3 py-2 font-normal">Symbol</th>
          <th className="px-3 py-2 font-normal">Side</th>
          <th className="px-3 py-2 font-normal">Size</th>
          <th className="px-3 py-2 font-normal">Entry</th>
          <th className="px-3 py-2 font-normal">Mark</th>
          <th className="px-3 py-2 font-normal">Liq.</th>
          <th className="px-3 py-2 font-normal">uPnL</th>
          <th className="px-3 py-2 font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {positions.map(p => (
          <tr key={p.id} className="border-b border-white/[0.04]">
            <td className="px-3 py-2 font-black text-white">{p.symbol}</td>
            <td className={`px-3 py-2 font-black ${p.side === "long" ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>{p.side.toUpperCase()} {p.leverage}x</td>
            <td className="px-3 py-2 font-mono text-slate-300">{p.size}</td>
            <td className="px-3 py-2 font-mono text-slate-300">${fmt(p.entryPrice)}</td>
            <td className="px-3 py-2 font-mono text-slate-300">${fmt(p.markPrice)}</td>
            <td className="px-3 py-2 font-mono text-amber-500">{p.liquidationPrice ? `$${fmt(p.liquidationPrice)}` : "—"}</td>
            <td className={`px-3 py-2 font-mono ${p.unrealizedPnlUsd >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
              {p.unrealizedPnlUsd >= 0 ? "+" : ""}${fmt(p.unrealizedPnlUsd)} ({p.unrealizedPnlPct >= 0 ? "+" : ""}{p.unrealizedPnlPct.toFixed(1)}%)
            </td>
            <td className="px-3 py-2 text-right">
              <button disabled title="UI build phase — not wired yet" className="text-[10px] font-black text-slate-600 border border-white/[0.08] rounded px-2 py-1 cursor-not-allowed">
                Close
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
