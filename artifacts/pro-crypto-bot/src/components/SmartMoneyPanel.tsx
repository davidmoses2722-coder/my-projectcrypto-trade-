/**
 * SmartMoneyPanel — Smart Money Concepts (SMC) Dashboard
 * Displays: Order Blocks, FVGs, BOS/CHoCH, Liquidity Sweeps, Premium/Discount
 */

import { useState } from "react";
import { SMCAnalysis, OrderBlock, FairValueGap, BOS, LiquiditySweep } from "../utils/smartMoney";
import { UseSmartMoneyReturn } from "../hooks/useSmartMoney";

const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE"];

type SMCTab = "overview" | "ob" | "fvg" | "structure" | "sweeps";

function fmtP(p: number): string {
  if (p >= 10000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 100)   return p.toFixed(2);
  if (p >= 1)     return p.toFixed(4);
  return p.toFixed(6);
}

function BiasTag({ bias }: { bias: SMCAnalysis["bias"] }) {
  const cfg = {
    bullish: { bg: "bg-green-500/15", border: "border-green-500/40", text: "text-green-400", icon: "📈" },
    bearish: { bg: "bg-red-500/15",   border: "border-red-500/40",   text: "text-red-400",   icon: "📉" },
    neutral: { bg: "bg-gray-500/15",  border: "border-gray-500/40",  text: "text-gray-400",  icon: "➡️" },
  }[bias];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      {cfg.icon} {bias.toUpperCase()}
    </span>
  );
}

function FlowGauge({ score }: { score: number }) {
  const abs  = Math.abs(score);
  const pos  = score >= 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">Institutional Flow</span>
        <span className={`font-bold ${pos ? "text-green-400" : "text-red-400"}`}>
          {pos ? "+" : ""}{score}
        </span>
      </div>
      <div className="h-3 bg-gray-800 rounded-full overflow-hidden flex">
        <div className="w-1/2 flex justify-end pr-px">
          {!pos && <div style={{ width: `${abs}%` }} className="h-full bg-red-500 rounded-l-full" />}
        </div>
        <div className="w-px bg-gray-600" />
        <div className="w-1/2 pl-px">
          {pos && <div style={{ width: `${abs}%` }} className="h-full bg-green-500 rounded-r-full" />}
        </div>
      </div>
      <div className="flex justify-between text-xs text-gray-700">
        <span>Bearish −100</span><span>Bullish +100</span>
      </div>
    </div>
  );
}

