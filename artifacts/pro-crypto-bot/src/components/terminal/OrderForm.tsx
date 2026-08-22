import type { OrderKind, TimeInForce } from "./types";

export interface OrderFormValue {
  kind: OrderKind;
  price: number;
  triggerPrice: number;
  quantity: number;
  tif: TimeInForce;
  reduceOnly: boolean;
}

const KINDS: { key: OrderKind; label: string }[] = [
  { key: "market", label: "Market" },
  { key: "limit", label: "Limit" },
  { key: "trigger", label: "Trigger" },
  { key: "conditional", label: "Conditional" },
];

interface Props {
  value: OrderFormValue;
  onChange: (v: OrderFormValue) => void;
  quoteAsset: string;
  baseAsset: string;
  availableBalanceUsd: number;
  showTif?: boolean; // futures-only TIF/reduce-only row
}

export function OrderForm({ value, onChange, quoteAsset, baseAsset, availableBalanceUsd, showTif }: Props) {
  const set = (patch: Partial<OrderFormValue>) => onChange({ ...value, ...patch });
  const pct = availableBalanceUsd > 0 ? Math.min(100, Math.round((value.quantity / availableBalanceUsd) * 100)) : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Order kind */}
      <div className="grid grid-cols-4 gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
        {KINDS.map(({ key, label }) => (
          <button key={key} onClick={() => set({ kind: key })}
            className={`py-1.5 rounded-md text-[10px] font-black transition ${value.kind === key ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-400"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {(value.kind === "limit" || value.kind === "trigger" || value.kind === "conditional") && (
        <div>
          <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider">
            {value.kind === "limit" ? `Limit Price (${quoteAsset})` : `Trigger Price (${quoteAsset})`}
          </label>
          <input
            type="number"
            value={(value.kind === "limit" ? value.price : value.triggerPrice) || ""}
            onChange={e => set(value.kind === "limit" ? { price: Number(e.target.value) || 0 } : { triggerPrice: Number(e.target.value) || 0 })}
            placeholder="Enter price"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-slate-700 focus:outline-none focus:border-[#0ea5e9]/40"
          />
        </div>
      )}

      <div>
        <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider">Quantity ({quoteAsset})</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-sm font-mono">$</span>
          <input
            type="number" min={0} step={10} value={value.quantity || ""}
            onChange={e => set({ quantity: Math.max(0, Number(e.target.value) || 0) })}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-7 pr-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#0ea5e9]/40"
          />
        </div>
      </div>

      <div>
        <input
          type="range" min={0} max={100} step={1} value={pct}
          onChange={e => set({ quantity: Math.round((availableBalanceUsd * Number(e.target.value)) / 100) })}
          className="w-full h-1 rounded-full appearance-none cursor-pointer accent-[#0ea5e9]"
        />
        <div className="grid grid-cols-4 gap-1 mt-2">
          {[25, 50, 75, 100].map(p => (
            <button key={p} onClick={() => set({ quantity: Math.round((availableBalanceUsd * p) / 100) })}
              className="py-1 rounded text-[11px] font-black border border-white/[0.08] text-slate-600 hover:text-slate-400 hover:border-white/[0.15] transition"
            >
              {p}%
            </button>
          ))}
        </div>
      </div>

      {showTif && (
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={value.reduceOnly} onChange={e => set({ reduceOnly: e.target.checked })} className="accent-[#0ea5e9]" />
            Reduce Only
          </label>
          <select
            value={value.tif}
            onChange={e => set({ tif: e.target.value as TimeInForce })}
            className="bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-1 text-slate-300"
          >
            <option value="GTC">GTC</option>
            <option value="IOC">IOC</option>
            <option value="FOK">FOK</option>
            <option value="POST_ONLY">Post-Only</option>
          </select>
        </div>
      )}

      <div className="text-[10px] text-slate-700 font-mono">{baseAsset} notional shown in Risk Preview below</div>
    </div>
  );
}
