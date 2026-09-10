import { useState } from "react";
import {
  Search,
  Bell,
  Gift,
  Headphones,
  User,
  HelpCircle,
  Star,
  Repeat,
  Zap,
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ChevronRight,
  Flame,
  Hash,
  Plus,
  Minus,
  Shield,
  Bot,
  Users,
} from "lucide-react";

// ── Mock market data ──────────────────────────────────────────────────────────
const HOT_TICKERS = [
  {
    id: "bitcoin",
    base: "BTC",
    name: "Bitcoin",
    price: 118420.5,
    change24h: 2.34,
    color: "#f7931a",
  },
  {
    id: "zec",
    base: "ZEC",
    name: "Zcash",
    price: 142.8,
    change24h: -1.12,
    color: "#000000",
  },
  {
    id: "gold",
    base: "GOLD",
    name: "Gold Spot",
    price: 2648.3,
    change24h: 0.78,
    color: "#d4af37",
  },
  {
    id: "brent",
    base: "OIL",
    name: "Brent Crude",
    price: 82.45,
    change24h: -0.53,
    color: "#3b82f6",
  },
];

const ASSET_LIST = [
  { id: "btc", base: "BTC", name: "Bitcoin", price: 118420.5, change24h: 2.34 },
  { id: "eth", base: "ETH", name: "Ethereum", price: 3842.1, change24h: 1.87 },
  { id: "sol", base: "SOL", name: "Solana", price: 187.45, change24h: 5.21 },
  { id: "bnb", base: "BNB", name: "BNB", price: 612.3, change24h: -0.42 },
  { id: "xrp", base: "XRP", name: "XRP", price: 0.6234, change24h: 3.15 },
  { id: "ada", base: "ADA", name: "Cardano", price: 0.4521, change24h: -2.08 },
  { id: "doge", base: "DOGE", name: "Dogecoin", price: 0.1234, change24h: 4.67 },
  { id: "link", base: "LINK", name: "Chainlink", price: 14.56, change24h: 1.23 },
  { id: "dot", base: "DOT", name: "Polkadot", price: 7.89, change24h: -0.95 },
  { id: "avax", base: "AVAX", name: "Avalanche", price: 35.67, change24h: 2.89 },
  { id: "matic", base: "MATIC", name: "Polygon", price: 0.7234, change24h: -1.45 },
  { id: "atom", base: "ATOM", name: "Cosmos", price: 9.12, change24h: 0.56 },
];

const PREDICTIONS = [
  {
    id: "p1",
    title: "Will BTC break $120,000 by Friday?",
    hashtag: "#BTC120K",
    closeTime: "2h 14m left",
  },
  {
    id: "p2",
    title: "ETH end of week above $4,000?",
    hashtag: "#ETH4K",
    closeTime: "5h 32m left",
  },
  {
    id: "p3",
    title: "SOL weekly gain > 10%?",
    hashtag: "#SOLUP",
    closeTime: "8h 05m left",
  },
  {
    id: "p4",
    title: "GBP/USD close above 1.32?",
    hashtag: "#FX",
    closeTime: "1d 2h left",
  },
];

const ANNOUNCEMENTS = [
  {
    id: "a1",
    icon: "🎁",
    title: "Double Rewards on BTC Pairs",
    desc: "Trade BTC pairs this weekend for 2x reward points.",
  },
  {
    id: "a2",
    icon: "🚀",
    title: "New Listing: PEPE Perpetuals",
    desc: "PEPE perpetual contracts are now live. Trade now.",
  },
  {
    id: "a3",
    icon: "📢",
    title: "Maintenance Notice: 02:00–04:00 UTC",
    desc: "System upgrade scheduled. Minimal downtime expected.",
  },
];

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

// ── Bottom Nav ─────────────────────────────────────────────────────────────────
const BOTTOM_TABS = [
  { id: "home",   label: "Home",   icon: Home, active: true },
  { id: "markets", label: "Markets", icon: BarChart2Icon },
  { id: "trade",   label: "Trade",   icon: Swap },
  { id: "tradfi",  label: "TradFi",  icon: Bank },
  { id: "assets",  label: "Assets",  icon: Wallet },
];