function OBCard({ ob }: { ob: OrderBlock }) {
  const isBull = ob.type === "bullish";
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${ 
      isBull ? "bg-green-500/5 border-green-500/25" : "bg-red-500/5 border-red-500/25"
    }`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold ${isBull ? "text-green-400" : "text-red-400"}`}>
          {isBull ? "🟢" : "🔴"} {ob.type === "bullish" ? "Bullish" : "Bearish"} OB
        </span>
        <div className="flex items-center gap-1">
          {ob.isActive    && <span className="text-xs px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">ACTIVE</span>}
          {ob.isMitigated && <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-500/20 text-gray-500 border border-gray-500/30">MITIGATED</span>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-gray-600">Zone High</p>
          <p className="text-xs font-sans text-gray-300">{fmtP(ob.priceHigh)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Mid</p>
          <p className="text-xs font-sans text-gray-300">{fmtP(ob.midPrice)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Zone Low</p>
          <p className="text-xs font-sans text-gray-300">{fmtP(ob.priceLow)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>Tested: {ob.testedCount}×</span>
        <div className="flex items-center gap-1">
          <span>Strength</span>
          <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div style={{ width: `${ob.strength}%` }}
              className={`h-full rounded-full ${isBull ? "bg-green-500" : "bg-red-500"}`} />
          </div>
          <span className={isBull ? "text-green-400" : "text-red-400"}>{ob.strength}%</span>
        </div>
      </div>
    </div>
  );
}

function FVGCard({ fvg }: { fvg: FairValueGap }) {
  const isBull = fvg.type === "bullish";
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${ 
      isBull ? "bg-emerald-500/5 border-emerald-500/25" : "bg-orange-500/5 border-orange-500/25"
    }`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold ${isBull ? "text-emerald-400" : "text-orange-400"}`}>
          {isBull ? "↑" : "↓"} {isBull ? "Bullish" : "Bearish"} FVG
        </span>
        <div className="flex items-center gap-2 text-xs">
          <span className={`px-1.5 py-0.5 rounded-full border ${
            fvg.isFilled
              ? "bg-gray-500/15 text-gray-500 border-gray-500/30"
              : "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
          }`}>
            {fvg.isFilled ? "FILLED" : "OPEN"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-gray-600">Gap High</p>
          <p className="text-xs font-sans text-gray-300">{fmtP(fvg.gapHigh)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Size</p>
          <p className={`text-xs font-bold ${isBull ? "text-emerald-400" : "text-orange-400"}`}>{fvg.sizePct.toFixed(3)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Gap Low</p>
          <p className="text-xs font-sans text-gray-300">{fmtP(fvg.gapLow)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>Fill: {fvg.fillPct.toFixed(0)}%</span>
        <div className="flex-1 mx-2 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div style={{ width: `${fvg.fillPct}%` }}
            className={`h-full rounded-full ${isBull ? "bg-emerald-500" : "bg-orange-500"}`} />
        </div>
        <span className={isBull ? "text-emerald-400" : "text-orange-400"}>Str: {fvg.strength}%</span>
      </div>
    </div>
  );
}

function BOSCard({ bos }: { bos: BOS }) {
  const isBull  = bos.type === "bullish";
  const isCHoCH = bos.label === "CHoCH";
  return (
    <div className={`rounded-xl border p-3 flex items-center justify-between ${ 
      isBull ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"
    }`}>
      <div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-black ${isBull ? "text-green-400" : "text-red-400"}`}>
            {bos.label}
          </span>
          {isCHoCH && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
              REVERSAL
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {isBull ? "Bullish" : "Bearish"} {bos.label === "BOS" ? "Break of Structure" : "Change of Character"}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs font-sans font-bold text-gray-200">{fmtP(bos.price)}</p>
        <p className="text-xs text-gray-600">Str: {bos.strength}%</p>
      </div>
    </div>
  );
}

function SweepCard({ sweep }: { sweep: LiquiditySweep }) {
  const isBuySide = sweep.type === "buy_stop";
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 ${ 
      isBuySide ? "bg-orange-500/5 border-orange-500/25" : "bg-purple-500/5 border-purple-500/25"
    }`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold ${isBuySide ? "text-orange-400" : "text-purple-400"}`}>
          🧹 {isBuySide ? "Buy Stop" : "Sell Stop"} Sweep
        </span>
        {sweep.recovered && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">RECOVERED</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div>
          <p className="text-xs text-gray-600">Swept Level</p>
          <p className="text-xs font-sans text-gray-300">{fmtP(sweep.sweptLevel)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Spike Price</p>
          <p className="text-xs font-sans text-gray-300">{fmtP(sweep.price)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>Impact: {sweep.strength}pts</span>
        <span className={isBuySide ? "text-orange-400" : "text-purple-400"}>
          {isBuySide ? "Bearish signal after sweep" : "Bullish signal after sweep"}
        </span>
      </div>
    </div>
  );
}

function PremiumDiscountMap({ analysis }: { analysis: SMCAnalysis }) {
  const pd  = analysis.premiumDiscount;
  const h   = analysis.swingHigh;
  const l   = analysis.swingLow;
  const curr = analysis.orderBlocks[0]?.midPrice ?? (h + l) / 2;
  const range = h - l || 1;
  const toY  = (price: number) => Math.round(((h - price) / range) * 100);

  const zoneColor = pd.currentZone === "premium" ? "text-red-400 bg-red-500/10 border-red-500/30" :
                    pd.currentZone === "discount" ? "text-green-400 bg-green-500/10 border-green-500/30" :
                    "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-gray-300">Premium / Discount Zones</h4>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${zoneColor}`}>
          {pd.currentZone.toUpperCase()}
        </span>
      </div>

      {/* Price map */}
      <div className="relative h-36 bg-gray-950 rounded-lg overflow-hidden border border-gray-800">
        {/* Premium zone (top 38.2%) */}
        <div className="absolute left-0 right-0 bg-red-500/10 border-b border-red-500/30" style={{ top: 0, height: "38.2%" }}>
          <span className="absolute left-2 top-1 text-xs text-red-400">PREMIUM ≥61.8%</span>
        </div>
        {/* Equilibrium */}
        <div className="absolute left-0 right-0 border-b border-yellow-500/40" style={{ top: "50%" }}>
          <span className="absolute left-2 -top-3 text-xs text-yellow-400">EQ 50%</span>
        </div>
        {/* Discount zone (bottom 38.2%) */}
        <div className="absolute left-0 right-0 bg-green-500/10 border-t border-green-500/30" style={{ bottom: 0, height: "38.2%" }}>
          <span className="absolute left-2 bottom-1 text-xs text-green-400">DISCOUNT ≤38.2%</span>
        </div>

        {/* Fib levels */}
        {pd.fibLevels.map((fib) => (
          <div
            key={fib.level}
            className="absolute left-0 right-0 border-t border-gray-700/40"
            style={{ top: `${(1 - fib.level) * 100}%` }}
          >
            <div className="absolute right-2 -top-3 text-[7px] text-gray-600">{fib.label}</div>
          </div>
        ))}

        {/* Current price line */}
        <div
          className="absolute left-0 right-0 border-t-2 border-cyan-400"
          style={{ top: `${toY(curr)}%` }}
        >
          <div className="absolute right-2 -top-3 text-xs text-cyan-400 font-bold">{fmtP(curr)}</div>
        </div>

        {/* Swing high/low labels */}
        <div className="absolute top-0.5 left-2 text-xs text-gray-600">{fmtP(h)} ↑</div>
        <div className="absolute bottom-0.5 left-2 text-xs text-gray-600">{fmtP(l)} ↓</div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="text-gray-600">Premium</p>
          <p className="text-red-400 font-bold">{fmtP(pd.premium)}</p>
        </div>
        <div>
          <p className="text-gray-600">Equilibrium</p>
          <p className="text-yellow-400 font-bold">{fmtP(pd.equilibrium)}</p>
        </div>
        <div>
          <p className="text-gray-600">Discount</p>
          <p className="text-green-400 font-bold">{fmtP(pd.discount)}</p>
        </div>
      </div>
    </div>
  );
}

export function SmartMoneyPanel({
  selectedSymbol, setSymbol, analysis, allAnalyses, isLoading, lastUpdate,
}: UseSmartMoneyReturn) {
  const [activeTab, setActiveTab] = useState<SMCTab>("overview");

  const TABS: { id: SMCTab; label: string; icon: string; badge?: number }[] = [
    { id: "overview",   label: "Overview",   icon: "🏦" },
    { id: "ob",         label: "Order Blocks", icon: "🧱", badge: analysis?.orderBlocks.filter((b) => b.isActive).length },
    { id: "fvg",        label: "FVG",         icon: "⬜", badge: analysis?.fvgs.filter((f) => !f.isFilled).length },
    { id: "structure",  label: "Structure",   icon: "📐", badge: analysis?.bosEvents.length },
    { id: "sweeps",     label: "Sweeps",      icon: "🧹", badge: analysis?.sweeps.length },
  ];

  if (isLoading || !analysis) {
    return (
      <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Analyzing smart money patterns...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-gray-900 border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            🏦 Smart Money Concepts
            <BiasTag bias={analysis.bias} />
          </h3>
          <p className="text-xs text-gray-600 mt-0.5">OB · FVG · BOS/CHoCH · Liquidity Sweeps · Premium/Discount</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">{lastUpdate.toLocaleTimeString()}</span>
          {/* Symbol switcher */}
          <div className="flex gap-1 flex-wrap">
            {SYMBOLS.map((s) => {
              const a = allAnalyses[s];
              const bias = a?.bias ?? "neutral";
              return (
                <button
                  key={s}
                  onClick={() => setSymbol(s)}
                  className={`text-xs px-1.5 py-0.5 rounded border transition-all ${ 
                    s === selectedSymbol
                      ? "bg-purple-500/20 border-purple-500/50 text-purple-300"
                      : "border-gray-700 text-gray-500 hover:border-gray-600"
                  }`}
                >
                  {s}
                  <span className={`ml-0.5 ${bias === "bullish" ? "text-green-400" : bias === "bearish" ? "text-red-400" : "text-gray-600"}`}>
                    {bias === "bullish" ? "↑" : bias === "bearish" ? "↓" : "→"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Flow score */}
      <div className="px-4 pt-3 pb-2">
        <FlowGauge score={analysis.flowScore} />
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 px-4 pb-2 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg whitespace-nowrap transition-all border ${ 
              activeTab === tab.id
                ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                : "border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-700"
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="bg-purple-500/30 text-purple-300 text-xs px-1.5 rounded-full">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-4 pb-4 space-y-3 max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800">
        {activeTab === "overview" && (
          <>
            {/* Summary bullets */}
            <div className="rounded-xl bg-gray-950/50 border border-gray-800 p-3 space-y-1.5">
              <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase tracking-wide">Analysis Summary</p>
              {analysis.summary.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-300">
                  <span className="text-purple-400 mt-0.5">▸</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Order Blocks",  value: analysis.orderBlocks.length,                 sub: `${analysis.orderBlocks.filter((b) => b.isActive).length} active`,  color: "text-blue-400" },
                { label: "Open FVGs",     value: analysis.fvgs.filter((f) => !f.isFilled).length, sub: `${analysis.fvgs.length} total`,                              color: "text-emerald-400" },
                { label: "BOS Events",    value: analysis.bosEvents.length,                   sub: `${analysis.bosEvents.filter((b) => b.label === "CHoCH").length} CHoCH`, color: "text-orange-400" },
                { label: "Sweeps",        value: analysis.sweeps.length,                      sub: `${analysis.sweeps.filter((s) => s.recovered).length} recovered`,  color: "text-purple-400" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl bg-gray-950/50 border border-gray-800 p-3 text-center">
                  <p className={`text-xl font-black ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
                  <p className="text-xs text-gray-700 mt-0.5">{stat.sub}</p>
                </div>
              ))}
            </div>

            {/* Premium/Discount map */}
            <PremiumDiscountMap analysis={analysis} />

            {/* Key levels */}
            {analysis.keyLevels.length > 0 && (
              <div className="rounded-xl bg-gray-950/50 border border-gray-800 p-3 space-y-2">
                <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase">Key Levels</p>
                <div className="grid grid-cols-2 gap-2">
                  {analysis.keyLevels.map((kl, i) => (
                    <div key={i} className={`flex items-center justify-between text-xs rounded-lg px-3 py-1.5 border ${ 
                      kl.type === "resistance"
                        ? "bg-red-500/5 border-red-500/20 text-red-400"
                        : "bg-green-500/5 border-green-500/20 text-green-400"
                    }`}>
                      <span className="text-gray-400">{kl.label}</span>
                      <span className="font-sans font-bold">{fmtP(kl.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "ob" && (
          <div className="space-y-2">
            {analysis.orderBlocks.length === 0
              ? <p className="text-gray-600 text-sm text-center py-6">No significant order blocks detected.</p>
              : analysis.orderBlocks.map((ob) => <OBCard key={ob.id} ob={ob} />)
            }
          </div>
        )}

        {activeTab === "fvg" && (
          <div className="space-y-2">
            {analysis.fvgs.length === 0
              ? <p className="text-gray-600 text-sm text-center py-6">No fair value gaps detected.</p>
              : analysis.fvgs.map((fvg) => <FVGCard key={fvg.id} fvg={fvg} />)
            }
          </div>
        )}

        {activeTab === "structure" && (
          <div className="space-y-2">
            {/* BOS / CHoCH */}
            {analysis.bosEvents.length > 0 && (
              <div className="space-y-2">
                <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase tracking-wide">BOS / CHoCH Events</p>
                {analysis.bosEvents.map((b) => <BOSCard key={b.id} bos={b} />)}
              </div>
            )}
            {/* Market structure */}
            {analysis.structure.length > 0 && (
              <div className="rounded-xl bg-gray-950/50 border border-gray-800 p-3">
                <p className="text-[13px] font-bold text-gray-500 font-semibold uppercase tracking-wide mb-2">Structure Points</p>
                <div className="flex flex-wrap gap-2">
                  {analysis.structure.map((sp, i) => (
                    <span key={i} className={`text-xs px-2 py-1 rounded-lg border font-bold ${ 
                      sp.type === "HH" ? "bg-green-500/10 border-green-500/30 text-green-400" :
                      sp.type === "HL" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
                      sp.type === "LH" ? "bg-orange-500/10 border-orange-500/30 text-orange-400" :
                      "bg-red-500/10 border-red-500/30 text-red-400"
                    }`}>
                      {sp.type} {fmtP(sp.price)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {analysis.bosEvents.length === 0 && analysis.structure.length === 0 && (
              <p className="text-gray-600 text-sm text-center py-6">Insufficient data for structure analysis.</p>
            )}
          </div>
        )}

        {activeTab === "sweeps" && (
          <div className="space-y-2">
            {analysis.sweeps.length === 0
              ? <p className="text-gray-600 text-sm text-center py-6">No liquidity sweeps detected.</p>
              : analysis.sweeps.map((s) => <SweepCard key={s.id} sweep={s} />)
            }
          </div>
        )}
      </div>
    </div>
  );
}
