import type { MarketMode, Quote } from "./types";

interface Props {
  mode: MarketMode;
  onModeChange: (m: MarketMode) => void;
  quote: Quote | "ALL";
  onQuoteChange: (q: Quote | "ALL") => void;
  showFavOnly: boolean;
  onToggleFavOnly: () => void;
}

export function MarketTabs({ mode, onModeChange, quote, onQuoteChange, showFavOnly, onToggleFavOnly }: Props) {
  return (
    <div className="flex flex-col gap-1.5 px-2 pt-2">
      <div className="flex gap-1">
        {(["spot", "futures"] as const).map(m => (
          <button key={m} onClick={() => onModeChange(m)}
            className={`flex-1 py-1 rounded text-[10px] font-black uppercase tracking-wide transition ${
              mode === m ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-300"
            }`}
          >
            {m}
          </button>
        ))}
        <button onClick={onToggleFavOnly}
          className={`px-2 py-1 rounded text-[10px] font-black transition ${showFavOnly ? "text-[#F0B90B]" : "text-slate-600 hover:text-slate-300"}`}
          title="Favorites only"
        >
          ★
        </button>
      </div>
      <div className="flex gap-1">
        {(["ALL", "USDT", "USDC"] as const).map(q => (
          <button key={q} onClick={() => onQuoteChange(q)}
            className={`flex-1 py-0.5 rounded text-[9px] font-bold transition ${
              quote === q ? "bg-white/[0.08] text-slate-200" : "text-slate-700 hover:text-slate-400"
            }`}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
