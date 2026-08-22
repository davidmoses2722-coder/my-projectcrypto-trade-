import { useState, useMemo, useEffect } from "react";
import { useLivePrices }      from "./hooks/useLivePrices";
import { useBotEngine }       from "./hooks/useBotEngine";
import { useBotServer }       from "./hooks/useBotServer";
import type { ServerTrade }   from "./hooks/useBotServer";
import { useSSE }             from "./hooks/useSSE";
import { useRiskManager }     from "./hooks/useRiskManager";
import { useAuth }            from "./hooks/useAuth";
import { useCredentials }     from "./hooks/useCredentials";
import { useProfitTracker }   from "./hooks/useProfitTracker";
import type { Trade, PortfolioAsset } from "./types/crypto";

import { Header }           from "./components/Header";
import { MobileHeader }     from "./components/MobileHeader";
import { MobileNav, MobileMoreMenu } from "./components/MobileNav";
import { LoginScreen }      from "./components/LoginScreen";
import { MobileDashboard }  from "./components/MobileDashboard";
import { Dashboard }        from "./components/Dashboard";
import { SignalsView }      from "./components/SignalsView";
import { PortfolioView }    from "./components/PortfolioView";
import { TradesView }       from "./components/TradesView";
import { BotConfigView }    from "./components/BotConfig";
import { OrderBookView }    from "./components/OrderBookView";
import { AnalyticsView }    from "./components/AnalyticsView";
import { BacktestView }     from "./components/BacktestView";
import { DeploymentView }   from "./components/DeploymentView";
import { CredentialsForm }  from "./components/CredentialsForm";
import LiveSignals          from "./components/LiveSignals";
import { StrategyRankingPanel }   from "./components/StrategyRankingPanel";
import { WalkForwardPanel }       from "./components/WalkForwardPanel";
import { OptimizerPanel }         from "./components/OptimizerPanel";
import { CapitalProtectionPanel } from "./components/CapitalProtectionPanel";
import { CorrelationRiskPanel }   from "./components/CorrelationRiskPanel";
import { ExecutionAnalyticsPanel } from "./components/ExecutionAnalyticsPanel";
import { TradeJournalView }       from "./components/TradeJournalView";
import { TradeReviewPanel }       from "./components/TradeReviewPanel";
import { LivePerformancePanel }   from "./components/LivePerformancePanel";
import { RegimeIntelligencePanel } from "./components/RegimeIntelligencePanel";
import { BenchmarkPanel }            from "./components/BenchmarkPanel";
import OrchestratorDashboard         from "./components/OrchestratorDashboard";
import { ManualTradingCenter }        from "./components/ManualTradingCenter";
import { FuturesTerminal }             from "./components/FuturesTerminal";
import { StrategyLab }                from "./components/StrategyLab";
import { CopyTradingCenter }          from "./components/CopyTradingCenter";
import { SERVER_URL }                from "./config/urls";

import { INITIAL_PORTFOLIO } from "./data/mockData";
import { hasValidBinanceKeys } from "./services/binance";
import { hasValidTelegramConfig } from "./services/telegram";
import { StatusBadge } from "./components/premium/StatusBadge";
import { Loader2, AlertTriangle, Shield, AlertOctagon, Ban, PhoneOff, Database, CircleAlert, TrendingUp, TrendingDown, Lock, Server, Bell, BarChart3 } from "lucide-react";

// ── Adapt ServerTrade[] → Trade[] so server trades flow into all existing views ─
function adaptServerTrades(serverTrades: ServerTrade[]): Trade[] {
  return serverTrades.map((t): Trade => {
    const sym = t.symbol.replace(/_?USDT$/i, "").replace(/USDT$/i, "");
    const reason = (t.reason ?? "").toLowerCase();
    const exitReason: Trade["exitReason"] =
      reason.includes("take_profit") ? "TP" :
      reason.includes("stop_loss")   ? "SL" :
      reason.includes("trailing")    ? "TRAILING" : "MANUAL";
    return {
      id:          t.id,
      coin:        sym,
      symbol:      sym,
      type:        t.side.toLowerCase() === "sell" ? "SELL" : "BUY",
      amount:      t.qty,
      price:       t.entry,
      total:       t.entry * t.qty,
      pnl:         t.pnlUsd,
      pnlPercent:  t.pnlPct,
      timestamp:   new Date(t.time),
      status:      t.exit > 0 ? "closed" : "open",
      exitPrice:   t.exit > 0 ? t.exit : undefined,
      isReal:      !t.dryRun,
      realised:    t.pnlUsd,
      duration:    t.holdMins * 60_000,
      exitReason,
    };
  });
}

