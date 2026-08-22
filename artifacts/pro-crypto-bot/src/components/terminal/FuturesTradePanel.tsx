import { useState } from "react";
import { OrderForm, type OrderFormValue } from "./OrderForm";
import { RiskPanel } from "./RiskPanel";
import type { MarginMode, PositionSide, RiskEstimate } from "./types";

interface Props {
  baseAsset: string;
  quoteAsset: string;
  livePrice: number;
  availableBalanceUsd: number;
}

const LEVERAGE_PRESETS = [5, 10, 20, 25, 50, 75, 100, 125];

export function FuturesTradePanel({ baseAsset, quoteAsset, livePrice, availableBalanceUsd }: Props) {
  const [positionSide, setPositionSide] = useState<PositionSide>("long");
  const [marginMode, setMarginMode] = useState<MarginMode>("isolated");
  const [leverage, setLeverage] = useState(20);
  const [form, setForm] = useState<OrderFormValue>({
    kind: "market", price: livePrice, triggerPrice: livePrice, quantity: 0, tif: "GTC", reduceOnly: false,
  });

  const notional = form.quantity * leverage;
  const roughLiq = form.quantity > 0 && livePrice > 0
    ? positionSide === "long"
      ? livePrice * (1 - 0.9 / leverage)
      : livePrice * (1 + 0.9 / leverage)
    : null;

  const estimate: RiskEstimate = {
    marginUsd: form.quantity,
    liquidationPrice: roughLiq,
    feeUsd: notional * 0.0005,
    estPnlUsd: 0,
    estPnlPct: 0,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <span className="text-[10px] text-slate-600">Avail. (Futures)</span>
        <span className="text-sm font-black text-white">${availableBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 pt-3">
        <button
          onClick={() => setMarginMode(m => (m === "isolated" ? "cross" : "isolated"))}
          className="py-2 rounded-lg text-xs font-black bg-white/[0.04] border border-white/[0.08] text-slate-300 capitalize"
        >
          {marginMode}
        </button>
        <select
          value={leverage} onChange={e => setLeverage(Number(e.target.value))}
          className="py-2 rounded-lg text-xs font-black bg-white/[0.04] border border-white/[0.08] text-slate-300 text-center appearance-none cursor-pointer"
        >
          {LEVERAGE_PRESETS.map(l => <option key={l} value={l}>{l}X</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-0 border-b border-white/[0.06] mt-3">
        <button onClick={() => setPositionSide("long")}
          className={`py-3 font-black text-sm transition ${positionSide === "long" ? "bg-[#0ECB81] text-black" : "text-slate-600 hover:text-[#0ECB81]"}`}
        >
          Long
        </button>
        <button onClick={() => setPositionSide("short")}
          className={`py-3 font-black text-sm transition ${positionSide === "short" ? "bg-[#F6465D] text-white" : "text-slate-600 hover:text-[#F6465D]"}`}
        >
          Short
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-3 px-4 py-3">
        <OrderForm
          value={form} onChange={setForm}
          quoteAsset={quoteAsset} baseAsset={baseAsset}
          availableBalanceUsd={availableBalanceUsd}
          showTif
        />
        <div className="text-[10px] text-slate-700 font-mono -mt-2">
          ≈ {(notional / (livePrice || 1)).toFixed(6)} {baseAsset} notional ({leverage}x)
        </div>
        <RiskPanel estimate={estimate} availableBalanceUsd={availableBalanceUsd} />

        <button
          disabled
          title="UI build phase — order submission not wired yet"
          className={`w-full py-4 rounded-xl font-black text-sm transition opacity-60 cursor-not-allowed ${
            positionSide === "long" ? "bg-[#0ECB81] text-black" : "bg-[#F6465D] text-white"
          }`}
        >
          {positionSide === "long" ? "Open Long" : "Open Short"}
        </button>
        <div className="text-[9px] text-slate-700 text-center">UI preview — not connected to the futures backend yet</div>
      </div>
    </div>
  );
}
