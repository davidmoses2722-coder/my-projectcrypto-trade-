/**
 * OrderBookView — Main page: Order Book + Liquidity Zones + Sniper Entries
 */
import { useState } from "react";
import { CoinPrice } from "../types/crypto";
import { useOrderBook, SYMBOLS } from "../hooks/useOrderBook";
import { OrderBookPanel } from "./OrderBookPanel";
import { LiquidityZonesPanel } from "./LiquidityZones";
import { SniperEntryPanel } from "./SniperEntry";
import { telegramAlert } from "../services/telegram";
import { SniperEntry } from "../types/crypto";
import { PremiumCard } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";
import { BarChart2, Layers, Target, Activity } from "lucide-react";
import { motion } from "framer-motion";

interface Props {
  prices: CoinPrice[];
}

type ActivePanel = "orderbook" | "zones" | "snipers";

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function OrderBookView({ prices }: Props) {
  const [activePanel, setActivePanel] = useState<ActivePanel>("orderbook");
  const [execMsg,     setExecMsg]     = useState<string | null>(null);

  const {
    selectedSymbol,
    setSymbol,
    orderBook,
    zones,
    snipers,
    analytics,
    isLoading,
    isLive,
    lastUpdate,
  } = useOrderBook(prices);

  const currentPrice = prices.find((p) => p.symbol === selectedSymbol)?.price ?? orderBook?.midPrice ?? 0;

  const armedCount  = snipers.filter((s) => s.status === "ARMED").length;
  const activeZones = zones.filter((z) => z.isActive).length;

  // Handle sniper execution
  const handleExecute = async (sniper: SniperEntry) => {
    const msg = `🎯 Sniper ${sniper.side} ${sniper.symbol}\nEntry: ${sniper.entryPrice.toFixed(2)}\nTarget: ${sniper.targetPrice.toFixed(2)}\nSL: ${sniper.stopLoss.toFixed(2)}\nR:R ${sniper.riskReward.toFixed(1)}:1`;
    setExecMsg(`✅ Sniper order executed: ${sniper.side} ${sniper.symbol} @ ${sniper.entryPrice.toFixed(2)}`);
    await telegramAlert(msg);
    setTimeout(() => setExecMsg(null), 4000);
  };

  const PANELS: { id: ActivePanel; label: string; icon: string; badge?: number }[] = [
    { id: "orderbook", label: "Order Book",       icon: "📊" },
    { id: "zones",     label: "Liquidity Zones",  icon: "🗺️", badge: activeZones },
    { id: "snipers",   label: "Sniper Entries",   icon: "🎯", badge: armedCount },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <BarChart2 className="text-cyan-400" /> Order Book & Liquidity Engine
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Real-time depth · Liquidity zone detection · Sniper precision entries
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${
            isLive
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
            {isLive ? "LIVE" : "SIM"} — {lastUpdate.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Execution toast */}
      {execMsg && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <span className="text-green-400 text-sm">✅</span>
          <p className="text-green-400 text-sm font-semibold">{execMsg}</p>
        </div>
      )}

      {/* Symbol selector */}
      <div className="flex flex-wrap gap-2">
        {SYMBOLS.map((sym) => {
          const coin  = prices.find((p) => p.symbol === sym);
          const isUp  = (coin?.changePercent24h ?? 0) >= 0;
          return (
            <button
              key={sym}
              onClick={() => setSymbol(sym)}
              className={`px-3 py-1.5 rounded-xl text-sm font-bold border transition-all ${
                selectedSymbol === sym
                  ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-400"
                  : "bg-slate-900 border-white/5 text-slate-400 hover:border-gray-600"
              }`}
            >
              <span>{sym}</span>
              {coin && (
                <span className={`ml-1.5 ${isUp ? "text-green-400" : "text-rose-400"}`}>
                  {isUp ? "+" : ""}{coin.changePercent24h.toFixed(1)}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Quick stats bar */}
      {orderBook && analytics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="bg-slate-900 border border-white/5 rounded-xl px-3 py-2">
            <p className="text-sm text-slate-500">Mid Price</p>
            <p className="text-sm font-black text-white">
              ${orderBook.midPrice >= 100
                ? orderBook.midPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })
                : orderBook.midPrice.toFixed(4)}
            </p>
          </div>
          <div className="bg-slate-900 border border-white/5 rounded-xl px-3 py-2">
            <p className="text-sm text-slate-500">Spread</p>
            <p className="text-sm font-black text-yellow-400">{orderBook.spreadPct.toFixed(3)}%</p>
          </div>
          <div className="bg-slate-900 border border-white/5 rounded-xl px-3 py-2">
            <p className="text-sm text-slate-500">Imbalance</p>
            <p className={`text-sm font-black ${analytics.imbalance > 55 ? "text-green-400" : analytics.imbalance < 45 ? "text-rose-400" : "text-gray-300"}`}>
              {analytics.imbalance.toFixed(1)}%{" "}
              <span className="text-sm font-normal">{analytics.imbalance > 55 ? "Bid" : analytics.imbalance < 45 ? "Ask" : "Neutral"}</span>
            </p>
          </div>
          <div className="bg-slate-900 border border-white/5 rounded-xl px-3 py-2">
            <p className="text-sm text-slate-500">Bid Depth ±1%</p>
            <p className="text-sm font-black text-green-400">{fmtK(analytics.depth1pct.bidDepth)}</p>
          </div>
          <div className="bg-slate-900 border border-white/5 rounded-xl px-3 py-2">
            <p className="text-sm text-slate-500">Ask Depth ±1%</p>
            <p className="text-sm font-black text-rose-400">{fmtK(analytics.depth1pct.askDepth)}</p>
          </div>
          <div className="bg-slate-900 border border-white/5 rounded-xl px-3 py-2">
            <p className="text-sm text-slate-500">Zones Found</p>
            <p className="text-sm font-black text-purple-400">
              {zones.length} <span className="text-sm font-normal text-slate-500">({activeZones} active)</span>
            </p>
          </div>
        </div>
      )}

      {/* Panel tabs */}
      <div className="flex gap-2 border-b border-white/5 pb-0">
        {PANELS.map((panel) => (
          <button
            key={panel.id}
            onClick={() => setActivePanel(panel.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 transition-all -mb-px ${
              activePanel === panel.id
                ? "border-cyan-500 text-cyan-400"
                : "border-transparent text-slate-500 hover:text-gray-300"
            }`}
          >
            <span>{panel.icon}</span>
            <span>{panel.label}</span>
            {panel.badge !== undefined && panel.badge > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-sm font-black bg-cyan-500/20 text-cyan-400">
                {panel.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-500 text-sm">Loading order book…</p>
          </div>
        </div>
      )}

      {/* Panel content */}
      {!isLoading && orderBook && analytics && (
        <div>
          {activePanel === "orderbook" && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Order book */}
              <OrderBookPanel book={orderBook} analytics={analytics} />

              {/* Right side: market info + zone list */}
              <div className="space-y-4">
                {/* Largest wall callout */}
                {analytics.largestWall && (
                  <div className={`rounded-xl p-4 border ${
                    analytics.largestWall.side === "bid"
                      ? "bg-green-500/8 border-green-500/25"
                      : "bg-red-500/8 border-red-500/25"
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-yellow-400 text-xl">⚡</span>
                      <span className="text-white font-bold text-sm">Largest Order Wall Detected</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-slate-500">Side</p>
                        <p className={`font-bold text-sm ${analytics.largestWall.side === "bid" ? "text-green-400" : "text-rose-400"}`}>
                          {analytics.largestWall.side === "bid" ? "BUY Wall" : "SELL Wall"}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Price</p>
                        <p className="font-bold text-white">
                          {analytics.largestWall.level.price >= 100
                            ? analytics.largestWall.level.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
                            : analytics.largestWall.level.price.toFixed(4)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Quantity</p>
                        <p className="font-bold text-white">{analytics.largestWall.level.quantity.toFixed(4)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Notional</p>
                        <p className="font-bold text-yellow-400">{fmtK(analytics.largestWall.level.total)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Depth comparison */}
                <div className="bg-slate-900 border border-white/5 rounded-xl p-4">
                  <p className="text-sm font-bold text-white mb-3">Depth Analysis</p>
                  <div className="space-y-3">
                    {([1, 2] as const).map((pct) => {
                      const data  = pct === 1 ? analytics.depth1pct : analytics.depth2pct;
                      const total = data.bidDepth + data.askDepth || 1;
                      const bidPct = (data.bidDepth / total) * 100;
                      return (
                        <div key={pct}>
                          <div className="flex items-center justify-between mb-1 text-sm">
                            <span className="text-green-400">Bids ±{pct}%: {fmtK(data.bidDepth)}</span>
                            <span className="text-rose-400">Asks ±{pct}%: {fmtK(data.askDepth)}</span>
                          </div>
                          <div className="h-2 bg-slate-800 rounded-full overflow-hidden flex">
                            <div className="h-full bg-green-500 transition-all" style={{ width: `${bidPct}%` }} />
                            <div className="h-full bg-red-500 transition-all" style={{ width: `${100 - bidPct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Active zones quick list */}
                <div className="bg-slate-900 border border-white/5 rounded-xl p-4">
                  <p className="text-sm font-bold text-white mb-3">
                    Top Zones near Price
                    <span className="ml-2 text-sm text-slate-500 font-normal">click Liquidity Zones tab for full map</span>
                  </p>
                  {zones.slice(0, 5).map((zone) => {
                    const distPct = ((currentPrice - zone.midPrice) / currentPrice * 100);
                    const isUp    = zone.midPrice < currentPrice;
                    return (
                      <div key={zone.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-sm ${
                            zone.type === "demand" || zone.type === "support" ? "bg-green-400" :
                            zone.type === "absorption" ? "bg-purple-400" : "bg-red-400"
                          }`} />
                          <div>
                            <p className="text-sm text-gray-300">{zone.label}</p>
                            <p className="text-sm text-slate-600">
                              {zone.midPrice >= 100
                                ? zone.midPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })
                                : zone.midPrice.toFixed(4)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${isUp ? "text-rose-400" : "text-green-400"}`}>
                            {isUp ? "↓" : "↑"}{Math.abs(distPct).toFixed(2)}%
                          </p>
                          <p className="text-sm text-slate-600">{zone.strength}% str.</p>
                        </div>
                      </div>
                    );
                  })}
                  {zones.length === 0 && (
                    <p className="text-slate-600 text-sm">No zones detected yet…</p>
                  )}
                </div>

                {/* Armed snipers quick view */}
                {snipers.filter((s) => s.status === "ARMED").length > 0 && (
                  <div className="bg-cyan-500/8 border border-cyan-500/25 rounded-xl p-4">
                    <p className="text-cyan-400 font-bold text-sm mb-3">🎯 Snipers Armed</p>
                    {snipers.filter((s) => s.status === "ARMED").slice(0, 3).map((sn) => (
                      <div key={sn.id} className="flex items-center justify-between py-1.5 border-b border-cyan-500/10 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-black px-1.5 py-0.5 rounded ${sn.side === "BUY" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-rose-400"}`}>
                            {sn.side}
                          </span>
                          <span className="text-sm text-slate-400">
                            @ {sn.entryPrice >= 100
                              ? sn.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })
                              : sn.entryPrice.toFixed(4)}
                          </span>
                        </div>
                        <span className="text-sm text-yellow-400 font-bold">{sn.riskReward.toFixed(1)}R · {sn.confidence}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activePanel === "zones" && (
            <LiquidityZonesPanel
              zones={zones}
              currentPrice={currentPrice}
              symbol={selectedSymbol}
            />
          )}

          {activePanel === "snipers" && (
            <SniperEntryPanel
              snipers={snipers}
              currentPrice={currentPrice}
              onExecute={handleExecute}
            />
          )}
        </div>
      )}
    </motion.div>
  );
}