function Home({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function BarChart2Icon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}
function Swap({ size = 22 }: { size?: number }) {
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
function Bank({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="8" width="20" height="12" rx="2" />
      <path d="M6 12h4" />
      <path d="M2 12h2" />
    </svg>
  );
}

function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0b0e11] border-t border-[#1e2329]">
      <div className="flex items-center justify-around py-2 pb-2 safe-area-bottom">
        {BOTTOM_TABS.map((tab) => {
          const isActive = tab.active;
          return (
            <button
              key={tab.id}
              className={`flex flex-col items-center gap-0.5 transition-colors ${
                isActive ? "text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {/* Active pill for Home */}
              {isActive && (
                <span className="absolute -top-0.5 w-8 h-1 rounded-full bg-[#2b6be8] shadow-[0_0_8px_rgba(43,107,232,0.6)]" />
              )}
              <span className={isActive ? "drop-shadow-[0_0_6px_rgba(43,107,232,0.5)]" : ""}>
                <tab.icon size={22} />
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

// ── Header ─────────────────────────────────────────────────────────────────────
function TopHeader() {
  return (
    <header className="bg-[#0b0e11] sticky top-0 z-40 border-b border-[#1e2329]">
      <div className="flex items-center gap-3 px-4 py-3 max-w-[600px] mx-auto">
        {/* Profile */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2b6be8] to-[#6366f1] flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-md">
          J
        </div>

        {/* Search bar */}
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search BTC, ETH..."
            defaultValue="BTC/USDT"
            className="w-full bg-[#181a20] rounded-xl py-2 pl-9 pr-4 text-sm text-slate-300 placeholder-slate-600 border border-[#2a2f3a] focus:outline-none focus:border-[#2b6be8] transition-colors"
          />
        </div>

        {/* Right actions */}
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
    </header>
  );
}

// ── Promo Banner ───────────────────────────────────────────────────────────────
function PromoBanner() {
  return (
    <div className="bg-gradient-to-r from-[#1e3a8a] to-[#2b6be8] rounded-2xl p-4 mb-4 flex items-center justify-between text-white shadow-lg shadow-blue-500/10 border border-blue-400/20">
      <div>
        <p className="text-[13px] font-bold text-blue-200 uppercase tracking-wider mb-0.5">Limited Offer</p>
        <p className="text-white font-black text-base leading-tight">Get 50 USDT welcome bonus</p>
        <p className="text-blue-200 text-xs mt-1">Deposit now and start trading</p>
      </div>
      <button className="bg-white text-[#2b6be8] font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-blue-50 transition-colors shadow-lg shrink-0">
        Claim
      </button>
    </div>
  );
}

// ── Quick Actions Grid ─────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { id: "p2p",  label: "P2P Trading", icon: Exchange, badge: "Hot", badgeColor: "bg-emerald-500" },
  { id: "rewards", label: "Rewards Hub", icon: Gift, badge: "New", badgeColor: "bg-amber-500" },
  { id: "superx", label: "SuperX", icon: Zap, badge: "Pro", badgeColor: "bg-[#2b6be8]" },
  { id: "copy",  label: "Copy Trading", icon: Users, badge: "Trending", badgeColor: "bg-rose-500" },
  { id: "referral", label: "Referral", icon: Star, badge: "Earn", badgeColor: "bg-purple-500" },
];

function Exchange({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 0 1 0 4H8" />
      <path d="M12 18V6" />
    </svg>
  );
}

function QuickActions() {
  return (
    <div className="mb-5">
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
        {QUICK_ACTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="flex-shrink-0 w-[120px] bg-[#121418] rounded-2xl p-3 border border-[#1e2329] hover:border-[#2b6be8]/40 transition-all flex flex-col items-center gap-2.5 group"
            >
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-[#1a1d24] flex items-center justify-center text-slate-300 group-hover:bg-[#2b6be8]/10 group-hover:text-[#2b6be8] transition-all">
                  <Icon size={24} />
                </div>
              </div>
              <span className="text-[13px] font-bold text-slate-300 text-center">{item.label}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.badgeColor} text-white`}>
                {item.badge}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Hot Tickers Grid ───────────────────────────────────────────────────────────
function HotTickers() {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-white font-black text-base">Hot</h2>
        <button className="text-[#2b6be8] text-xs font-bold hover:underline">View All</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {HOT_TICKERS.map((ticker) => {
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
              <div className="flex items-center gap-1.5">
                {isUp ? <TrendingUp size={12} className="text-emerald-400" /> : <TrendingDown size={12} className="text-rose-400" />}
                <span className={`text-xs font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  {isUp ? "+" : ""}{ticker.change24h.toFixed(2)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Market Tabs ─────────────────────────────────────────────────────────────────
const MAIN_TABS = ["Favorites", "Hot", "Stocks", "TradFi", "Gainers", "New"];
const SUBCATEGORIES = ["Trending", "US Stocks", "Korean Stocks", "Indices"];

function TabbableMarketOverview() {
  const [activeTab, setActiveTab] = useState("Favorites");
  const [activeSub, setActiveSub] = useState("Trending");

  return (
    <div className="mb-5">
      {/* Main tabs */}
      <div className="flex gap-1 mb-3 overflow-x-auto scrollbar-hide -mx-1 px-1">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-shrink-0 pb-3 pt-1 px-1 relative text-sm font-bold transition-colors ${activeTab === tab ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
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

      {/* Asset list header */}
      <div className="grid grid-cols-[2fr_1fr_1.5fr_1fr] gap-2 px-2 py-2 bg-[#121418] rounded-t-2xl border-b border-[#1e2329]">
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">Asset</span>
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider text-right">Price</span>
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider text-right">24h %</span>
        <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider text-right">7d Chart</span>
      </div>

      {/* Asset rows */}
      <div className="divide-y divide-[#1e2329]">
        {ASSET_LIST.map((asset) => {
          const isUp = asset.change24h >= 0;
          return (
            <div
              key={asset.id}
              className="grid grid-cols-[2fr_1fr_1.5fr_1fr] gap-2 items-center px-3 py-3 hover:bg-slate-800/30 transition-colors cursor-pointer"
            >
              {/* Asset icon + name */}
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
              {/* Price */}
              <div className="text-right">
                <p className="text-white text-sm font-bold">${fmtPrice(asset.price)}</p>
              </div>
              {/* 24h % */}
              <div className="text-right flex items-center justify-end gap-1">
                <PriceBadge change={asset.change24h} />
              </div>
              {/* Mini sparkline placeholder */}
              <div className="flex justify-end">
                <div className={`w-16 h-6 opacity-60 ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  <svg viewBox="0 0 64 24" className="w-full h-full" preserveAspectRatio="none">
                    <path
                      d={isUp
                        ? "M0 20 Q16 18 32 10 Q48 2 64 6"
                        : "M0 6 Q16 8 32 14 Q48 22 64 18"}
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

// ── Prediction Markets Carousel ─────────────────────────────────────────────────
function PredictionCarousel() {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Flame size={16} className="text-amber-400" />
          <h2 className="text-white font-black text-base">EventX Predictions</h2>
        </div>
        <button className="text-[#2b6be8] text-xs font-bold hover:underline flex items-center gap-1">
          See All <ArrowRight size={12} />
        </button>
      </div>

      {/* Simple horizontal scroll carousel */}
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1 -my-1">
        {PREDICTIONS.map((pred) => (
          <div
            key={pred.id}
            className="flex-shrink-0 w-[260px] bg-[#121418] rounded-2xl p-3 border border-[#1e2329]"
          >
            {/* Hashtag */}
            <span className="text-[10px] font-bold text-[#2b6be8] uppercase tracking-widest">{pred.hashtag}</span>
            <p className="text-white text-sm font-bold mt-1 leading-snug">{pred.title}</p>
            <p className="text-slate-500 text-[11px] mt-1 font-medium">{pred.closeTime}</p>

            {/* Yes / No buttons */}
            <div className="flex gap-2 mt-3">
              <button className="flex-1 py-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/25 transition-colors">
                Yes
              </button>
              <button className="flex-1 py-2 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 text-xs font-bold hover:bg-rose-500/25 transition-colors">
                No
              </button>
            </div>

            {/* Odds */}
            <div className="flex justify-between mt-2 text-[10px] text-slate-500 font-bold">
              <span>Win: 65%</span>
              <span>Payout: 1.52x</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Announcements ───────────────────────────────────────────────────────────────
function Announcements() {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Hash size={16} className="text-[#2b6be8]" />
          <h2 className="text-white font-black text-base">Announcements</h2>
        </div>
        <button className="text-[#2b6be8] text-xs font-bold hover:underline">View All</button>
      </div>

      <div className="space-y-2">
        {ANNOUNCEMENTS.map((ann) => (
          <div
            key={ann.id}
            className="bg-[#121418] rounded-2xl p-3 flex items-start gap-3 border border-[#1e2329]"
          >
            {/* Icon badge */}
            <div className="w-9 h-9 rounded-xl bg-[#1e2329] flex items-center justify-center text-lg shrink-0 shadow-inner">
              {ann.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-bold leading-snug">{ann.title}</p>
              <p className="text-slate-500 text-xs mt-0.5 leading-snug">{ann.desc}</p>
            </div>
            <ChevronRight size={16} className="text-slate-600 shrink-0 mt-0.5" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function BingXHomeDashboard() {
  return (
    <div className="min-h-screen bg-[#0b0e11] text-white pb-24">
      {/* Header */}
      <TopHeader />

      <div className="max-w-[600px] mx-auto px-3 pt-3 space-y-1">
        {/* Promo banner */}
        <PromoBanner />

        {/* Quick actions */}
        <QuickActions />

        {/* Hot tickers */}
        <HotTickers />

        {/* Market overview with tabs */}
        <TabbableMarketOverview />

        {/* Prediction markets */}
        <PredictionCarousel />

        {/* Announcements */}
        <Announcements />
      </div>

      {/* Bottom navigation */}
      <BottomNav />
    </div>
  );
}
