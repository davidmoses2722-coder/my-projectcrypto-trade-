import { useState } from "react";
import { CoinPrice, Signal, Trade, PortfolioAsset } from "../types/crypto";
import { SignalCard } from "./SignalCard";
import { OpenPositionCard } from "./OpenPositionCard";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";
import { StatusBadge } from "./premium/StatusBadge";
import { TrendingUp, TrendingDown, ChevronRight, Search, Headphones, Gift, Bell, Flame, Hash } from "lucide-react";

// ── BingX-style icons (inline SVGs, no lucide dependency) ─────────────────────
function HomeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function MarketsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}
function TradeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6" />
      <path d="M4 8l6 6" />
    </svg>
  );
}
function TradFiIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="8" width="20" height="12" rx="2" />
      <path d="M6 12h4" />
      <path d="M2 12h2" />
    </svg>
  );
}
function AssetsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}
function ExchangeIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 0 1 0 4H8" />
      <path d="M12 18V6" />
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

function PriceBadge({ change }: { change: number }) {
  const isUp = change >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
      {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {Math.abs(change).toFixed(2)}%
    </span>
  );
}

// ── Mock hot tickers (supplemented by live prices if available) ───────────────
const BINGX_HOT_TICKERS = [
  { id: "btc", base: "BTC", name: "Bitcoin", price: 0, change24h: 0, color: "#f7931a", headline: "Market momentum building" },
  { id: "eth", base: "ETH", name: "Ethereum", price: 0, change24h: 0, color: "#627eea", headline: "ETF inflow steady" },
  { id: "gold", base: "GOLD", name: "Gold Spot", price: 0, change24h: 0, color: "#d4af37", headline: "Safe-haven demand up" },
  { id: "brent", base: "OIL", name: "Brent Crude", price: 0, change24h: 0, color: "#3b82f6", headline: "Supply concerns persist" },
];

const BINGX_ASSETS = [
  { id: "btc", base: "BTC", name: "Bitcoin", price: 0, change24h: 0 },
  { id: "eth", base: "ETH", name: "Ethereum", price: 0, change24h: 0 },
  { id: "sol", base: "SOL", name: "Solana", price: 0, change24h: 0 },
  { id: "bnb", base: "BNB", name: "BNB", price: 0, change24h: 0 },
  { id: "xrp", base: "XRP", name: "XRP", price: 0, change24h: 0 },
  { id: "ada", base: "ADA", name: "Cardano", price: 0, change24h: 0 },
  { id: "doge", base: "DOGE", name: "Dogecoin", price: 0, change24h: 0 },
  { id: "link", base: "LINK", name: "Chainlink", price: 0, change24h: 0 },
  { id: "dot", base: "DOT", name: "Polkadot", price: 0, change24h: 0 },
  { id: "avax", base: "AVAX", name: "Avalanche", price: 0, change24h: 0 },
  { id: "matic", base: "MATIC", name: "Polygon", price: 0, change24h: 0 },
  { id: "atom", base: "ATOM", name: "Cosmos", price: 0, change24h: 0 },
];

// ── Bottom Navigation ──────────────────────────────────────────────────────────
const BOTTOM_TABS = [
  { id: "home",   label: "Home",   icon: HomeIcon, active: true },
  { id: "markets", label: "Markets", icon: MarketsIcon },
  { id: "trade",   label: "Trade",   icon: TradeIcon },
  { id: "tradfi",  label: "TradFi",  icon: TradFiIcon },
  { id: "assets",  label: "Assets",  icon: AssetsIcon },
];

