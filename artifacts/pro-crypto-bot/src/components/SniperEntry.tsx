/**
 * SniperEntry — Precision entry setups with R:R, zone context, and arm status
 */
import { useState } from "react";
import { SniperEntry, SniperStatus } from "../types/crypto";

interface Props {
  snipers:      SniperEntry[];
  currentPrice: number;
  onExecute?:   (sniper: SniperEntry) => void;
}

function fmtPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (price >= 100)   return price.toFixed(2);
  if (price >= 1)     return price.toFixed(4);
  return price.toFixed(6);
}

function fmtPct(a: number, b: number): string {
  return (((b - a) / a) * 100).toFixed(2);
}

const STATUS_STYLES: Record<SniperStatus, { bg: string; border: string; text: string; dot: string }> = {
  ARMED:     { bg: "bg-cyan-500/10",   border: "border-cyan-500/30",   text: "text-cyan-400",   dot: "bg-cyan-400 animate-pulse" },
  TRIGGERED: { bg: "bg-green-500/10",  border: "border-green-500/30",  text: "text-green-400",  dot: "bg-green-400" },
  EXPIRED:   { bg: "bg-gray-500/10",   border: "border-gray-700",      text: "text-gray-500",   dot: "bg-gray-500" },
  CANCELLED: { bg: "bg-red-500/10",    border: "border-red-500/20",    text: "text-red-400",    dot: "bg-red-400" },
};

function RRGauge({ rr }: { rr: number }) {
  const pct = Math.min((rr / 5) * 100, 100);
  const color = rr >= 3 ? "bg-green-400" : rr >= 2 ? "bg-yellow-400" : "bg-orange-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-black ${rr >= 3 ? "text-green-400" : rr >= 2 ? "text-yellow-400" : "text-orange-400"}`}>
        {rr.toFixed(1)}R
      </span>
    </div>
  );
}

function ConfidenceRing({ confidence }: { confidence: number }) {
  const r   = 18;
  const circ = 2 * Math.PI * r;
  const dash = (confidence / 100) * circ;
  const color = confidence >= 70 ? "#22c55e" : confidence >= 50 ? "#eab308" : "#f97316";

  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#1f2937" strokeWidth="4" />
        <circle
          cx="22" cy="22" r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-black" style={{ color }}>{confidence}%</span>
      </div>
    </div>
  );
}

function TimeLeft({ expiresAt }: { expiresAt: Date }) {
  const ms  = expiresAt.getTime() - Date.now();
  if (ms <= 0) return <span className="text-xs text-gray-600">Expired</span>;
  const h   = Math.floor(ms / 3_600_000);
  const m   = Math.floor((ms % 3_600_000) / 60_000);
  return (
    <span className="text-xs text-gray-500">
      Expires in <span className="text-yellow-400">{h}h {m}m</span>
    </span>
  );
}

