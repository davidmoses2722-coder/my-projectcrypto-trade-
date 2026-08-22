/**
 * ManualTradingTerminalV2 — UI BUILD PHASE composition root.
 *
 * This file wires every component in this folder together using
 * MOCK_DATA_SOURCE. It is the ONLY file here that imports mockData.ts —
 * a backend-wiring pass replaces the `data` value below with a real
 * TerminalDataSource (from hooks/fetches) and everything downstream keeps
 * working unchanged, since every component only consumes the
 * TerminalDataSource shape defined in types.ts.
 *
 * Deliberately does not import ManualTradingCenter.tsx or FuturesTerminal.tsx
 * (the already backend-wired terminal from the previous phase) and is not
 * imported by them — this is a standalone, swappable UI kit.
 */
import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen as BookIcon, History as HistoryIcon, SlidersHorizontal } from "lucide-react";
import { ThemeProvider } from "./ThemeProvider";
import { Header } from "./Header";
import { MarketSidebar } from "./MarketSidebar";
import { ChartToolbar } from "./ChartToolbar";
import { FloatingToolbar } from "./FloatingToolbar";
import { useDrawingEngine } from "./drawings/useDrawingEngine";
import { TradingChart } from "./TradingChart";
import { OrderBook } from "./OrderBook";
import { RecentTrades } from "./RecentTrades";
import { SpotTradePanel } from "./SpotTradePanel";
import { FuturesTradePanel } from "./FuturesTradePanel";
import { BottomWorkspace } from "./BottomWorkspace";
import { DEFAULT_INDICATORS, type IndicatorState } from "./IndicatorSelector";
import { MOCK_MARKETS } from "./mockData";
import { useLiveTerminalData } from "./useLiveTerminalData";
import type { MarketMode, MarketRow, Timeframe } from "./types";

type MobileTab = "chart" | "book" | "trade" | "positions";