// ── Top Header ─────────────────────────────────────────────────────────────────
function BingXHeader() {
  return (
    <header className="bg-[#0b0e11] sticky top-0 z-40 border-b border-[#1e2329]">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Profile avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2b6be8] to-[#6366f1] flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-md">
          J
        </div>

        {/* Scrollable ticker search bar */}
        <div className="flex-1 relative overflow-hidden">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search BTC, ETH..."
            defaultValue="BTC/USDT"
            className="w-full bg-[#181a20] rounded-xl py-2 pl-9 pr-4 text-sm text-slate-300 placeholder-slate-600 border border-[#2a2f3a] focus:outline-none focus:border-[#2b6be8] transition-colors"
          />
        </div>

        {/* Action icons */}
        <button className="w-9 h-9 rounded-xl bg-[#181a20] flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#22262f] border border-[#2a2f3a] transition-all">
          <Headphones size={18} />
        </button>
        <button className="w-9 h-9 rounded-xl bg-[#181a20] flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#22262f] border border-[#2a2f3a] transition-all relative">
          <Gift size={18} />
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#f59e0b] text-[9px] font-bold text-white flex items-center justify-center shadow-md">3</span>
        </button>
        <button className="w-9 h-9 rounded-xl bg-[#181a20] flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#22262f] border border-[#2a2f3a] transition-all relative">
          <Bell size={18} />
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center shadow-md">5</span>
        </button>
      </div>

      {/* Scrolling hot ticker bar */}
      <div className="overflow-hidden border-t border-[#1e2329] bg-[#0b0e11]">
        <div className="flex items-center gap-8 px-4 py-1.5 text-xs font-bold animate-ticker hover:[animation-play-state:paused]">
          {BINGX_HOT_TICKERS.map((t) => (
            <span key={t.id} className="whitespace-nowrap">
              <span className="text-slate-400 mr-1">{t.base}</span>
              <span className="text-slate-200">${fmtPrice(t.price || 0)}</span>
            </span>
          ))}
          {BINGX_HOT_TICKERS.map((t) => (
            <span key={`dup-${t.id}`} className="whitespace-nowrap">
              <span className="text-slate-400 mr-1">{t.base}</span>
              <span className="text-slate-200">${fmtPrice(t.price || 0)}</span>
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

// ── Promotional Banner ─────────────────────────────────────────────────────────
function PromoBanner({ onCTAClick }: { onCTAClick?: () => void }) {
  return (
    <div className="bg-gradient-to-r from-[#1e3a8a] to-[#2b6be8] rounded-2xl p-4 mb-4 flex items-center justify-between text-white shadow-lg shadow-blue-500/10 border border-blue-400/20">
      <div>
        <p className="text-[13px] font-bold text-blue-200 uppercase tracking-wider mb-0.5">Limited Offer</p>
        <p className="text-white font-black text-base leading-tight">Get 50 USDT welcome bonus</p>
        <p className="text-blue-200 text-xs mt-1">Deposit now and start trading</p>
      </div>
      <button
        onClick={onCTAClick}
        className="bg-white text-[#2b6be8] font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-blue-50 transition-colors shadow-lg shrink-0"
      >
        Trade Now
      </button>
    </div>
  );
}

// ── Quick Actions Bar ──────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { id: "p2p",  label: "P2P Trading", icon: ExchangeIcon, badge: "", badgeColor: "" },
  { id: "rewards", label: "Rewards Hub", icon: Gift, badge: "", badgeColor: "" },
  { id: "superx", label: "SuperX", icon: Flame, badge: "HOT", badgeColor: "bg-rose-500" },
  { id: "copy",  label: "Copy Trading", icon: Hash, badge: "", badgeColor: "" },
  { id: "referral", label: "Referral", icon: TrendingUp, badge: "", badgeColor: "" },
];

function QuickActionsRow() {
  return (
    <div className="mb-5">
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
        {QUICK_ACTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="flex-shrink-0 w-[90px] bg-[#121418] rounded-2xl p-3 border border-[#1e2329] hover:border-[#2b6be8]/40 transition-all flex flex-col items-center gap-2 group"
            >
              <div className="w-12 h-12 rounded-xl bg-[#1a1d24] flex items-center justify-center text-slate-300 group-hover:bg-[#2b6be8]/10 group-hover:text-[#2b6be8] transition-all">
                <Icon size={24} />
              </div>
              <span className="text-[13px] font-bold text-slate-300 text-center leading-tight">{item.label}</span>
              {item.badge && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${item.badgeColor} text-white`}>
                  {item.badge}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Hot Market Tickers Grid (2x2) ──────────────────────────────────────────────
function HotTickerCards({ prices }: { prices: CoinPrice[] }) {
  const tickers = BINGX_HOT_TICKERS.map((t) => {
    const live = prices.find((p) => p.symbol === t.base || p.symbol === t.base.replace("OIL", "").trim());
    return {
      ...t,
      price: live ? live.price : t.price,
      change24h: live ? live.changePercent24h : t.change24h,
    };
  });

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-white font-black text-base">Hot</h2>
        <button className="text-[#2b6be8] text-xs font-bold hover:underline">View All</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {tickers.map((ticker) => {
          const isUp = ticker.change24h >= 0;
          return (
            <div
              key={ticker.id}
              className="bg-[#121418] rounded-2xl p-3 border border-[#1e2329] hover:border-slate-700 transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black text-white"
                  style={{ backgroundColor: ticker.color }}
                >
                  {ticker.base.slice(0, 2)}
                </div>
                <div>
                  <p className="text-white text-sm font-bold">{ticker.base}</p>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">{ticker.name}</p>
                </div>
              </div>
              <p className="text-white font-black text-lg mb-1">${fmtPrice(ticker.price)}</p>
              <div className="flex items-center gap-1.5 mb-1.5">
                {isUp ? <TrendingUp size={12} className="text-emerald-400" /> : <TrendingDown size={12} className="text-rose-400" />}
                <span className={`text-xs font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  {isUp ? "+" : ""}{ticker.change24h.toFixed(2)}%
                </span>
              </div>
              <p className="text-slate-500 text-[11px] font-medium leading-tight">{ticker.headline}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Asset & Market Tabs ────────────────────────────────────────────────────────
const MAIN_TABS = ["Favorites", "Hot", "Stocks", "TradFi", "Gainers", "New"];
const SUBCATEGORIES = ["Trending", "US Stocks", "Korean Stocks", "Indices"];

function AssetTabList({ prices }: { prices: CoinPrice[] }) {
  const [activeTab, setActiveTab] = useState("Favorites");
  const [activeSub, setActiveSub] = useState("Trending");

  // Merge live prices into mock asset list
  const assets = BINGX_ASSETS.map((a) => {
    const live = prices.find((p) => p.symbol === a.base);
    return { ...a, price: live ? live.price : a.price, change24h: live ? live.changePercent24h : a.change24h };
  });

  return (
    <div className="mb-5">
      {/* Main category tabs */}
      <div className="flex gap-1 mb-3 overflow-x-auto scrollbar-hide -mx-1 px-1">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-shrink-0 pb-3 pt-1 px-1 relative text-sm font-bold transition-colors ${
              activeTab === tab ? "text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2b6be8] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Sub-category pills */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1 mb-3">
        {SUBCATEGORIES.map((sub) => (
          <button
            key={sub}
            onClick={() => setActiveSub(sub)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeSub === sub
                ? "bg-[#2b6be8] text-white"
                : "bg-[#1e2329] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            {sub}
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[2fr_1fr_1.5fr_1fr] gap-2 px-2 py-2 bg-[#121418] rounded-t-2xl border-b border-[#1e2329]">
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">Asset</span>
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider text-right">Price</span>
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider text-right">24h %</span>
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider text-right">7d Chart</span>
      </div>

      {/* Asset rows */}
      <div className="divide-y divide-[#1e2329]">
        {assets.map((asset) => {
          const isUp = asset.change24h >= 0;
          return (
            <div
              key={asset.id}
              className="grid grid-cols-[2fr_1fr_1.5fr_1fr] gap-2 items-center px-3 py-3 hover:bg-slate-800/30 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                  isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                }`}>
                  {asset.base.slice(0, 2)}
                </div>
                <div className="overflow-hidden">
                  <p className="text-white text-sm font-bold leading-tight">{asset.base}</p>
                  <p className="text-slate-500 text-[10px] font-bold truncate">{asset.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-white text-sm font-bold">${fmtPrice(asset.price)}</p>
              </div>
              <div className="text-right flex items-center justify-end gap-1">
                <PriceBadge change={asset.change24h} />
              </div>
              <div className="flex justify-end">
                <div className={`w-16 h-6 opacity-60 ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  <svg viewBox="0 0 64 24" className="w-full h-full" preserveAspectRatio="none">
                    <path
                      d={isUp ? "M0 20 Q16 18 32 10 Q48 2 64 6" : "M0 6 Q16 8 32 14 Q48 22 64 18"}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Bottom Navigation ──────────────────────────────────────────────────────────
function BottomNav({ onTabChange }: { onTabChange: (tab: string) => void }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0b0e11] border-t border-[#1e2329]">
      <div className="flex items-center justify-around py-2 pb-2">
        {BOTTOM_TABS.map((tab) => {
          const isActive = tab.active;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center gap-0.5 transition-colors relative ${
                isActive ? "text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {isActive && (
                <span className="absolute -top-0.5 w-8 h-1 rounded-full bg-[#2b6be8] shadow-[0_0_8px_rgba(43,107,232,0.6)]" />
              )}
              <span className={isActive ? "drop-shadow-[0_0_6px_rgba(43,107,232,0.5)]" : ""}>
                <Icon size={22} />
              </span>
              <span className={`text-[10px] font-bold tracking-wider ${isActive ? "text-[#2b6be8]" : ""}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="h-1 bg-[#1e2329]" />
    </nav>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────
interface DashboardProps {
  prices: CoinPrice[];
  signals: Signal[];
  trades: Trade[];
  portfolio: PortfolioAsset[];
  totalPnL: number;
  fearGreedIndex: number;
  isBotRunning: boolean;
  activeStrategy?: string;
  onTabChange: (tab: string) => void;
  connectionStatus?: "connecting" | "live" | "simulated";
}

// ── Main Dashboard (BingX layout) ──────────────────────────────────────────────
export function Dashboard({
  prices,
  signals,
  trades,
  portfolio,
  totalPnL,
  fearGreedIndex,
  isBotRunning,
  activeStrategy,
  onTabChange,
  connectionStatus,
}: DashboardProps) {
  const openPositions = trades.filter((t) => t.status === "open");
  const topSignals = signals.slice(0, 3);

  return (
    <div className="space-y-6 pb-20">
      {/* BingX Header Bar */}
      <BingXHeader />

      <div className="max-w-[1200px] mx-auto px-4 pt-4 space-y-4">
        {/* Promotional Banner */}
        <PromoBanner onCTAClick={() => onTabChange("manual-trading")} />

        {/* Quick Actions Row */}
        <QuickActionsRow />

        {/* Hot Market Ticker Cards */}
        <HotTickerCards prices={prices} />

        {/* Asset & Market Tabs */}
        <AssetTabList prices={prices} />

        {/* Open Positions (keep existing card) */}
        {openPositions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold uppercase tracking-wide text-sm">Open Positions</h2>
              <span className="text-xs font-black px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-400 tracking-wider">
                {openPositions.length} LIVE
              </span>
            </div>
            <div className="space-y-3">
              {openPositions.map((t) => (
                <OpenPositionCard
                  key={t.id}
                  trade={t}
                  prices={prices}
                  calledBy="Dashboard"
                />
              ))}
            </div>
          </div>
        )}

        {/* Latest Signals */}
        <div className="flex items-center justify-between mt-6 mb-4">
          <h2 className="text-white font-semibold uppercase tracking-wide text-sm">Latest Signals</h2>
          <button onClick={() => onTabChange("signals")} className="text-cyan-400 text-[13px] font-bold uppercase tracking-wider tracking-wide hover:text-cyan-300">
            All signals →
          </button>
        </div>
        {topSignals.length > 0
          ? topSignals.map((sig) => <SignalCard key={sig.id} signal={sig} />)
          : <PremiumCard><PremiumCardContent className="p-4"><p className="text-slate-500 text-xs text-center py-4">No signals yet.</p></PremiumCardContent></PremiumCard>
        }
      </div>

      {/* Persistent Bottom Navigation */}
      <BottomNav onTabChange={onTabChange} />
    </div>
  );
}
