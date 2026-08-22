import type { RiskEstimate } from "./types";

function fmt(n: number, dp = 2) { return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }

export function RiskPanel({ estimate, availableBalanceUsd }: { estimate: RiskEstimate; availableBalanceUsd: number }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-700 mb-2">Risk Preview</div>
      {[
        ["Available", `$${fmt(availableBalanceUsd)}`, "text-white"],
        ["Est. Margin", `$${fmt(estimate.marginUsd)}`, "text-slate-300"],
        ["Est. Liquidation", estimate.liquidationPrice != null ? `$${fmt(estimate.liquidationPrice)}` : "—", "text-amber-500"],
        ["Est. Fees", `$${fmt(estimate.feeUsd)}`, "text-slate-500"],
        ["Est. PnL", `${estimate.estPnlUsd >= 0 ? "+" : ""}$${fmt(estimate.estPnlUsd)} (${estimate.estPnlPct >= 0 ? "+" : ""}${estimate.estPnlPct.toFixed(2)}%)`, estimate.estPnlUsd >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"],
      ].map(([k, v, cls]) => (
        <div key={String(k)} className="flex justify-between text-[11px]">
          <span className="text-slate-600">{k}</span>
          <span className={`${cls} font-mono`}>{v}</span>
        </div>
      ))}
    </div>
  );
}