function PriceLadder({ sniper, currentPrice }: { sniper: SniperEntry; currentPrice: number }) {
  const isBuy   = sniper.side === "BUY";
  const levels  = isBuy
    ? [
        { label: "Stop Loss",   price: sniper.stopLoss,    color: "text-red-400",    icon: "🛑" },
        { label: "Entry",       price: sniper.entryPrice,  color: "text-cyan-400",   icon: "🎯" },
        { label: "Current",     price: currentPrice,       color: "text-yellow-400", icon: "📍" },
        { label: "Target",      price: sniper.targetPrice, color: "text-green-400",  icon: "✅" },
      ].sort((a, b) => a.price - b.price)
    : [
        { label: "Target",      price: sniper.targetPrice, color: "text-green-400",  icon: "✅" },
        { label: "Current",     price: currentPrice,       color: "text-yellow-400", icon: "📍" },
        { label: "Entry",       price: sniper.entryPrice,  color: "text-cyan-400",   icon: "🎯" },
        { label: "Stop Loss",   price: sniper.stopLoss,    color: "text-red-400",    icon: "🛑" },
      ].sort((a, b) => b.price - a.price);

  const allPrices = levels.map((l) => l.price);
  const minP      = Math.min(...allPrices);
  const maxP      = Math.max(...allPrices);
  void (maxP - minP || 1); // range kept for future bar rendering

  return (
    <div className="relative pl-6 space-y-1.5 my-3">
      {/* Vertical line */}
      <div className="absolute left-2 top-2 bottom-2 w-px bg-gray-700" />
      {levels.map((level) => {
            const isCur = level.label === "Current";
        return (
          <div key={level.label} className="flex items-center gap-2">
            <div className={`relative z-10 w-4 h-4 rounded-full flex items-center justify-center text-xs
              ${isCur ? "bg-yellow-400/20 border border-yellow-400" : "bg-gray-800 border border-gray-600"}`}>
              <span className="text-xs leading-none">{level.icon}</span>
            </div>
            <div className="flex items-center justify-between flex-1">
              <span className={`text-sm font-medium ${level.color}`}>{level.label}</span>
              <span className={`text-xs font-bold ${level.color}`}>{fmtPrice(level.price)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SniperEntryPanel({ snipers, currentPrice, onExecute }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (snipers.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <p className="text-4xl mb-2">🎯</p>
        <p className="text-white font-bold text-sm mb-1">No sniper entries armed</p>
        <p className="text-gray-500 text-xs">
          Waiting for price to approach a high-probability liquidity zone…
        </p>
      </div>
    );
  }

      const armed    = snipers.filter((s) => s.status === "ARMED");

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-cyan-400">{armed.length}</p>
          <p className="text-xs text-gray-500">Armed Snipers</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-green-400">
            {armed.length > 0 ? Math.max(...armed.map((s) => s.riskReward)).toFixed(1) : "–"}R
          </p>
          <p className="text-xs text-gray-500">Best R:R</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-yellow-400">
            {armed.length > 0 ? Math.max(...armed.map((s) => s.confidence)) : "–"}%
          </p>
          <p className="text-xs text-gray-500">Top Confidence</p>
        </div>
      </div>

      {/* Sniper cards */}
      {snipers.map((sniper) => {
        const s        = STATUS_STYLES[sniper.status];
        const isOpen   = expanded === sniper.id;
        const isBuy    = sniper.side === "BUY";
        const distToEntry = Math.abs(currentPrice - sniper.entryPrice);
        const distPct  = (distToEntry / currentPrice) * 100;

        return (
          <div
            key={sniper.id}
            className={`${s.bg} border ${s.border} rounded-xl overflow-hidden transition-all`}
          >
            {/* Main row */}
            <div
              className="px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
              onClick={() => setExpanded(isOpen ? null : sniper.id)}
            >
              <div className="flex items-center justify-between">
                {/* Left: status + side */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                    <span className={`text-xs font-bold ${s.text}`}>{sniper.status}</span>
                  </div>
                  <div className={`px-2 py-0.5 rounded-md text-xs font-black
                    ${isBuy ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>
                    {sniper.side}
                  </div>
                  <span className="text-gray-400 text-sm font-semibold">{sniper.symbol}</span>
                </div>

                {/* Right: confidence ring + expand */}
                <div className="flex items-center gap-3">
                  <ConfidenceRing confidence={sniper.confidence} />
                  <span className="text-gray-600 text-xs">{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Price + R:R row */}
              <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-gray-500">Entry</p>
                  <p className="font-bold text-cyan-400">{fmtPrice(sniper.entryPrice)}</p>
                  <p className="text-gray-600">{distPct.toFixed(2)}% away</p>
                </div>
                <div>
                  <p className="text-gray-500">Target</p>
                  <p className="font-bold text-green-400">{fmtPrice(sniper.targetPrice)}</p>
                  <p className="text-green-600">+{Math.abs(parseFloat(fmtPct(sniper.entryPrice, sniper.targetPrice)))}%</p>
                </div>
                <div>
                  <p className="text-gray-500">Stop Loss</p>
                  <p className="font-bold text-red-400">{fmtPrice(sniper.stopLoss)}</p>
                  <p className="text-red-600">{fmtPct(sniper.entryPrice, sniper.stopLoss)}%</p>
                </div>
              </div>

              {/* R:R bar */}
              <div className="mt-2">
                <RRGauge rr={sniper.riskReward} />
              </div>
            </div>

            {/* Expanded detail */}
            {isOpen && (
              <div className="border-t border-gray-800 px-4 pb-4">
                {/* Zone info */}
                <div className="mt-3 mb-2 bg-gray-950/60 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-500 mb-0.5">Liquidity Zone</p>
                  <p className="text-xs font-bold text-white">{sniper.zone.label}</p>
                  <p className="text-xs text-gray-500">
                    {fmtPrice(sniper.zone.priceLow)} – {fmtPrice(sniper.zone.priceHigh)} ·{" "}
                    Strength {sniper.zone.strength}%
                  </p>
                </div>

                {/* Price ladder */}
                <PriceLadder sniper={sniper} currentPrice={currentPrice} />

                {/* Reason */}
                <p className="text-xs text-gray-400 leading-relaxed mb-3">{sniper.reason}</p>

                {/* Indicators */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {sniper.indicators.map((ind, i) => (
                    <span
                      key={i}
                      className="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400"
                    >
                      {ind}
                    </span>
                  ))}
                </div>

                {/* Expiry */}
                <div className="flex items-center justify-between">
                  <TimeLeft expiresAt={sniper.expiresAt} />
                  {sniper.status === "ARMED" && onExecute && (
                    <button
                      onClick={() => onExecute(sniper)}
                      className={`text-xs px-4 py-1.5 rounded-lg font-bold transition-all hover:scale-105 active:scale-95
                        ${isBuy
                          ? "bg-green-500/20 border border-green-500/40 text-green-400 hover:bg-green-500/30"
                          : "bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30"
                        }`}
                    >
                      📲 Alert: {sniper.side} @ {fmtPrice(sniper.entryPrice)}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Tip */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3 space-y-1.5">
        <p className="text-xs text-gray-600">
          <span className="text-yellow-400 font-bold">💡 Sniper entries</span> are generated automatically when the live price approaches a detected liquidity zone within 2%.
          Entries use the lower 30% of the zone (for buys) to minimize risk while maximizing R:R.
        </p>
        <p className="text-xs text-slate-600">
          <span className="text-orange-400 font-bold">ℹ️ Alert mode:</span> The "Alert" button sends a Telegram notification with the setup details.
          Actual order execution is handled automatically by the trading engine when the bot is running.
        </p>
      </div>
    </div>
  );
}