// ── Adapt server portfolio positions → PortfolioAsset[] for PortfolioView ──────
const PORTFOLIO_COLORS = [
  "#06b6d4","#22c55e","#a855f7","#f97316",
  "#eab308","#ef4444","#3b82f6","#14b8a6",
];
function adaptServerPortfolio(
  snap: import("./hooks/useBotServer").PortfolioSnapshot | undefined,
  prices: import("./types/crypto").CoinPrice[],
): PortfolioAsset[] {
  if (!snap?.positions?.length) return [];
  return snap.positions.map((pos, i): PortfolioAsset => {
    const sym  = pos.symbol.replace(/_?USDT$/i, "").replace(/USDT$/i, "");
    const live = prices.find((p) => p.symbol === sym);
    return {
      id:           pos.id,
      symbol:       sym,
      name:         sym,
      amount:       pos.qty,
      buyPrice:     pos.entryPrice,
      currentPrice: live?.price ?? pos.entryPrice,
      color:        PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length],
    };
  });
}

// ── Detect mobile ─────────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ── URL tab persistence ────────────────────────────────────────────────────────
function getInitialTab(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab) return tab;
  } catch { /* ignore */ }
  return "dashboard";
}

export default function App() {
  const isMobile = useIsMobile();

  // ── Auth ─────────────────────────────────────────────────────────────────
  const { state: authState, error: authError, attempts, setupPin, login, lock, resetPin } = useAuth();

  // ── Tab routing ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [showMore, setShowMore]   = useState(false);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setShowMore(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.toString());
    } catch { /* ignore */ }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Credentials ───────────────────────────────────────────────────────────
  const { hasTelegram } = useCredentials();

  // ── Live market data ──────────────────────────────────────────────────────
  const {
    prices, lastUpdate, totalMarketCap, fearGreedIndex,
    isLive, apiError, connectionStatus,
  } = useLivePrices();
  const tickerPrices = prices.slice(0, 24);

  // ── Client-side bot engine (signal generation only — trades sourced from server) ─
  // NOTE: start/stop/config are handled by the server bot below.
  const { signals, trades: engineTrades, totalPnL: enginePnL } = useBotEngine(prices);

  // ── Server (Node.js) bot — PRIMARY control plane ──────────────────────────
  const serverBot = useBotServer();

  // ── Phase 13: SSE real-time sync — immediately refresh on position/config events ──
  useSSE((event) => {
    if (
      event.type === "position:open" ||
      event.type === "position:close" ||
      event.type === "position:update" ||
      event.type === "order:created" ||
      event.type === "order:update" ||
      event.type === "config:update" ||
      event.type === "risk:update"
    ) {
      void serverBot.fetchStatus();
    }
  });

  // isBotRunning = server bot truth (not client-side engine)
  const isBotRunning = serverBot.status.isRunning;

  // ── Closed trades from server (adapted to Trade shape) ───────────────────
  const serverTradesMapped = useMemo(
    () => adaptServerTrades(serverBot.trades),
    [serverBot.trades],
  );

  // ── Synthesize an "open" Trade from the server's active position ──────────
  //    bot.getTrades() returns ONLY ClosedTrade[].  The current open position
  //    lives in status.position and must be injected here so that all views
  //    (Dashboard, TradesView, MobileDashboard) see it in `openPositions`.
  //    This is the single-source-of-truth fix for Phase 13.
  const openPositionTrade = useMemo((): Trade[] => {
    const pos = serverBot.status.position;
    if (!pos) return [];
    // rawSym is the full server symbol e.g. "BTCUSDT" — used for API calls.
    // coin is the stripped display label e.g. "BTC".
    const rawSym = serverBot.status.symbol ?? "UNKNOWN";
    const coin   = rawSym.replace(/_?USDT$/i, "").replace(/USDT$/i, "");
    const cur    = serverBot.status.lastPrice || pos.entry;
    const pnlUsd = (cur - pos.entry) * pos.qty;
    const pnlPct = pos.entry > 0 ? ((cur - pos.entry) / pos.entry) * 100 : 0;
    return [{
      id:         `live-${String(pos.orderId ?? pos.time)}`,
      coin:       coin,
      // symbol intentionally kept as the raw server form ("BTCUSDT") so that
      // POST /api/positions/:symbol/take-profit and /close receive the exact
      // symbol triggerManualClose() expects — it normalises _/ but NOT stripping USDT.
      symbol:     rawSym,
      type:       "BUY" as const,
      amount:     pos.qty,
      price:      pos.entry,
      total:      pos.entry * pos.qty,
      pnl:        pnlUsd,
      pnlPercent: pnlPct,
      timestamp:  new Date(pos.time),
      status:     "open" as const,
      isReal:     !(pos.dryRun ?? true),
      tp:         pos.tp,
      sl:         pos.sl,
      duration:   Date.now() - pos.time,
      realised:   0,
    }];
  }, [serverBot.status.position, serverBot.status.lastPrice, serverBot.status.symbol]);

  // ── Single source of truth: open position + closed trades → all views ─────
  //    Falls back to client-engine trades only when the server has NO data.
  const trades = useMemo((): Trade[] => {
    const hasServerData = openPositionTrade.length > 0 || serverTradesMapped.length > 0;
    return hasServerData ? [...openPositionTrade, ...serverTradesMapped] : engineTrades;
  }, [openPositionTrade, serverTradesMapped, engineTrades]);
  const totalPnL = serverBot.status.performance?.totalPnlUsd
    ?? (serverBot.status.dailyPnL !== 0 ? serverBot.status.dailyPnL : enginePnL);

  // ── Profit stats ──────────────────────────────────────────────────────────
  const profitStats = useProfitTracker(trades);

  // ── Risk manager ──────────────────────────────────────────────────────────
  const riskTrades = useMemo(
    () => trades.map((t) => ({
      pnl:        t.pnl        ?? 0,
      pnlPercent: t.pnlPercent ?? 0,
      status:     t.status as "open" | "closed",
    })),
    [trades]
  );
  const { riskState, limits, updateLimits, canOpenTrade } = useRiskManager(
    riskTrades, 10000, isBotRunning
  );

  // ── Portfolio: server open positions → PortfolioAsset; empty fallback ─────
  const portfolio = useMemo(
    () => {
      const fromServer = adaptServerPortfolio(serverBot.status.portfolio, prices);
      if (fromServer.length > 0) return fromServer;
      // Static fallback (INITIAL_PORTFOLIO is [] by default)
      return INITIAL_PORTFOLIO.map((a) => {
        const live = prices.find((p) => p.symbol === a.symbol);
        return { ...a, currentPrice: live?.price ?? a.currentPrice };
      });
    },
    [serverBot.status.portfolio, prices],
  );

  // ── Circuit breaker ───────────────────────────────────────────────────────
  const shouldHalt = riskState.circuitBreakerTripped && isBotRunning;

  // ── Show login screen if not authenticated ────────────────────────────────
  if (authState === "loading") {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === "setup" || authState === "locked") {
    return (
      <LoginScreen
        state={authState}
        error={authError}
        attempts={attempts}
        onLogin={login}
        onSetup={setupPin}
        onReset={resetPin}
      />
    );
  }

  // ── Bot log for DeploymentView (server logs converted to strings) ─────────
  const serverBotLog = serverBot.logs.map((l) => `[${l.level}] ${l.msg}`);

  // ── Render main content by tab ────────────────────────────────────────────
  const renderContent = () => {
    switch (activeTab) {

      // ── Dashboard ──────────────────────────────────────────────────────────
      case "dashboard":
        if (isMobile) {
          return (
            <MobileDashboard
              prices={prices}
              signals={signals}
              trades={trades}
              totalPnL={totalPnL}
              fearGreedIndex={fearGreedIndex}
              isBotRunning={isBotRunning}
              onTabChange={handleTabChange}
            />
          );
        }
        return (
          <Dashboard
            prices={prices}
            signals={signals}
            trades={trades}
            portfolio={portfolio}
            totalPnL={totalPnL}
            fearGreedIndex={fearGreedIndex}
            isBotRunning={isBotRunning}
            activeStrategy={serverBot.status?.activeStrategy}
            onTabChange={handleTabChange}
          />
        );

      // ── Market views ───────────────────────────────────────────────────────
      case "livesignals": return <LiveSignals />;
      case "signals":     return <SignalsView />;
      case "orderbook":   return <OrderBookView prices={prices} />;
      case "analytics":   return <AnalyticsView prices={prices} />;
      case "backtest":    return <BacktestView />;
      case "portfolio":   return <PortfolioView status={serverBot.status} />;
      case "trades":      return <TradesView trades={trades} totalPnL={totalPnL} stats={profitStats} />;
      case "manual-trading":
        return (
          <ManualTradingCenter
            prices={prices}
            status={serverBot.status}
            connection={serverBot.connection}
            onRefreshStatus={serverBot.fetchStatus}
          />
        );
      case "futures":
        return (
          <FuturesTerminal
            symbol={serverBot.status.symbol ?? "BTCUSDT"}
            prices={prices}
            isPaper={!(serverBot.status as unknown as { isLive?: boolean }).isLive}
            onRefreshStatus={serverBot.fetchStatus}
          />
        );
      case "strategy-lab":   return <StrategyLab />;
      case "copy-trading":   return <CopyTradingCenter />;

      // ── Bot Control Center ─────────────────────────────────────────────────
      // "serverbot" and "pythonbot" now redirect here (unified control)
      case "bot":
      case "serverbot":
      case "pythonbot":
        return (
          <BotConfigView
            status={serverBot.status}
            logs={serverBot.logs}
            connection={serverBot.connection}
            error={serverBot.error}
            onStart={serverBot.start}
            onStop={serverBot.stop}
            onUpdateConfig={serverBot.updateConfig}
          />
        );

      // ── Safety / VPS ───────────────────────────────────────────────────────
      case "deploy":
        return (
          <DeploymentView
            riskState={riskState}
            limits={limits}
            onUpdateLimits={updateLimits}
            isBotRunning={isBotRunning}
            onStopBot={() => void serverBot.stop()}
            botLog={serverBotLog}
          />
        );

      // ── Settings ───────────────────────────────────────────────────────────
      case "settings":
        return (
          <div className="space-y-6">
            <CredentialsForm />
          </div>
        );

      // ── Phase 7-10: Advanced Modules ───────────────────────────────────────
      case "strategy-ranking":    return <StrategyRankingPanel />;
      case "walk-forward":        return <WalkForwardPanel />;
      case "optimizer":           return <OptimizerPanel />;
      case "capital-protection":  return <CapitalProtectionPanel />;
      case "correlation-risk":    return <CorrelationRiskPanel />;
      case "execution-analytics": return <ExecutionAnalyticsPanel />;
      case "trade-journal":       return <TradeJournalView />;
      case "trade-review":        return <TradeReviewPanel />;
      case "live-performance":    return <LivePerformancePanel />;
      case "regime-intelligence": return <RegimeIntelligencePanel />;
      case "benchmark":           return <BenchmarkPanel />;
      case "orchestrator":        return <OrchestratorDashboard serverUrl={SERVER_URL} />;

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen text-white" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── DESKTOP header (hidden on mobile) ────────────────────────── */}
      <div className="hidden lg:block">
        <Header
          totalMarketCap={totalMarketCap}
          fearGreedIndex={fearGreedIndex}
          lastUpdate={lastUpdate}
          isBotRunning={isBotRunning}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          connectionStatus={connectionStatus}
          onLock={lock}
        />
      </div>

      {/* ── MOBILE header (hidden on desktop) ────────────────────────── */}
      <MobileHeader
        isBotRunning={isBotRunning}
        connectionStatus={connectionStatus}
        fearGreedIndex={fearGreedIndex}
        onLock={lock}
        onMore={() => setShowMore(true)}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* ── Mobile more menu overlay ─────────────────────────────────── */}
      {showMore && (
        <MobileMoreMenu
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onClose={() => setShowMore(false)}
        />
      )}

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="max-w-screen-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 lg:pb-6 mobile-pad">

        {/* ── Circuit breaker banner ───────────────────────────────────── */}
        {shouldHalt && (
          <div className="mb-4 flex items-center justify-between gap-4 bg-rose-900/40 border-2 border-rose-500/60 rounded-xl px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <Ban className="text-rose-500 shrink-0 animate-pulse" size={28} />
              <div className="min-w-0">
                <p className="text-rose-400 font-black text-sm font-bold uppercase tracking-wider">
                  CIRCUIT BREAKER — AUTO-HALTING BOT
                </p>
                <p className="text-rose-300/80 text-xs mt-0.5 truncate">
                  {riskState.alerts[0]?.message ?? "Safety threshold hit"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleTabChange("deploy")}
                className="text-sm font-semibold bg-amber-500/20 border border-amber-500/30 text-amber-400 px-3 py-1.5 rounded-lg hover:bg-amber-500/30 transition-colors hidden sm:block"
              >
                View Safety →
              </button>
              <button
                onClick={() => void serverBot.stop()}
                className="text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
              >
                STOP BOT
              </button>
            </div>
          </div>
        )}

        {/* ── Risk score bar (while bot running) ───────────────────────── */}
        {isBotRunning && (
          <div
            className={`mb-4 flex items-center gap-2 sm:gap-3 rounded-xl px-3 sm:px-4 py-2.5 border cursor-pointer transition-all hover:brightness-110 premium-glass ${
              riskState.status === "SAFE"    ? "border-emerald-500/20 bg-emerald-500/5" :
              riskState.status === "CAUTION" ? "border-amber-500/20 bg-amber-500/5" :
              riskState.status === "WARNING" ? "border-orange-500/25 bg-orange-500/5" :
              riskState.status === "DANGER"  ? "border-rose-500/30 bg-rose-500/5" :
                                               "border-rose-500/50 bg-rose-900/10"
            }`}
            onClick={() => handleTabChange("deploy")}
          >
            <span className="shrink-0">
              {riskState.status === "SAFE" ? <Shield className="text-emerald-500" size={16} /> : riskState.status === "HALTED" ? <Ban className="text-rose-500" size={16} /> : <AlertTriangle className="text-amber-500" size={16} />}
            </span>
            <span className={`text-sm font-bold shrink-0 tracking-wide ${
              riskState.status === "SAFE" ? "text-emerald-400" :
              riskState.status === "CAUTION" ? "text-amber-400" :
              riskState.status === "WARNING" ? "text-orange-400" : "text-rose-400"
            }`}>
              {riskState.status}
            </span>
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${
                riskState.riskScore >= 70 ? "bg-rose-500" :
                riskState.riskScore >= 50 ? "bg-orange-400" :
                riskState.riskScore >= 30 ? "bg-amber-400" : "bg-emerald-500"
              }`} style={{ width: `${riskState.riskScore}%` }} />
            </div>
            <span className="text-sm text-slate-400 shrink-0">{riskState.riskScore}/100</span>
            <span className="hidden sm:inline text-slate-700">·</span>
            <span className="hidden sm:inline text-sm text-slate-400">
              DD: <span className={riskState.drawdown > 5 ? "text-rose-400" : "text-slate-300"}>{riskState.drawdown.toFixed(1)}%</span>
            </span>
            <span className={`text-sm font-bold shrink-0 ml-1 flex items-center gap-1 ${canOpenTrade().allowed ? "text-emerald-400" : "text-rose-400"}`}>
              {canOpenTrade().allowed ? <StatusBadge variant="safe" label="OK" /> : <StatusBadge variant="halted" label="BLOCK" />}
            </span>
          </div>
        )}

        {/* ── API config banners ──────────────────────────────────────── */}
        {!hasTelegram && !hasValidTelegramConfig && (
          <div className="mb-4 flex items-center gap-3 bg-cyan-900/10 border border-cyan-500/20 rounded-xl px-4 py-3 premium-glass">
            <PhoneOff className="text-cyan-400 shrink-0" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-cyan-400 text-sm font-semibold tracking-wide">Telegram alerts not configured</p>
            </div>
            <button
              onClick={() => handleTabChange("settings")}
              className="shrink-0 text-sm font-semibold px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition-colors font-medium"
            >
              Setup →
            </button>
          </div>
        )}
        {isLive === false && apiError && hasValidBinanceKeys && (
          <div className="mb-4 flex items-center gap-3 bg-rose-900/10 border border-rose-500/20 rounded-xl px-4 py-3 premium-glass">
            <Database className="text-rose-400 shrink-0" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-rose-400 text-sm font-semibold tracking-wide">Market feed error</p>
              <p className="text-slate-400 text-sm font-medium truncate mt-0.5">{apiError}</p>
            </div>
          </div>
        )}

        {/* ── Live ticker bar ─────────────────────────────────────────── */}
        <div className="mb-6 overflow-hidden rounded-xl premium-glass border border-white/5 relative">
          <div className="flex items-center overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-6 px-4 py-2.5 animate-ticker hover:[animation-play-state:paused]">
              {tickerPrices.map((coin) => {
                const isUp  = coin.changePercent24h >= 0;
                const price = coin.price >= 100
                  ? coin.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
                  : coin.price.toFixed(4);
                return (
                  <div key={coin.id} className="flex items-center gap-2 whitespace-nowrap shrink-0 group">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-sm font-semibold text-slate-300 border border-white/5 group-hover:border-cyan-500/30 transition-colors">
                      {coin.symbol.slice(0, 2)}
                    </span>
                    <span className="text-slate-300 font-semibold text-sm font-semibold tracking-wide">{coin.symbol}</span>
                    <span className="text-white font-bold text-xs">${price}</span>
                    <span className={`flex items-center text-sm font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                      {isUp ? <TrendingUp size={12} className="mr-0.5" /> : <TrendingDown size={12} className="mr-0.5" />}
                      {Math.abs(coin.changePercent24h).toFixed(2)}%
                    </span>
                  </div>
                );
              })}
              {/* Duplicate for seamless marquee effect */}
              {tickerPrices.map((coin) => {
                const isUp  = coin.changePercent24h >= 0;
                const price = coin.price >= 100
                  ? coin.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
                  : coin.price.toFixed(4);
                return (
                  <div key={`dup-${coin.id}`} className="flex items-center gap-2 whitespace-nowrap shrink-0 group">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-sm font-semibold text-slate-300 border border-white/5 group-hover:border-cyan-500/30 transition-colors">
                      {coin.symbol.slice(0, 2)}
                    </span>
                    <span className="text-slate-300 font-semibold text-sm font-semibold tracking-wide">{coin.symbol}</span>
                    <span className="text-white font-bold text-xs">${price}</span>
                    <span className={`flex items-center text-sm font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                      {isUp ? <TrendingUp size={12} className="mr-0.5" /> : <TrendingDown size={12} className="mr-0.5" />}
                      {Math.abs(coin.changePercent24h).toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#11141d] to-transparent z-10 pointer-events-none" />
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#11141d] to-transparent z-10 pointer-events-none" />
        </div>

        {renderContent()}
      </main>

      {/* ── Mobile bottom nav ────────────────────────────────────────── */}
      <MobileNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isBotRunning={isBotRunning}
      />

      {/* ── Footer (desktop only) ────────────────────────────────────── */}
      <footer className="hidden lg:block mt-10 border-t border-gray-800 px-4 py-4">
        <div className="max-w-screen-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <span className="text-cyan-500 font-black text-sm">ELITE-TRADE</span>
            <span>— Trading &amp; Automation Platform v3.0.0</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />Gate.io: Server
            </span>
            <span className="flex items-center gap-1.5">
              {hasTelegram || hasValidTelegramConfig
                ? <><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />Telegram: Active</>
                : <><span className="w-1.5 h-1.5 rounded-full bg-gray-600" />Telegram: Off</>
              }
            </span>
            <span className={`flex items-center gap-1.5 font-semibold ${
              riskState.status === "SAFE" ? "text-emerald-500" :
              riskState.status === "HALTED" ? "text-rose-500" : "text-amber-500"
            }`}>
              <Shield size={14} /> Safety: {riskState.status}
            </span>
            <button
              onClick={lock}
              className="flex items-center gap-1 hover:text-slate-300 transition-colors"
            >
              <Lock size={14} /> Lock
            </button>
            <span className="flex items-center gap-1 text-slate-500"><AlertTriangle size={14} /> Not financial advice.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
