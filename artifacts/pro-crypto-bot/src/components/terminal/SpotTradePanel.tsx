import { useState } from "react";
import { OrderForm, type OrderFormValue } from "./OrderForm";
import { RiskPanel } from "./RiskPanel";
import type { OrderSide, RiskEstimate } from "./types";

interface Props {
  baseAsset: string;
  quoteAsset: string;
  livePrice: number;
  availableBalanceUsd: number;
}

export function SpotTradePanel({ baseAsset, quoteAsset, livePrice, availableBalanceUsd }: Props) {
  const [side, setSide] = useState<OrderSide>("buy");
  const [form, setForm] = useState<OrderFormValue>({
    kind: "market", price: livePrice, triggerPrice: livePrice, quantity: 0, tif: "GTC", reduceOnly: false,
  });

  const feeUsd = form.quantity * 0.001;
  const estimate: RiskEstimate = {
    marginUsd: form.quantity,
    liquidationPrice: null, // spot has no liquidation
    feeUsd,
    estPnlUsd: 0,
    estPnlPct: 0,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <span className="text-[10px] text-slate-600">Available</span>
        <span className="text-sm font-black text-white">${availableBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </div>

      <div className="grid grid-cols-2 gap-0 border-b border-white/[0.06]">
        <button onClick={() => setSide("buy")}
          className={`py-3 font-black text-sm transition ${side === "buy" ? "bg-[#0ECB81] text-black" : "text-slate-600 hover:text-[#0ECB81]"}`}
        >
          Buy
        </button>
        <button onClick={() => setSide("sell")}
          className={`py-3 font-black text-sm transition ${side === "sell" ? "bg-[#F6465D] text-white" : "text-slate-600 hover:text-[#F6465D]"}`}
        >
          Sell
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-3 px-4 py-3">
        <OrderForm
          value={form} onChange={setForm}
          quoteAsset={quoteAsset} baseAsset={baseAsset}
          availableBalanceUsd={availableBalanceUsd}
        />
        <RiskPanel estimate={estimate} availableBalanceUsd={availableBalanceUsd} />

        <button
          disabled
          title="UI build phase — order submission not wired yet"
          className={`w-full py-4 rounded-xl font-black text-sm transition opacity-60 cursor-not-allowed ${
            side === "buy" ? "bg-[#0ECB81] text-black" : "bg-[#F6465D] text-white"
          }`}
        >
          {side === "buy" ? `Buy ${baseAsset}` : `Sell ${baseAsset}`}
        </button>
        <div className="text-[9px] text-slate-700 text-center">UI preview — not connected to the order pipeline yet</div>
      </div>
    </div>
  );
}
