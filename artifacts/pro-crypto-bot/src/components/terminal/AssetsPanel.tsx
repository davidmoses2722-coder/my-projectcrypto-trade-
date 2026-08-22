import type { AssetRow } from "./types";

function fmt(n: number, dp = 2) { return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }

export function AssetsPanel({ assets, label }: { assets: AssetRow[]; label: string }) {
  if (assets.length === 0) return <div className="py-8 text-center text-slate-700 text-xs">No {label.toLowerCase()} yet.</div>;
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-slate-600 text-left border-b border-white/[0.06]">
          <th className="px-3 py-2 font-normal">{label}</th>
          <th className="px-3 py-2 font-normal">Total</th>
          <th className="px-3 py-2 font-normal">Available</th>
          <th className="px-3 py-2 font-normal">In Order</th>
          <th className="px-3 py-2 font-normal">USD Value</th>
        </tr>
      </thead>
      <tbody>
        {assets.map(a => (
          <tr key={a.asset} className="border-b border-white/[0.04]">
            <td className="px-3 py-2 font-black text-white">{a.asset}</td>
            <td className="px-3 py-2 font-mono text-slate-300">{fmt(a.total, 4)}</td>
            <td className="px-3 py-2 font-mono text-slate-300">{fmt(a.available, 4)}</td>
            <td className="px-3 py-2 font-mono text-slate-500">{fmt(a.inOrder, 4)}</td>
            <td className="px-3 py-2 font-mono text-slate-300">${fmt(a.usdValue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
