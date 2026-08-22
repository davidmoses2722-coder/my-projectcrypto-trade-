import { useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import { MarketTabs } from "./MarketTabs";
import type { MarketMode, MarketRow, Quote } from "./types";

type SortKey = "symbol" | "price" | "changePct24h" | "volume24hUsd";

function fmtVol(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
}

interface Props {
  markets: MarketRow[];
  currentSymbol: string;
  onSelect: (symbol: string) => void;
  onToggleFavorite: (symbol: string) => void;
}

export function MarketSidebar({ markets, currentSymbol, onSelect, onToggleFavorite }: Props) {
  const [mode, setMode] = useState<MarketMode>("futures");
  const [quote, setQuote] = useState<Quote | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("volume24hUsd");
  const [sortDesc, setSortDesc] = useState(true);

  const rows = useMemo(() => {
    let list = markets.filter(m => m.mode === mode);
    if (quote !== "ALL") list = list.filter(m => m.quote === quote);
    if (showFavOnly) list = list.filter(m => m.favorite);
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      list = list.filter(m => m.symbol.includes(q) || m.base.includes(q));
    }
    return [...list].sort((a, b) => {
      const dir = sortDesc ? -1 : 1;
      if (sortKey === "symbol") return a.symbol.localeCompare(b.symbol) * dir;
      const numKey = sortKey as "price" | "changePct24h" | "volume24hUsd";
      return (a[numKey] - b[numKey]) * dir;
    });
  }, [markets, mode, quote, showFavOnly, query, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(v => !v);
    else { setSortKey(key); setSortDesc(true); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md pl-7 pr-2 py-1.5 text-[11px] text-white placeholder:text-slate-700 focus:outline-none focus:border-[#0ea5e9]/40"
          />
        </div>
      </div>

      <MarketTabs
        mode={mode} onModeChange={setMode}
        quote={quote} onQuoteChange={setQuote}
        showFavOnly={showFavOnly} onToggleFavOnly={() => setShowFavOnly(v => !v)}
      />

      <div className="flex justify-between px-3 py-1.5 mt-1 text-[9px] text-slate-600 border-b border-white/[0.06] font-sans">
        <button onClick={() => toggleSort("symbol")} className="hover:text-slate-300">Pair</button>
        <button onClick={() => toggleSort("price")} className="hover:text-slate-300">Price</button>
        <button onClick={() => toggleSort("changePct24h")} className="hover:text-slate-300">24h%</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <div className="text-center text-slate-700 text-[11px] py-6">No markets match.</div>
        )}
        {rows.map(m => (
          <button
            key={m.symbol}
            onClick={() => onSelect(m.symbol)}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-left transition ${
              currentSymbol === m.symbol ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
            }`}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <Star
                size={11}
                onClick={e => { e.stopPropagation(); onToggleFavorite(m.symbol); }}
                className={m.favorite ? "text-[#F0B90B] fill-[#F0B90B]" : "text-slate-700"}
              />
              <span className="text-[11px] font-bold text-slate-200 truncate">{m.base}<span className="text-slate-600">/{m.quote}</span></span>
            </span>
            <span className="text-right">
              <div className="text-[11px] font-mono text-slate-200">{m.price < 1 ? m.price.toFixed(4) : m.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <div className={`text-[10px] font-mono ${m.changePct24h >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                {m.changePct24h >= 0 ? "+" : ""}{m.changePct24h.toFixed(2)}%
              </div>
            </span>
          </button>
        ))}
      </div>

      <div className="px-3 py-1 text-[9px] text-slate-700 border-t border-white/[0.06] font-sans">
        Vol {rows.length > 0 ? fmtVol(rows.reduce((s, r) => s + r.volume24hUsd, 0)) : "—"} · {rows.length} pairs
      </div>
    </div>
  );
}
