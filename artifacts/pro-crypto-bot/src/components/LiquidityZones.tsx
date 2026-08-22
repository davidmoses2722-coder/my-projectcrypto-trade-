/**
 * LiquidityZones — Visual heatmap of detected liquidity zones
 */
import { LiquidityZone, ZoneType } from "../types/crypto";

interface Props {
  zones:        LiquidityZone[];
  currentPrice: number;
  symbol:       string;
}

const ZONE_COLORS: Record<ZoneType, { bg: string; border: string; text: string; badge: string }> = {
  demand:     { bg: "bg-green-500/10",  border: "border-green-500/30",  text: "text-green-400",  badge: "bg-green-500/20 text-green-400" },
  supply:     { bg: "bg-red-500/10",    border: "border-red-500/30",    text: "text-red-400",    badge: "bg-red-500/20 text-red-400" },
  support:    { bg: "bg-blue-500/10",   border: "border-blue-500/30",   text: "text-blue-400",   badge: "bg-blue-500/20 text-blue-400" },
  resistance: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400", badge: "bg-orange-500/20 text-orange-400" },
  absorption: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400", badge: "bg-purple-500/20 text-purple-400" },
};

const ZONE_ICONS: Record<ZoneType, string> = {
  demand:     "🟢",
  supply:     "🔴",
  support:    "🔵",
  resistance: "🟠",
  absorption: "🟣",
};

function fmtPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (price >= 100)   return price.toFixed(2);
  if (price >= 1)     return price.toFixed(4);
  return price.toFixed(6);
}

function fmtVol(vol: number): string {
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000)     return `$${(vol / 1_000).toFixed(0)}K`;
  return `$${vol.toFixed(0)}`;
}

