import { CoinPrice } from "../types/crypto";
import { Sparkline } from "./Sparkline";
import { PremiumCard } from "./premium/PremiumCard";
import { TrendingUp, TrendingDown } from "lucide-react";

interface PriceCardProps {
  coin: CoinPrice;
  selected?: boolean;
  onClick?: () => void;
}

const COIN_ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", BNB: "B", SOL: "◎", XRP: "✕", ADA: "₳", AVAX: "▲", DOGE: "Ð",
};

const COIN_COLORS: Record<string, string> = {
  BTC: "#F7931A", ETH: "#627EEA", BNB: "#F3BA2F", SOL: "#9945FF",
  XRP: "#00AAE4", ADA: "#0033AD", AVAX: "#E84142", DOGE: "#C2A633",
};

function formatPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 100)   return p.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (p >= 1)     return p.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return p.toLocaleString(undefined, { maximumFractionDigits: 5 });
}

function formatVol(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

export function PriceCard({ coin, selected, onClick }: PriceCardProps) {
  const isUp = coin.changePercent24h >= 0;
  const color = COIN_COLORS[coin.symbol] || "#888";
  const sparkColor = isUp ? "#10b981" : "#ef4444";

  return (
    <PremiumCard
      onClick={onClick}
      hoverGlow
      animatedBorder={selected}
      className={`cursor-pointer transition-all duration-200 ${
        selected ? "border-cyan-500/60 bg-cyan-500/5 shadow-lg shadow-cyan-500/10" : "border-white/5"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shadow-inner"
              style={{ backgroundColor: color + "22", color, border: `1px solid ${color}40` }}
            >
              {COIN_ICONS[coin.symbol] || coin.symbol[0]}
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">{coin.symbol}</p>
              <p className="text-slate-500 text-sm">{coin.name}</p>
            </div>
          </div>
          <div className={`flex items-center gap-1 text-sm font-bold px-2 py-0.5 rounded-full ${isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
            {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(coin.changePercent24h).toFixed(2)}%
          </div>
        </div>

        <div className="flex items-end justify-between">
          <div>
            <p className="text-white font-black text-xl md:text-2xl leading-tight font-sans tracking-tight">
              ${formatPrice(coin.price)}
            </p>
            <p className={`text-sm font-semibold mt-0.5 ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
              {isUp ? "+" : ""}{formatPrice(coin.change24h)}
            </p>
          </div>
          <div className="opacity-80 mix-blend-screen">
            <Sparkline data={coin.sparkline || []} color={sparkColor} width={72} height={28} />
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-white/5 flex justify-between text-sm text-slate-500">
          <span>Vol: <span className="text-slate-300">{formatVol(coin.volume24h)}</span></span>
          <span>H: <span className="text-slate-300">${formatPrice(coin.high24h)}</span></span>
          <span>L: <span className="text-slate-300">${formatPrice(coin.low24h)}</span></span>
        </div>
      </div>
    </PremiumCard>
  );
}