export function ManualTradingTerminalV2() {
  const [mode, setMode] = useState<MarketMode>("futures");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");

  // ← Phase 2 wiring: real data from already-existing endpoints, capability-
  // gated and partial-failure-tolerant. See useLiveTerminalData.ts for the
  // full endpoint list. Falls back to an empty (not fabricated) shape while
  // loading or when a section's endpoint is unreachable.
  const { data, connected, partialErrors } = useLiveTerminalData(mode, symbol, timeframe);
  const drawingEngine = useDrawingEngine(symbol);

  const [markets, setMarkets] = useState<MarketRow[]>(MOCK_MARKETS);
  const [indicators, setIndicators] = useState<IndicatorState>(DEFAULT_INDICATORS);
  const [obTab, setObTab] = useState<"book" | "trades">("book");
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Real markets arrive via data.markets once /api/market/tickers responds;
  // until then (or if it's unreachable) the sidebar shows MOCK_MARKETS so the
  // layout never looks broken — never presented as live, see connection dot.
  useEffect(() => {
    if (data.markets.length > 0) setMarkets(data.markets);
  }, [data.markets]);

  const currentMarket = markets.find(m => m.symbol === symbol) ?? markets[0];
  const baseAsset = currentMarket?.base ?? "BTC";
  const quoteAsset = currentMarket?.quote ?? "USDT";

  const ticker = useMemo(() => ({ ...data.ticker, mode, displaySymbol: symbol }), [data.ticker, mode, symbol]);

  const toggleFavorite = (sym: string) => {
    setMarkets(prev => prev.map(m => (m.symbol === sym ? { ...m, favorite: !m.favorite } : m)));
  };

  return (
    <ThemeProvider>
      <div className="flex flex-col bg-[#0B0E11] border border-white/[0.06] rounded-xl overflow-hidden" style={{ height: "calc(100vh - 120px)", minHeight: "720px" }}>
        <Header
          mode={mode}
          onModeChange={setMode}
          ticker={ticker}
          favorite={currentMarket?.favorite ?? false}
          onToggleFavorite={() => toggleFavorite(symbol)}
          onOpenSearch={() => setSidebarOpen(true)}
        />

        {!connected && partialErrors.length > 0 && (
          <div className="px-4 py-1.5 text-[10px] text-amber-400/80 bg-amber-500/[0.06] border-b border-amber-500/10 flex-shrink-0">
            Live data unavailable for: {partialErrors.join(", ")} — showing last-known or empty state, not fabricated values.
          </div>
        )}

        {/* ── Mobile tab switcher (below lg) ─────────────────────────────── */}
        <div className="flex lg:hidden items-center border-b border-white/[0.06] bg-[#0d1117] flex-shrink-0">
          {([
            { key: "chart" as MobileTab, label: "Chart", icon: <BarChart3 size={13} /> },
            { key: "book" as MobileTab, label: "Book", icon: <BookIcon size={13} /> },
            { key: "trade" as MobileTab, label: "Trade", icon: <SlidersHorizontal size={13} /> },
            { key: "positions" as MobileTab, label: "Positions", icon: <HistoryIcon size={13} /> },
          ]).map(({ key, label, icon }) => (
            <button key={key} onClick={() => setMobileTab(key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-black transition ${
                mobileTab === key ? "text-[#0ea5e9] bg-white/[0.04]" : "text-slate-600"
              }`}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* LEFT — Market sidebar: always visible on lg+, slide-over on mobile */}
          <div className={`${sidebarOpen ? "flex" : "hidden"} lg:flex flex-col flex-shrink-0 w-[220px] border-r border-white/[0.06] absolute lg:static inset-y-0 left-0 z-20 bg-[#0B0E11] lg:bg-transparent`}>
            <MarketSidebar markets={markets} currentSymbol={symbol} onSelect={s => { setSymbol(s); setSidebarOpen(false); }} onToggleFavorite={toggleFavorite} />
          </div>
          {sidebarOpen && <div className="lg:hidden fixed inset-0 bg-black/50 z-10" onClick={() => setSidebarOpen(false)} />}

          {/* CENTER — Chart + Order Book/Trades */}
          <div className={`flex-1 min-h-0 border-r border-white/[0.06] overflow-hidden ${mobileTab === "chart" || mobileTab === "book" ? "flex" : "hidden"} lg:flex flex-col`}>
            <div className={`${mobileTab === "chart" ? "flex" : "hidden"} lg:flex flex-1 min-h-0 flex-col`}>
              <ChartToolbar timeframe={timeframe} onTimeframeChange={setTimeframe} indicators={indicators}
                onToggleIndicator={key => setIndicators(prev => ({ ...prev, [key]: !prev[key] }))}
              />
              <div className="relative flex flex-1 min-h-0 overflow-visible">
                <FloatingToolbar engine={drawingEngine} />
                <TradingChart candles={data.candles} indicators={indicators} engine={drawingEngine} />
              </div>
            </div>

            <div className={`${mobileTab === "book" ? "flex" : "hidden"} lg:flex h-full lg:h-[260px] flex-shrink-0 border-t border-white/[0.06] flex-col`}>
              <div className="flex items-center border-b border-white/[0.06] bg-[#0d1117] flex-shrink-0">
                {([
                  { key: "book" as const, label: "Order Book" },
                  { key: "trades" as const, label: "Recent Trades" },
                ]).map(({ key, label }) => (
                  <button key={key} onClick={() => setObTab(key)}
                    className={`px-4 py-2.5 text-[11px] font-black uppercase tracking-wider border-b-2 transition ${
                      obTab === key ? "border-[#0ea5e9] text-[#0ea5e9]" : "border-transparent text-slate-600 hover:text-slate-400"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-0">
                {obTab === "book" ? <OrderBook book={data.orderBook} /> : <RecentTrades trades={data.recentTrades} />}
              </div>
            </div>
          </div>

          {/* RIGHT — Trade panel */}
          <div className={`w-full lg:w-[300px] flex-shrink-0 ${mobileTab === "trade" ? "flex" : "hidden"} lg:flex flex-col overflow-y-auto bg-[#0d1117]`}>
            {mode === "spot" ? (
              <SpotTradePanel baseAsset={baseAsset} quoteAsset={quoteAsset} livePrice={ticker.price} availableBalanceUsd={data.availableBalanceUsd} />
            ) : (
              <FuturesTradePanel baseAsset={baseAsset} quoteAsset={quoteAsset} livePrice={ticker.price} availableBalanceUsd={data.availableBalanceUsd} />
            )}
          </div>
        </div>

        <div className={`${mobileTab === "positions" ? "block" : "hidden"} lg:block`}>
          <BottomWorkspace data={data} mode={mode} />
        </div>
      </div>
    </ThemeProvider>
  );
}