function StrengthBar({ strength, type }: { strength: number; type: ZoneType }) {
  const color =
    type === "demand" || type === "support" ? "bg-green-400" :
    type === "supply" || type === "resistance" ? "bg-red-400" :
    "bg-purple-400";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-700`}
          style={{ width: `${strength}%` }}
        />
      </div>
      <span className="text-xs font-bold text-gray-300 w-8 text-right">{strength}%</span>
    </div>
  );
}

function ZoneVisualBar({
  zone,
  currentPrice,
  priceMin,
  priceMax,
}: {
  zone:         LiquidityZone;
  currentPrice: number;
  priceMin:     number;
  priceMax:     number;
}) {
  const range    = priceMax - priceMin || 1;
  const topPct   = ((priceMax - zone.priceHigh) / range) * 100;
  const heightPct = ((zone.priceHigh - zone.priceLow) / range) * 100;
  // cursorPct used by parent overlay, computed here for reference
  void ((priceMax - currentPrice) / range * 100);

  const color =
    zone.type === "demand" || zone.type === "support" ? "#22c55e" :
    zone.type === "supply" || zone.type === "resistance" ? "#ef4444" :
    "#a855f7";

  return (
    <div className="relative" style={{ top: `${topPct}%`, height: `${Math.max(heightPct, 1)}%` }}>
      <div
        className="absolute inset-0 rounded-sm opacity-40"
        style={{ backgroundColor: color }}
      />
      <div className="absolute inset-y-0 left-0 w-0.5" style={{ backgroundColor: color }} />
    </div>
  );
}

export function LiquidityZonesPanel({ zones, currentPrice, symbol }: Props) {
  if (zones.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-gray-400 text-sm">Scanning for liquidity zones…</p>
        </div>
      </div>
    );
  }

  // Price range for the visual bar
  const allPrices = [
    ...zones.map((z) => z.priceHigh),
    ...zones.map((z) => z.priceLow),
    currentPrice,
  ];
  const priceMin  = Math.min(...allPrices) * 0.998;
  const priceMax  = Math.max(...allPrices) * 1.002;

  const activeZones   = zones.filter((z) => z.isActive);
  const inactiveZones = zones.filter((z) => !z.isActive);

  return (
    <div className="space-y-4">
      {/* Price map visual */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-white font-bold text-sm">Liquidity Map — {symbol}/USDT</span>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 opacity-60" />Demand</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 opacity-60" />Supply</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-500 opacity-60" />Absorption</span>
          </div>
        </div>

        <div className="flex gap-0">
          {/* Price labels */}
          <div className="w-24 shrink-0 relative" style={{ height: "280px" }}>
            {[0, 25, 50, 75, 100].map((pct) => {
              const labelPrice = priceMax - (priceMax - priceMin) * (pct / 100);
              return (
                <div
                  key={pct}
                  className="absolute right-2 text-xs text-gray-600 font-sans transform -translate-y-1/2"
                  style={{ top: `${pct}%` }}
                >
                  {fmtPrice(labelPrice)}
                </div>
              );
            })}
          </div>

          {/* Zone bars */}
          <div className="flex-1 relative border-l border-gray-800" style={{ height: "280px" }}>
            {/* Zones */}
            <div className="absolute inset-0">
              {zones.map((zone) => (
                <ZoneVisualBar
                  key={zone.id}
                  zone={zone}
                  currentPrice={currentPrice}
                  priceMin={priceMin}
                  priceMax={priceMax}
                />
              ))}
            </div>

            {/* Current price line */}
            <div
              className="absolute left-0 right-0 border-t-2 border-yellow-400 border-dashed z-10"
              style={{ top: `${((priceMax - currentPrice) / (priceMax - priceMin)) * 100}%` }}
            >
              <div className="absolute -top-3 -right-0 bg-yellow-400 text-black text-xs font-black px-1.5 py-0.5 rounded">
                {fmtPrice(currentPrice)}
              </div>
            </div>
          </div>

          {/* Strength bars */}
          <div className="w-16 shrink-0 relative border-l border-gray-800" style={{ height: "280px" }}>
            {zones.map((zone) => {
              const range    = priceMax - priceMin || 1;
              const topPct   = ((priceMax - zone.midPrice) / range) * 100;
              return (
                <div
                  key={zone.id}
                  className="absolute right-1 left-1 h-1 rounded-full"
                  style={{
                    top: `${topPct}%`,
                    background: zone.type === "demand" || zone.type === "support"
                      ? `rgba(34,197,94,${zone.strength / 100})`
                      : zone.type === "absorption"
                      ? `rgba(168,85,247,${zone.strength / 100})`
                      : `rgba(239,68,68,${zone.strength / 100})`,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Active zones highlight */}
      {activeZones.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-bold font-bold text-yellow-400 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            Active Zones (price nearby)
          </h3>
          {activeZones.map((zone) => {
            const c = ZONE_COLORS[zone.type];
            const distPct = ((currentPrice - zone.midPrice) / zone.midPrice * 100);
            return (
              <div
                key={zone.id}
                className={`${c.bg} border ${c.border} rounded-xl p-4`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{ZONE_ICONS[zone.type]}</span>
                    <div>
                      <p className={`text-sm font-bold ${c.text}`}>{zone.label}</p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {fmtPrice(zone.priceLow)} – {fmtPrice(zone.priceHigh)}
                        <span className="ml-2">({Math.abs(distPct).toFixed(2)}% {distPct > 0 ? "below" : "above"} price)</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${c.badge}`}>
                      {zone.type.toUpperCase()}
                    </span>
                    {zone.touchCount > 1 && (
                      <span className="text-xs text-gray-500">Tested {zone.touchCount}×</span>
                    )}
                  </div>
                </div>
                <StrengthBar strength={zone.strength} type={zone.type} />
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>Volume: <span className="text-gray-300">{fmtVol(zone.volume)}</span></span>
                  <span>Mid: <span className={`font-sans ${c.text}`}>{fmtPrice(zone.midPrice)}</span></span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* All other zones */}
      <div className="space-y-2">
        <h3 className="text-[13px] font-bold font-bold text-gray-500 uppercase tracking-wider">All Zones</h3>
        <div className="space-y-2">
          {inactiveZones.map((zone) => {
            const c = ZONE_COLORS[zone.type];
            const distPct = ((currentPrice - zone.midPrice) / zone.midPrice * 100);
            return (
              <div
                key={zone.id}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{ZONE_ICONS[zone.type]}</span>
                    <div>
                      <p className={`text-sm font-semibold ${c.text}`}>{zone.label}</p>
                      <p className="text-gray-600 text-xs">
                        {fmtPrice(zone.midPrice)} ·{" "}
                        {distPct > 0 ? "↓" : "↑"}{Math.abs(distPct).toFixed(2)}% from price
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-400">{fmtVol(zone.volume)}</p>
                      {zone.touchCount > 1 && (
                        <p className="text-xs text-gray-600">{zone.touchCount}× tested</p>
                      )}
                    </div>
                    {/* Mini strength indicator */}
                    <div className="w-12">
                      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            zone.type === "demand" || zone.type === "support"
                              ? "bg-green-400"
                              : zone.type === "absorption"
                              ? "bg-purple-400"
                              : "bg-red-400"
                          }`}
                          style={{ width: `${zone.strength}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-600 text-right mt-0.5">{zone.strength}%</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3">
        <p className="text-[13px] font-bold text-gray-600 font-semibold mb-2 uppercase tracking-wider">Zone Legend</p>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">🟢 <b className="text-green-400">Demand</b> — Strong buy cluster below price</span>
          <span className="flex items-center gap-1.5">🔴 <b className="text-red-400">Supply</b> — Strong sell cluster above price</span>
          <span className="flex items-center gap-1.5">🔵 <b className="text-blue-400">Support</b> — Historical price bounce level</span>
          <span className="flex items-center gap-1.5">🟠 <b className="text-orange-400">Resistance</b> — Historical rejection level</span>
          <span className="flex items-center gap-1.5 col-span-2">🟣 <b className="text-purple-400">Absorption</b> — Large block trade fill detected</span>
        </div>
      </div>
    </div>
  );
}
