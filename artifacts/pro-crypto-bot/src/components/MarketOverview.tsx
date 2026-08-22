import { CoinPrice } from "../types/crypto";
import { Sparkline } from "./Sparkline";
import { PremiumCard } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

const MARKET_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE"];

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 100)   return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1)     return p.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return p.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

interface MarketOverviewProps {
  prices: CoinPrice[];
  connectionStatus: "connecting" | "live" | "simulated";
}

export function MarketOverview({ prices, connectionStatus }: MarketOverviewProps) {
  const rows = MARKET_SYMBOLS
    .map((sym) => prices.find((p) => p.symbol === sym))
    .filter(Boolean) as CoinPrice[];

  return (
    <PremiumCard>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-cyan-400" />
          <h3 className="text-white font-semibold text-sm">Market Overview</h3>
          <StatusBadge 
            variant={connectionStatus === "live" ? "live" : connectionStatus === "simulated" ? "simulated" : "connecting"}
            label={connectionStatus === "live" ? "LIVE" : connectionStatus === "simulated" ? "SIM" : "CONNECTING"}
            pulse={connectionStatus !== "simulated"}
            className="ml-2 scale-90 origin-left"
          />
        </div>
        <span className="text-sm text-slate-500 font-medium">Binance WS feed</span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[2fr_1.5fr_1fr_1.2fr_1fr] gap-2 px-4 py-2 border-b border-white/5 bg-slate-900/50">
        <span className="text-slate-500 text-[13px] font-bold font-bold uppercase tracking-widest">Asset</span>
        <span className="text-slate-500 text-[13px] font-bold font-bold uppercase tracking-widest text-right">Price</span>
        <span className="text-slate-500 text-[13px] font-bold font-bold uppercase tracking-widest text-right">24h %</span>
        <span className="text-slate-500 text-[13px] font-bold font-bold uppercase tracking-widest text-right">Volume</span>
        <span className="text-slate-500 text-[13px] font-bold font-bold uppercase tracking-widest text-center">Trend</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-white/5">
        {rows.map((coin) => {
          const isUp = coin.changePercent24h >= 0;
          const pctAbs = Math.abs(coin.changePercent24h);
          return (
            <div
              key={coin.id}
              className="grid grid-cols-[2fr_1.5fr_1fr_1.2fr_1fr] gap-2 items-center px-4 py-3 hover:bg-white/[0.02] transition-colors group"
            >
              {/* Asset name */}
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black shrink-0 shadow-inner group-hover:scale-105 transition-transform ${
                  isUp ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}>
                  {coin.symbol.slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="text-slate-100 text-sm font-bold tracking-tight">{coin.symbol}</p>
                  <p className="text-slate-500 text-sm truncate font-medium">{coin.name}</p>
                </div>
              </div>

              {/* Price */}
              <div className="text-right">
                <p className="text-slate-100 font-bold text-sm tracking-tight">${fmtPrice(coin.price)}</p>
                <p className={`text-sm font-medium ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  {isUp ? "+" : ""}{fmtPrice(coin.change24h)}
                </p>
              </div>

              {/* 24h % change */}
              <div className="text-right">
                <span className={`inline-flex items-center gap-1 text-sm font-bold px-2 py-0.5 rounded border ${
                  isUp ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                }`}>
                  {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {pctAbs.toFixed(2)}%
                </span>
              </div>

              {/* Volume */}
              <div className="text-right">
                <p className="text-slate-300 text-sm font-medium">{fmtVol(coin.volume24h)}</p>
                <p className="text-slate-600 text-[13px] font-bold uppercase tracking-wider">24h vol</p>
              </div>

              {/* Sparkline trend */}
              <div className="flex justify-center opacity-80 group-hover:opacity-100 transition-opacity mix-blend-screen">
                <Sparkline
                  data={coin.sparkline || []}
                  color={isUp ? "#10b981" : "#ef4444"}
                  width={64}
                  height={24}
                  fill={false}
                />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="px-4 py-8 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Activity className="animate-pulse" size={24} />
            <p className="text-sm font-semibold">Loading market data...</p>
          </div>
        )}
      </div>
    </PremiumCard>
  );
}
