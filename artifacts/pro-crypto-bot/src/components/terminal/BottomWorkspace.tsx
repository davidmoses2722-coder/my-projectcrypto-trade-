import { useState } from "react";
import { TrendingUp, Clock3, History, BookOpen, WalletCards } from "lucide-react";
import { PositionTable } from "./PositionTable";
import { OpenOrdersTable, OrderHistoryTable, TradeHistoryTable } from "./HistoryPanel";
import { AssetsPanel } from "./AssetsPanel";
import type { TerminalDataSource, MarketMode } from "./types";

type Tab = "positions" | "orders" | "orderHistory" | "tradeHistory" | "assets";

export function BottomWorkspace({ data, mode }: { data: TerminalDataSource; mode: MarketMode }) {
  const [tab, setTab] = useState<Tab>("positions");

  const tabs: { key: Tab; label: string; count: number | null; icon: React.ReactNode }[] = [
    { key: "positions", label: "Positions", count: data.positions.length, icon: <TrendingUp size={11} /> },
    { key: "orders", label: "Open Orders", count: data.openOrders.length, icon: <Clock3 size={11} /> },
    { key: "orderHistory", label: "Order History", count: null, icon: <History size={11} /> },
    { key: "tradeHistory", label: "Trade History", count: null, icon: <BookOpen size={11} /> },
    { key: "assets", label: "Assets", count: null, icon: <WalletCards size={11} /> },
  ];

  return (
    <div className="h-[240px] flex-shrink-0 border-t border-white/[0.06] flex flex-col">
      <div className="flex items-center border-b border-white/[0.06] bg-[#0d1117] flex-shrink-0 overflow-x-auto">
        {tabs.map(({ key, label, count, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider border-b-2 transition whitespace-nowrap ${
              tab === key ? "border-[#0ea5e9] text-[#0ea5e9]" : "border-transparent text-slate-600 hover:text-slate-400"
            }`}
          >
            {icon}{label}
            {count !== null && count > 0 && <span className="ml-0.5 px-1 rounded bg-white/10 text-[9px] font-black">{count}</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "positions" && <PositionTable positions={data.positions.filter(p => p.mode === mode)} />}
        {tab === "orders" && <OpenOrdersTable orders={data.openOrders.filter(o => o.mode === mode)} />}
        {tab === "orderHistory" && <OrderHistoryTable orders={data.orderHistory.filter(o => o.mode === mode)} />}
        {tab === "tradeHistory" && <TradeHistoryTable trades={data.tradeHistory} />}
        {tab === "assets" && <AssetsPanel assets={mode === "spot" ? data.spotAssets : data.futuresAssets} label={mode === "spot" ? "Spot Asset" : "Futures Asset"} />}
      </div>
    </div>
  );
}
