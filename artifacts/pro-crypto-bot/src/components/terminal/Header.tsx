import { ChevronDown, Search, Star } from "lucide-react";
import type { MarketMode, TickerSnapshot } from "./types";

function fmt(n: number, dp = 2) { return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
function fmtCountdown(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface Props {
  mode: MarketMode;
  onModeChange: (m: MarketMode) => void;
  ticker: TickerSnapshot;
  favorite: boolean;
  onToggleFavorite: () => void;
  onOpenSearch: () => void;
}

export function Header({ mode, onModeChange, ticker, favorite, onToggleFavorite, onOpenSearch }: Props) {
  const up = ticker.changePct24h >= 0;
  const connDot = ticker.connection === "live" ? "bg-[#0ECB81]" : ticker.connection === "connecting" ? "bg-amber-400 animate-pulse" : "bg-slate-600";

  return (
    <div className="flex flex-col flex-shrink-0 bg-[#0d1117] border-b border-white/[0.06]">
      {/* Mode tabs */}
      <div className="flex items-center gap-5 px-4 pt-2.5">
        <button
          onClick={() => onModeChange("futures")}
          className={`pb-2.5 -mb-px text-[13px] font-black border-b-2 transition ${mode === "futures" ? "text-white border-[#F0B90B]" : "text-slate-600 border-transparent hover:text-slate-400"}`}
        >
          Perp Futures
        </button>
        <button
          onClick={() => onModeChange("spot")}
          className={`pb-2.5 -mb-px text-[13px] font-black border-b-2 transition ${mode === "spot" ? "text-white border-[#F0B90B]" : "text-slate-600 border-transparent hover:text-slate-400"}`}
        >
          Spot
        </button>
        <div className="flex-1" />
        <button onClick={onOpenSearch} className="mb-2 text-slate-500 hover:text-slate-300 transition">
          <Search size={15} />
        </button>
      </div>

      {/* Symbol + price + stats */}
      <div className="flex items-center gap-4 px-4 py-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Star
            size={14}
            onClick={onToggleFavorite}
            className={favorite ? "text-[#F0B90B] fill-[#F0B90B] cursor-pointer" : "text-slate-600 cursor-pointer hover:text-slate-400"}
          />
          <span className="text-base font-black text-white">{ticker.displaySymbol}</span>
          <ChevronDown size={13} className="text-slate-600" />
          <span className="text-xl font-black text-white tabular-nums ml-1">${fmt(ticker.price)}</span>
          <span className={`text-xs font-black ${up ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>{up ? "+" : ""}{ticker.changePct24h.toFixed(2)}%</span>
        </div>

        <div className="flex items-center gap-4 text-[11px] flex-1 min-w-0">
          {[
            { label: "24h High", val: `$${fmt(ticker.high24h)}` },
            { label: "24h Low", val: `$${fmt(ticker.low24h)}` },
            { label: "24h Vol", val: `${ticker.volume24hBase.toLocaleString(undefined, { maximumFractionDigits: 1 })}` },
            ...(mode === "futures" && ticker.fundingRatePct != null
              ? [{ label: "Funding / Countdown", val: `${ticker.fundingRatePct.toFixed(4)}% / ${fmtCountdown(ticker.nextFundingSeconds ?? 0)}` }]
              : []),
          ].map(({ label, val }) => (
            <div key={label} className="flex flex-col">
              <span className="text-[9px] text-slate-700 uppercase tracking-wider">{label}</span>
              <span className="font-mono font-bold text-slate-300">{val}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${connDot}`} />
          <span className="text-[10px] text-slate-600 uppercase">
            {ticker.connection === "live" ? "Live" : ticker.connection === "connecting" ? "Connecting" : "Offline"}
          </span>
        </div>
      </div>
    </div>
  );
}
